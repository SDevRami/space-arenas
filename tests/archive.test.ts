import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MATCH_SETTINGS,
  PROTOCOL_VERSION,
  defaultReplayName,
  replayDateLabel,
  validReplay,
  type ReplayData,
  type EnvelopeCommand,
} from '@space-arenas/shared'
import { createArchiveStore, replayFileName, type ArchiveStore } from '../host/src/archive.ts'

const map = {
  name: 'test',
  width: 64,
  height: 64,
  tiles: [],
  spawnPoints: [],
  obstacles: [],
} as unknown as import('@space-arenas/shared').MapData

const makeReplay = (over: Partial<ReplayData> = {}): ReplayData => ({
  version: PROTOCOL_VERSION,
  createdAt: '2026-01-01T00:00:00.000Z',
  seed: 42,
  tickRate: 25,
  map,
  settings: DEFAULT_MATCH_SETTINGS,
  players: [{ id: 0, name: 'Alpha', team: 0, color: 0, bot: false }],
  winner: 0,
  ticks: 100,
  history: [{ player: 0, seq: 1, tick: 0, cmd: { type: 'move', entities: [1], x: 0, y: 0 } }],
  ...over,
})

let dir = ''
let store: ArchiveStore

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sa-archive-unit-'))
  store = createArchiveStore(dir)
}, 15000)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('validReplay', () => {
  it('accepts a well-formed replay', () => {
    expect(validReplay(makeReplay())).toBe(true)
  })

  it('rejects non-objects, missing maps, empty history and wrong winner types', () => {
    expect(validReplay(null)).toBe(false)
    expect(validReplay('x')).toBe(false)
    expect(validReplay({ ...makeReplay(), map: null })).toBe(false)
    expect(validReplay({ ...makeReplay(), players: [{ id: 'not-a-number' }] })).toBe(false)
    expect(validReplay({ ...makeReplay(), history: [{ tick: 0, cmd: null }] })).toBe(false)
    expect(validReplay({ ...makeReplay(), winner: 'zero' })).toBe(false)
    expect(validReplay({ ...makeReplay(), seed: NaN })).toBe(false)
  })
})

describe('name helpers', () => {
  it('defaults and date labels are clean and file-safe', () => {
    expect(defaultReplayName(new Date())).toMatch(/^replay-\d{8}-\d{6}$/)
    expect(replayDateLabel('2026-01-02T04:05:06.000Z')).toBe('2026-01-02')
    expect(replayFileName('Cool Battle.json')).toBe('Cool Battle.json')
    expect(replayFileName('a\\/:*?"<>|b')).toBe('ab.json')
    expect(replayFileName('   ')).toMatch(/^replay-\d{8}-\d{6}\.json$/)
  })
})

describe('createArchiveStore', () => {
  it('saves, reads and lists replays as JSON files', async () => {
    store.ensure()
    const name = await store.save(makeReplay(), 'first-match')
    expect(name).toBe('first-match.json')

    const list = await store.list()
    expect(list.length).toBeGreaterThan(0)
    const meta = list.find((m) => m.name === name)
    expect(meta).toBeDefined()
    expect(meta?.valid).toBe(true)
    expect(meta?.label).toBe('first-match')
    expect(meta?.ticks).toBe(100)
    expect(meta?.players).toEqual(['Alpha'])

    const loaded = await store.read(name)
    expect(loaded?.seed).toBe(42)
    expect(loaded?.history?.length).toBe(1)
  })

  it('dedups colliding save names with a numeric suffix', async () => {
    const first = await store.save(makeReplay(), 'dup')
    const second = await store.save(makeReplay(), 'dup')
    expect(first).toBe('dup.json')
    expect(second).toBe('dup-1.json')

    const files = await readdir(dir)
    expect(files).toContain('dup.json')
    expect(files).toContain('dup-1.json')
  })

  it('renames files and dedups the new name', async () => {
    const name = await store.save(makeReplay(), 'to-rename')
    const target = await store.rename(name, 'renamed-ok')
    expect(target).toBe('renamed-ok.json')
    expect(await store.read('renamed-ok.json')).not.toBeNull()
    expect(await store.read('to-rename.json')).toBeNull()

    const clash = await store.save(makeReplay(), 'renamed-ok')
    const clashTarget = await store.rename(clash, 'renamed-ok')
    expect(clashTarget).toBe('renamed-ok-2.json')
  })

  it('remove deletes the file and reports false for missing files', async () => {
    const name = await store.save(makeReplay(), 'to-delete')
    expect(await store.remove(name)).toBe(true)
    expect(await store.read(name)).toBeNull()
    expect(await store.remove('never-existed.json')).toBe(false)
  })

  it('lists corrupt files as invalid so they can still be deleted', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'broken.json'), '{ not json', 'utf8')
    const list = await store.list()
    const broken = list.find((m) => m.name === 'broken.json')
    expect(broken?.valid).toBe(false)
    expect(broken?.ticks).toBe(0)
    expect(await store.remove('broken.json')).toBe(true)
  })

  it('read returns null for missing or unreadable files', async () => {
    expect(await store.read('missing.json')).toBeNull()
    const bad = await store.save(makeReplay(), 'bad')
    await (await import('node:fs/promises')).writeFile(join(dir, 'bad.json'), 'nope', 'utf8')
    expect(await store.read(bad)).toBeNull()
  })

  it('relays bot commands in history so replay playback stays deterministic', async () => {
    const history: EnvelopeCommand[] = [
      { player: 0, seq: 1, tick: 0, cmd: { type: 'move', entities: [1], x: 0, y: 0 } },
      { player: 2, seq: 1, tick: 0, cmd: { type: 'move', entities: [9], x: 5, y: 5 } },
    ]
    const name = await store.save(makeReplay({ history }), 'with-bots')
    const loaded = await store.read(name)
    expect(loaded?.history?.some((c) => c.player === 2)).toBe(true)
  })
})