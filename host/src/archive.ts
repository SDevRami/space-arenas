import { mkdirSync } from 'node:fs'
import { readdir, readFile, writeFile, unlink, rename, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultReplayName,
  validReplay,
  type ReplayData,
  type ReplayMeta,
} from '@space-arenas/shared'

const HOST_BASE =
  typeof __dirname !== 'undefined' ? __dirname : fileURLToPath(new URL('.', import.meta.url))

/** The on-disk replay folder. `../../archive` from host/src or host/dist is the project
 *  root's `archive/` in both builds; tests pin it via SA_ARCHIVE_DIR. */
export const ARCHIVE_DIR = resolve(process.env.SA_ARCHIVE_DIR ?? resolve(HOST_BASE, '../../archive'))

const scrubName = (name: string): string =>
  name
    .trim()
    // eslint-disable-next-line no-control-regex -- scrub filesystem-hostile control chars from replay names
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .slice(0, 80)

/** Normalizes an arbitrary replay name to a safe `<name>.json` filename. */
export const replayFileName = (name: string): string =>
  `${scrubName(name).replace(/\.json$/i, '') || defaultReplayName()}.json`

export interface ArchiveStore {
  readonly dir: string
  ensure(): void
  save(replay: ReplayData, suggested?: string): Promise<string>
  read(name: string): Promise<ReplayData | null>
  list(): Promise<ReplayMeta[]>
  remove(name: string): Promise<boolean>
  rename(name: string, newName: string): Promise<string | null>
}

export const createArchiveStore = (dir: string): ArchiveStore => {
  const exists = async (p: string): Promise<boolean> => {
    try {
      await stat(p)
      return true
    } catch {
      return false
    }
  }

  const uniqueFileName = async (name: string): Promise<string> => {
    const file = replayFileName(name)
    const bare = file.slice(0, -5)
    let candidate = file
    let n = 1
    while (await exists(join(dir, candidate))) {
      candidate = `${bare}-${n}.json`
      n++
    }
    return candidate
  }

  const ensure = (): undefined => {
    mkdirSync(dir, { recursive: true })
    return undefined
  }

  return {
    dir,
    ensure,
    async save(replay, suggested) {
      ensure()
      const file = await uniqueFileName(suggested ?? defaultReplayName())
      await writeFile(join(dir, file), JSON.stringify(replay), 'utf8')
      return file
    },
    async read(name) {
      try {
        const json = JSON.parse(await readFile(join(dir, replayFileName(name)), 'utf8')) as unknown
        return validReplay(json) ? json : null
      } catch {
        return null
      }
    },
    async list() {
      ensure()
      const entries = await readdir(dir)
      const names = entries.filter((f) => f.toLowerCase().endsWith('.json'))
      const metas: ReplayMeta[] = []
      for (const name of names) {
        const file = join(dir, name)
        let size = 0
        try {
          size = (await stat(file)).size
        } catch {
          continue
        }
        const meta: ReplayMeta = {
          name,
          size,
          createdAt: '',
          map: '',
          players: [],
          winner: null,
          ticks: 0,
          label: name.replace(/\.json$/i, ''),
          valid: false,
        }
        try {
          const json = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
          const valid = validReplay(json)
          meta.valid = valid
          if (valid) {
            meta.createdAt = typeof json.createdAt === 'string' ? json.createdAt : ''
            if (json.map && typeof (json.map as { name?: unknown }).name === 'string') meta.map = (json.map as { name: string }).name
            if (Array.isArray(json.players)) meta.players = (json.players as { name?: unknown }[]).map((p) => (typeof p.name === 'string' ? p.name : ''))
            if (typeof json.winner === 'number') meta.winner = json.winner
            if (typeof json.ticks === 'number') meta.ticks = json.ticks
          }
        } catch {
          // unreadable/corrupt files stay listed (valid:false) so they can be deleted
        }
        metas.push(meta)
      }
      const ordered = [] as { meta: ReplayMeta; mtime: number }[]
      for (const meta of metas) {
        const st = await stat(join(dir, meta.name)).catch(() => null)
        ordered.push({ meta, mtime: st?.mtimeMs ?? 0 })
      }
      return ordered.sort((a, b) => b.mtime - a.mtime).map((o) => o.meta)
    },
    async remove(name) {
      try {
        await unlink(join(dir, replayFileName(name)))
        return true
      } catch {
        return false
      }
    },
    async rename(name, newName) {
      const from = replayFileName(name)
      const bare = replayFileName(newName).slice(0, -5)
      if (bare.toLowerCase() === from.slice(0, -5).toLowerCase()) return from
      const target = await uniqueFileName(bare)
      try {
        await rename(join(dir, from), join(dir, target))
        return target
      } catch {
        return null
      }
    },
  }
}

export const archiveStore = createArchiveStore(ARCHIVE_DIR)