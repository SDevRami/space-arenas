import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PROTOCOL_VERSION,
  isValidMod,
  mergeEntityMaps,
  modFromSettings,
  modSettingsDelta,
} from '@space-arenas/shared'
import { createModStore, modFileName, sanitizeMod, type ModStore } from '../host/src/mods.ts'
import { sanitizeOverrideMaps, sanitizeSettings } from '../host/src/sanitize.ts'

const VALID_MOD = {
  meta: { name: 'Turbo Mod', author: 'Rami', description: 'Faster everything', version: '1.0.0', requireProtocol: PROTOCOL_VERSION },
  settings: { startingCredits: 2000, sellRefundFraction: 0.4 },
  buildingOverrides: { 'power-plant': { cost: 400, hp: 1600 } },
  unitOverrides: { rifleman: { cost: 120 } },
}

let dir = ''
let store: ModStore

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sa-mods-unit-'))
  store = createModStore(dir)
}, 15000)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('isValidMod', () => {
  it('accepts a well-formed mod with meta, settings and an override', () => {
    expect(isValidMod(VALID_MOD, PROTOCOL_VERSION).ok).toBe(true)
  })

  it('accepts a minimal mod without meta as long as it has content', () => {
    expect(isValidMod({ settings: { startingCredits: 1500 } }, PROTOCOL_VERSION).ok).toBe(true)
  })

  it('rejects non-objects and arrays', () => {
    expect(isValidMod(null, PROTOCOL_VERSION).ok).toBe(false)
    expect(isValidMod('x', PROTOCOL_VERSION).ok).toBe(false)
    expect(isValidMod([], PROTOCOL_VERSION).ok).toBe(false)
  })

  it('rejects non-object meta and non-number requireProtocol', () => {
    expect(isValidMod({ ...VALID_MOD, meta: 'nope' }, PROTOCOL_VERSION).ok).toBe(false)
    expect(isValidMod({ ...VALID_MOD, meta: { requireProtocol: '18' } }, PROTOCOL_VERSION).ok).toBe(false)
  })

  it('refuses a requireProtocol mismatch and allows a match', () => {
    const bad = isValidMod({ ...VALID_MOD, meta: { requireProtocol: PROTOCOL_VERSION + 1 } }, PROTOCOL_VERSION)
    expect(bad.ok).toBe(false)
    expect(bad.errors).toContain('mod protocol mismatch')
  })

  it('rejects non-object settings, non-object override maps and non-number fields', () => {
    expect(isValidMod({ ...VALID_MOD, settings: 5 }, PROTOCOL_VERSION).ok).toBe(false)
    expect(isValidMod({ ...VALID_MOD, buildingOverrides: [] }, PROTOCOL_VERSION).ok).toBe(false)
    expect(isValidMod({ buildingOverrides: { 'power-plant': { cost: 'big' } } }, PROTOCOL_VERSION).ok).toBe(false)
    expect(isValidMod({ buildingOverrides: { 'power-plant': 3 } }, PROTOCOL_VERSION).ok).toBe(false)
  })

  it('rejects a mod with no settings or overrides at all', () => {
    const v = isValidMod({ meta: { name: 'Empty' } }, PROTOCOL_VERSION)
    expect(v.ok).toBe(false)
    expect(v.errors).toContain('mod has no settings or overrides')
  })
})

describe('mergeEntityMaps', () => {
  it('merges per entity and per field, with b winning on collisions', () => {
    const a = { 'power-plant': { cost: 300, hp: 1000 }, barracks: { cost: 200 } }
    const b = { 'power-plant': { hp: 1500 }, 'supply-dock': { cost: 180 } }
    const out = mergeEntityMaps(a, b)
    expect(out).toEqual({
      'power-plant': { cost: 300, hp: 1500 },
      barracks: { cost: 200 },
      'supply-dock': { cost: 180 },
    })
    expect(a['power-plant'].hp).toBe(1000)
  })

  it('handles undefined sides', () => {
    expect(mergeEntityMaps(undefined, { rifleman: { cost: 1 } })).toEqual({ rifleman: { cost: 1 } })
    expect(mergeEntityMaps({ a: { cost: 1 } }, undefined)).toEqual({ a: { cost: 1 } })
  })
})

describe('modSettingsDelta', () => {
  it('pre-merges the four override maps and spreads scalar settings', () => {
    const base = {
      buildingOverrides: { 'power-plant': { cost: 300, hp: 1000 } },
      unitOverrides: { rifleman: { cost: 100, damage: 10 } },
    }
    const delta = modSettingsDelta(base, {
      settings: { sellRefundFraction: 0.5 },
      buildingOverrides: { 'power-plant': { hp: 2000 } },
      unitOverrides: { rifleman: { cost: 120 } },
    })
    expect(delta.buildingOverrides).toEqual({ 'power-plant': { cost: 300, hp: 2000 } })
    expect(delta.unitOverrides).toEqual({ rifleman: { cost: 120, damage: 10 } })
    expect(delta.weaponOverrides).toEqual({})
    expect(delta.upgradeOverrides).toEqual({})
    expect(delta.sellRefundFraction).toBe(0.5)
    expect(base.buildingOverrides['power-plant'].hp).toBe(1000)
  })
})

describe('modFromSettings', () => {
  it('emits only non-empty maps and defined scalars with the meta attached', () => {
    const mod = modFromSettings(
      {
        sellRefundFraction: 0.4,
        queueLimit: undefined,
        buildingOverrides: { 'power-plant': { cost: 400 } },
        unitOverrides: {},
      },
      { name: 'Export', requireProtocol: PROTOCOL_VERSION },
    )
    expect(mod.meta).toEqual({ name: 'Export', requireProtocol: PROTOCOL_VERSION })
    expect(mod.settings).toEqual({ sellRefundFraction: 0.4 })
    expect(mod.buildingOverrides).toEqual({ 'power-plant': { cost: 400 } })
    expect(mod.unitOverrides).toBeUndefined()
    expect(isValidMod(mod, PROTOCOL_VERSION).ok).toBe(true)
  })
})

describe('modFileName', () => {
  it('scrubs filesystem-hostile characters and falls back to a default', () => {
    expect(modFileName('Turbo Mod')).toBe('Turbo Mod.json')
    expect(modFileName('a\\/:*?"<>|b')).toBe('ab.json')
    expect(modFileName('thing.json')).toBe('thing.json')
    expect(modFileName('   ')).toBe('mod.json')
    expect(modFileName('x'.repeat(200))).toBe(`${'x'.repeat(80)}.json`)
  })
})

describe('sanitizeMod', () => {
  it('clamps scalar and override values and drops unknown fields', () => {
    const clean = sanitizeMod({
      meta: { name: 'Dirty', author: 'x', requireProtocol: PROTOCOL_VERSION },
      settings: { sellRefundFraction: 5, startingCredits: 10, madeUpScalar: 123 },
      buildingOverrides: {
        'power-plant': { cost: 2e9, madeUpField: 7 },
        'supply-dock': { nope: 1 },
      },
    })
    expect(clean?.settings).toEqual({ sellRefundFraction: 1, startingCredits: 100 })
    expect(clean?.buildingOverrides).toEqual({ 'power-plant': { cost: 1000000 } })
    expect(clean?.meta).toEqual({ name: 'Dirty', author: 'x', requireProtocol: PROTOCOL_VERSION })
  })

  it('returns null for protocol mismatches and non-objects', () => {
    expect(sanitizeMod({ meta: { requireProtocol: PROTOCOL_VERSION + 1 }, settings: { startingCredits: 1 } })).toBeNull()
    expect(sanitizeMod('nope')).toBeNull()
  })

  it('keeps sanitization of the newer scalar group (laser/max-power/rank-up)', () => {
    const out = sanitizeSettings({
      laserDelayTicksLv1: -5,
      laserDelayTicksLv2: 999999,
      maxPowerTicks: 5,
      rankUpPrizeCredits: 999999,
    })
    expect(out.laserDelayTicksLv1).toBe(0)
    expect(out.laserDelayTicksLv2).toBe(100000)
    expect(out.maxPowerTicks).toBe(5)
    expect(out.rankUpPrizeCredits).toBe(100000)
  })
})

describe('sanitizeSettings', () => {
  it('drops unknown scalars and passes through string/enum options', () => {
    const out = sanitizeSettings({
      startingCredits: 1,
      fogMode: 'hard',
      dayNight: true,
      coopEconomy: 'both',
      bogus: 1,
    })
    expect(out.startingCredits).toBe(100)
    expect(out.fogMode).toBe('hard')
    expect(out.dayNight).toBe(true)
    expect(out.coopEconomy).toBe('both')
    expect((out as Record<string, unknown>).bogus).toBeUndefined()
  })

  it('clamps the override-map tables per field and drops unknown fields', () => {
    const out = sanitizeOverrideMaps({
      unitOverrides: {
        rifleman: { cost: 5e9, range: -2, madeUp: 9 },
        tank: { speed: 0 },
      },
    })
    expect(out.unitOverrides).toEqual({
      rifleman: { cost: 1000000, range: 0 },
      tank: { speed: 0 },
    })
  })
})

describe('createModStore', () => {
  it('saves, reads (sync + async) and lists mods as JSON files', async () => {
    store.ensure()
    const name = await store.save(VALID_MOD)
    expect(name).toBe('Turbo Mod.json')

    const list = await store.list()
    expect(list.length).toBeGreaterThan(0)
    const meta = list.find((m) => m.name === name)
    expect(meta?.label).toBe('Turbo Mod')
    expect(meta?.author).toBe('Rami')
    expect(meta?.description).toBe('Faster everything')
    expect(meta?.version).toBe('1.0.0')
    expect(meta?.valid).toBe(true)
    expect(meta?.protocolOk).toBe(true)
    expect((meta?.size ?? 0)).toBeGreaterThan(0)

    const loaded = await store.read(name)
    expect(loaded?.settings?.startingCredits).toBe(2000)
    expect(loaded?.buildingOverrides?.['power-plant']?.cost).toBe(400)
    expect(store.readSync(name)?.meta?.name).toBe('Turbo Mod')
  })

  it('dedups colliding save names with a numeric suffix', async () => {
    await store.save(VALID_MOD, 'dup')
    const second = await store.save(VALID_MOD, 'dup')
    expect(second).toBe('dup-1.json')
    expect(await readdir(dir)).toContain('dup-1.json')
  })

  it('renames files, rewrites meta.name and dedups the target', async () => {
    const name = await store.save(VALID_MOD, 'to-rename')
    const target = await store.rename(name, 'renamed-ok')
    expect(target).toBe('renamed-ok.json')
    expect(store.readSync('renamed-ok.json')?.meta?.name).toBe('renamed-ok')
    expect(await store.read(name)).toBeNull()

    const sameName = await store.rename(target, 'renamed-ok')
    expect(sameName).toBe(target)

    await store.save(VALID_MOD, 'clash')
    await store.save(VALID_MOD, 'clash')
    const clashTarget = await store.rename('clash-1.json', 'clash')
    expect(clashTarget).toBe('clash-2.json')
  })

  it('rejects invalid mods on save', async () => {
    await expect(store.save({ meta: { requireProtocol: PROTOCOL_VERSION + 1 }, settings: {} })).rejects.toThrow('invalid mod')
  })

  it('lists corrupt and protocol-mismatched files so they stay deletable', async () => {
    await writeFile(join(dir, 'broken.json'), '{ not json', 'utf8')
    await writeFile(
      join(dir, 'oldproto.json'),
      JSON.stringify({ meta: { name: 'Old', requireProtocol: PROTOCOL_VERSION - 1 }, settings: { startingCredits: 1 } }),
      'utf8',
    )
    const list = await store.list()
    expect(list.find((m) => m.name === 'broken.json')?.valid).toBe(false)
    const oldProto = list.find((m) => m.name === 'oldproto.json')
    expect(oldProto?.valid).toBe(false)
    expect(oldProto?.protocolOk).toBe(false)
    expect(await store.read('broken.json')).toBeNull()
    expect(store.readSync('oldproto.json')).toBeNull()
  })

  it('remove deletes the file and reports false for missing files', async () => {
    const name = await store.save(VALID_MOD, 'to-delete')
    expect(await store.remove(name)).toBe(true)
    expect(await store.read(name)).toBeNull()
    expect(await store.remove('never-existed.json')).toBe(false)
  })
})