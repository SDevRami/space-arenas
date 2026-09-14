import { crc32 } from '@space-arenas/shared'
import type { World } from './world.ts'

const addNumber = (bytes: number[], v: number): void => {
  const u = v >>> 0
  bytes.push((u >> 24) & 0xff, (u >> 16) & 0xff, (u >> 8) & 0xff, u & 0xff)
}

const addString = (bytes: number[], s: string): void => {
  for (let i = 0; i < s.length; i++) addNumber(bytes, s.charCodeAt(i))
}

export const hashWorld = (world: World): number => {
  const bytes: number[] = []
  addNumber(bytes, world.tick)
  addNumber(bytes, world.width)
  addNumber(bytes, world.height)
  addNumber(bytes, Number(BigInt.asUintN(32, BigInt(world.rngState()))))
  addString(bytes, world.settings.coopEconomy)
  addString(bytes, world.settings.coopRank)
  addString(bytes, world.settings.coopControl)
  const teams = [...world.teams.keys()].sort((a, b) => a - b)
  for (const t of teams) {
    const s = world.teams.get(t)
    if (s) {
      addNumber(bytes, t)
      addNumber(bytes, s.credits)
      addNumber(bytes, s.powerGen)
      addNumber(bytes, s.powerUse)
      addNumber(bytes, s.powerNet)
      addNumber(bytes, s.powerDown ? 1 : 0)
      addNumber(bytes, s.radar ? 1 : 0)
      addNumber(bytes, s.satellite ? 1 : 0)
      addNumber(bytes, s.satelliteRevealUntil)
      addNumber(bytes, s.satelliteLastUsed)
      addNumber(bytes, s.laser ? 1 : 0)
      addNumber(bytes, s.laserLastUsed)
      addNumber(bytes, s.laserFreeShotUsed ? 1 : 0)
      addNumber(bytes, s.laserLevel)
      addNumber(bytes, s.alliance)
      addNumber(bytes, s.stealthTech ? 1 : 0)
      addNumber(bytes, s.detectorUnlocked ? 1 : 0)
      addNumber(bytes, s.mineTech ? 1 : 0)
      addNumber(bytes, s.abilitiesUnlocked ? 1 : 0)
      addNumber(bytes, s.transportCapacityLevel ? 1 : 0)
      addNumber(bytes, s.defenseDome ? 1 : 0)
      addNumber(bytes, s.weaponUpgradeLevel)
      addString(bytes, s.swChoice ?? '')
      addNumber(bytes, s.airstrikeLastUsed)
      addNumber(bytes, s.empLastUsed)
      addNumber(bytes, s.score)
      addNumber(bytes, s.rank)
      addNumber(bytes, s.airstrikeLevel)
      addNumber(bytes, s.empLevel)
    }
  }

  const addComp = (set: { idsArray(): readonly number[] }, get: (id: number) => object): void => {
    const ids = set.idsArray()
    for (const id of ids) {
      const v = get(id) as Record<string, unknown>
      addNumber(bytes, id)
      for (const key of Object.keys(v)) {
        const val = v[key]
        if (typeof val === 'number') addNumber(bytes, val as number)
        else if (typeof val === 'string') addString(bytes, val as string)
        else if (typeof val === 'boolean') addNumber(bytes, val ? 1 : 0)
        else if (Array.isArray(val)) {
          addNumber(bytes, val.length)
          for (const item of val) {
            if (typeof item === 'number') addNumber(bytes, item as number)
            else if (typeof item === 'string') addString(bytes, item as string)
            else if (item && typeof item === 'object') {
              const obj = item as Record<string, unknown>
              for (const k of Object.keys(obj)) {
                const vv = obj[k]
                if (typeof vv === 'number') addNumber(bytes, vv as number)
                else if (typeof vv === 'string') addString(bytes, vv as string)
              }
            }
          }
        } else if (val && typeof val === 'object') {
          const obj = val as Record<string, unknown>
          for (const k of Object.keys(obj)) {
            const vv = obj[k]
            if (typeof vv === 'number') addNumber(bytes, vv as number)
            else if (typeof vv === 'string') addString(bytes, vv as string)
            else if (typeof vv === 'boolean') addNumber(bytes, vv ? 1 : 0)
          }
        }
      }
    }
  }

  addComp(world.transforms, (id) => world.transforms.require(id))
  addComp(world.units, (id) => world.units.require(id))
  addComp(world.buildings, (id) => world.buildings.require(id))
  addComp(world.healths, (id) => world.healths.require(id))
  addComp(world.visions, (id) => world.visions.require(id))
  addComp(world.attacks, (id) => world.attacks.require(id))
  addComp(world.moves, (id) => world.moves.require(id))
  addComp(world.queues, (id) => world.queues.require(id))
  addComp(world.harvesters, (id) => world.harvesters.require(id))
  addComp(world.fields, (id) => world.fields.require(id))
  addComp(world.oilFields, (id) => world.oilFields.require(id))
  addComp(world.works, (id) => world.works.require(id))
  addComp(world.wrecks, (id) => world.wrecks.require(id))
  addComp(world.satelliteMarkers, (id) => world.satelliteMarkers.require(id))
  addComp(world.grenades, (id) => world.grenades.require(id))
  addComp(world.smokes, (id) => world.smokes.require(id))
  addComp(world.planes, (id) => world.planes.require(id))
  addComp(world.lasers, (id) => world.lasers.require(id))
  addComp(world.airstrikes, (id) => world.airstrikes.require(id))
  addComp(world.empPulses, (id) => world.empPulses.require(id))
  addComp(world.scenery, (id) => world.scenery.require(id))
  addComp(world.mines, (id) => world.mines.require(id))
  addComp(world.transports, (id) => world.transports.require(id))

  return crc32(Uint8Array.from(bytes))
}

export const compactHash = (h: number): string => h.toString(16).padStart(8, '0')
