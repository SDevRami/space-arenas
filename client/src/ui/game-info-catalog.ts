import {
  BUILDINGS,
  UNITS,
  UPGRADES,
  WEAPONS,
  UNIT_IDS,
  SIM_TICK_HZ,
  type MatchSettings,
  type WeaponDef,
  type UpgradeDef,
} from '@space-arenas/shared'
import { getBuilding, getUnit, getUpgrade, getWeapon } from '@space-arenas/shared'
import { tn } from '../i18n/index.ts'
import { t } from '../i18n/index.ts'
import { BOT_CONFIGS, BOT_DIFFICULTIES, type BotDifficulty, type BotConfig } from '../ai/bot.ts'

export const initGameInfoCatalog = (resolvedDevSettings: () => MatchSettings) => {
  const infoContent = document.getElementById('info-content') as HTMLDivElement
  const infoTabs = document.getElementById('info-tabs') as HTMLDivElement

  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const sec = (ticks: number): string => {
    const s = ticks / SIM_TICK_HZ
    return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`
  }
  const weaponText = (w: WeaponDef | undefined): string => {
    if (!w) return '—'
    const eff = getWeapon(w.id, resolvedDevSettings())
    let text = t('weapon.dmg', { d: eff.damage, r: eff.range, s: (eff.cooldownTicks / SIM_TICK_HZ).toFixed(1) })
    if (eff.splash) text += ` · ${t('weapon.splash')}`
    if (eff.targetsAir) text += ` · ${t('weapon.antiAir')}`
    return text
  }

  const unitRow = (id: string): string => {
    const s = resolvedDevSettings()
    const u = getUnit(id, s)
    const produced = BUILDINGS[u.producedBy]
    const cls = t(`units.class.${u.isHarvester ? 'harvester' : u.class}`)
    return `<tr><td><b>${esc(tn(id, u.name))}</b><br>${cls}</td><td>${esc(t(`units.role.${id}`))}</td><td>$${u.cost}</td><td>${u.hp}</td><td>${u.speed}</td><td>${sec(u.buildTimeTicks)}</td><td>${produced ? esc(tn(u.producedBy, produced.name)) : '—'}</td><td>${weaponText(u.weapon ? WEAPONS[u.weapon] : undefined)}</td></tr>`
  }

  const buildingRow = (id: string): string => {
    const s = resolvedDevSettings()
    const b = getBuilding(id, s)
    const makes = b.producesUnit ? UNITS[b.producesUnit] : undefined
    const wep = b.weapon ? WEAPONS[b.weapon] : undefined
    const power = b.powerGen > 0 ? `+${b.powerGen}` : b.powerUse > 0 ? `−${b.powerUse}` : '0'
    const notes: string[] = []
    if (makes) notes.push(t('info.buildings.notes.trains', { name: esc(tn(b.producesUnit!, makes.name)) }))
    if (wep) notes.push(weaponText(wep))
    if (b.countLimit !== undefined) notes.push(t('info.buildings.notes.limit', { n: b.countLimit }))
    return `<tr><td><b>${esc(tn(id, b.name))}</b><br>${t('info.buildings.footprint', { w: b.footprint[0], h: b.footprint[1] })}</td><td>$${b.cost}</td><td>${sec(b.buildTimeTicks)}</td><td>${b.hp}</td><td>${power}</td><td>${notes.join(' · ') || '—'}</td></tr>`
  }

  const botProse = (d: BotDifficulty, c: BotConfig): string => {
    const interval = (ticks: number): string => `${(ticks / SIM_TICK_HZ).toFixed(1)}s`
    const targetNames = c.targets.map((tg) => {
      const def = BUILDINGS[tg.type]
      const label = def ? tn(tg.type, def.name) : tg.type
      return tg.limit > 1 ? `${label} ×${tg.limit}` : label
    })
    const prodNames = c.production.map((p) => (BUILDINGS[p] ? tn(p, BUILDINGS[p].name) : p)).join(', ')
    const tagClass = `tag tag-${d}`
    return t('info.bots.prose', {
      tagClass,
      difficulty: esc(t(`difficulty.${d}`)),
      interval: interval(c.decisionInterval),
      reserve: c.reserve,
      floor: c.hardFloor,
      harvesterCap: c.harvesterCap,
      dozers: c.maintainDozers,
      army: c.armyThreshold,
      attackInterval: interval(c.attackInterval),
      powerMargin: c.powerMargin,
      targets: targetNames.join(', '),
      products: prodNames,
    })
  }

  const controlsInfoHtml = (): string => `
    <h3>${t('info.controls.h3')}</h3>
    <table class="cat-table">
      <tr><th>${t('info.controls.thAction')}</th><th>${t('info.controls.thInput')}</th></tr>
      <tr><td>${t('info.controls.select')}</td><td>${t('info.controls.inputSelect')}</td></tr>
      <tr><td>${t('info.controls.box')}</td><td>${t('info.controls.inputBox')}</td></tr>
      <tr><td>${t('info.controls.ctrl')}</td><td>${t('info.controls.inputCtrl')}</td></tr>
      <tr><td>${t('info.controls.move')}</td><td>${t('info.controls.inputMove')}</td></tr>
      <tr><td>${t('info.controls.attackMove')}</td><td>${t('info.controls.inputAttackMove')}</td></tr>
      <tr><td>${t('info.controls.stop')}</td><td>${t('info.controls.inputStop')}</td></tr>
      <tr><td>${t('info.controls.home')}</td><td>${t('info.controls.inputHome')}</td></tr>
      <tr><td>${t('info.controls.idleWorker')}</td><td>${t('info.controls.inputIdleWorker')}</td></tr>
      <tr><td>${t('info.controls.idleDozer')}</td><td>${t('info.controls.inputIdleDozer')}</td></tr>
      <tr><td>${t('info.controls.borders')}</td><td>${t('info.controls.inputBorders')}</td></tr>
      <tr><td>${t('info.controls.paths')}</td><td>${t('info.controls.inputPaths')}</td></tr>
      <tr><td>${t('info.controls.reveal')}</td><td>${t('info.controls.inputReveal')}</td></tr>
      <tr><td>${t('info.controls.minimap')}</td><td>${t('info.controls.inputMinimap')}</td></tr>
      <tr><td>${t('info.controls.sell')}</td><td>${t('info.controls.inputSell')}</td></tr>
      <tr><td>${t('info.controls.spawnPoint')}</td><td>${t('info.controls.inputSpawnPoint')}</td></tr>
      <tr><td>${t('info.controls.flag')}</td><td>${t('info.controls.inputFlag')}</td></tr>
      <tr><td>${t('info.controls.esc')}</td><td>${t('info.controls.inputEsc')}</td></tr>
      <tr><td>${t('info.controls.pan')}</td><td>${t('info.controls.inputPan')}</td></tr>
      <tr><td>${t('info.controls.zoom')}</td><td>${t('info.controls.inputZoom')}</td></tr>
      <tr><td>${t('info.controls.minimapJump')}</td><td>${t('info.controls.inputMinimapJump')}</td></tr>
      <tr><td>${t('info.controls.edgePan')}</td><td>${t('info.controls.inputEdgePan')}</td></tr>
    </table>
    <h3>${t('info.controls.rightClickH3')}</h3>
    <ul>
      <li>${t('info.controls.right1')}</li>
      <li>${t('info.controls.right2')}</li>
      <li>${t('info.controls.right3')}</li>
      <li>${t('info.controls.right4')}</li>
      <li>${t('info.controls.right5')}</li>
    </ul>
    <h3>${t('info.controls.combatOrdersH3')}</h3>
    <ul>
      <li>${t('info.controls.combatMove')}</li>
      <li>${t('info.controls.combatAttack')}</li>
      <li>${t('info.controls.combatAttackMove')}</li>
      <li>${t('info.controls.combatKeepAttack')}</li>
      <li>${t('info.controls.combatGuard')}</li>
    </ul>
    <h3>${t('info.mobile.h3')}</h3>
    <p>${t('info.mobile.p')}</p>
    <h3>${t('info.mobile.touchH3')}</h3>
    <table class="cat-table">
      <tr><th>${t('info.mobile.thAction')}</th><th>${t('info.mobile.thInput')}</th></tr>
      <tr><td>${t('info.mobile.select')}</td><td>${t('info.mobile.inputSelect')}</td></tr>
      <tr><td>${t('info.mobile.box')}</td><td>${t('info.mobile.inputBox')}</td></tr>
      <tr><td>${t('info.mobile.move')}</td><td>${t('info.mobile.inputMove')}</td></tr>
      <tr><td>${t('info.mobile.cmdMode')}</td><td>${t('info.mobile.inputCmdMode')}</td></tr>
      <tr><td>${t('info.mobile.attackMove')}</td><td>${t('info.mobile.inputAttackMove')}</td></tr>
      <tr><td>${t('info.mobile.pan')}</td><td>${t('info.mobile.inputPan')}</td></tr>
      <tr><td>${t('info.mobile.zoom')}</td><td>${t('info.mobile.inputZoom')}</td></tr>
    </table>
    <h3>${t('info.mobile.buttonsH3')}</h3>
    <p>${t('info.mobile.buttonsP')}</p>
    <ul>
      <li>${t('info.mobile.bC')}</li>
      <li>${t('info.mobile.bA')}</li>
      <li>${t('info.mobile.bX')}</li>
      <li>${t('info.mobile.bB')}</li>
      <li>${t('info.mobile.bP')}</li>
      <li>${t('info.mobile.bF')}</li>
      <li>${t('info.mobile.bM')}</li>
      <li>${t('info.mobile.bH')}</li>
      <li>${t('info.mobile.bI')}</li>
      <li>${t('info.mobile.bD')}</li>
      <li>${t('info.mobile.bS')}</li>
      <li>${t('info.mobile.bL')}</li>
    </ul>
    <p>${t('info.mobile.shortcutsP')}</p>
    <p>${t('info.mobile.toolbarNote')}</p>
  `

  const renderInfoTab = (tab: string): void => {
    let html = ''
    switch (tab) {
      case 'start':
        html = `
          <h3>${t('info.start.whatH3')}</h3>
          <p>${t('info.start.whatP')}</p>
          <h3>${t('info.start.flowH3')}</h3>
          <ol>
            <li>${t('info.start.flow1')}</li>
            <li>${t('info.start.flow2')}</li>
            <li>${t('info.start.flow3')}</li>
            <li>${t('info.start.flow4')}</li>
            <li>${t('info.start.flow5')}</li>
          </ol>
          <h3>${t('info.start.matchH3')}</h3>
          <p>${t('info.start.matchP')}</p>
          <p>${t('info.start.netP')}</p>
          <h3>${t('info.start.duringH3')}</h3>
          <p>${t('info.start.duringP')}</p>
        `
        break
      case 'units':
        html = `
          <h3>${t('info.units.h3')}</h3>
          <p class="hint">${t('info.devNote')}</p>
          <table class="cat-table">
            <tr><th>${t('info.units.thUnit')}</th><th>${t('info.units.thRole')}</th><th>${t('info.units.thCost')}</th><th>${t('info.units.thHp')}</th><th>${t('info.units.thSpeed')}</th><th>${t('info.units.thTime')}</th><th>${t('info.units.thAt')}</th><th>${t('info.units.thWeapon')}</th></tr>
          ${UNIT_IDS.map(unitRow).join('')}
          </table>
          <p>${t('info.units.p')}</p>
          <p>${t('info.units.ghostP')}</p>
        `
        break
      case 'buildings':
        html = `
          <h3>${t('info.buildings.h3')}</h3>
          <p class="hint">${t('info.devNote')}</p>
          <table class="cat-table">
            <tr><th>${t('info.buildings.thName')}</th><th>${t('info.buildings.thCost')}</th><th>${t('info.buildings.thTime')}</th><th>${t('info.buildings.thHp')}</th><th>${t('info.buildings.thPower')}</th><th>${t('info.buildings.thNotes')}</th></tr>
          ${Object.keys(BUILDINGS)
            .map(buildingRow)
            .join('')}
          </table>
          <p>${t('info.buildings.p')}</p>
        `
        break
      case 'power':
        html = `
          <h3>${t('info.power.h3')}</h3>
          <p>${t('info.power.p1')}</p>
          <ul>
            <li>${t('info.power.l1')}</li>
            <li>${t('info.power.l2')}</li>
            <li>${t('info.power.l3')}</li>
          </ul>
          <p>${t('info.power.p2')}</p>
          <h3>${t('info.power.maxPowerH')}</h3>
          <p>${t('info.power.maxPowerP', { s: Math.round(resolvedDevSettings().maxPowerTicks / SIM_TICK_HZ) })}</p>
          <h3>${t('info.power.h4')}</h3>
          <ul>
            <li>${t('info.power.s1')}</li>
            <li>${t('info.power.s2')}</li>
            <li>${t('info.power.s3')}</li>
            <li>${t('info.power.s4')}</li>
            <li>${t('info.power.s5')}</li>
          </ul>
        `
        break
      case 'bots':
        html = `
          <h3>${t('info.bots.h3')}</h3>
          <p>${t('info.bots.p')}</p>
          <table class="cat-table">
            <tr><th>${t('info.bots.thSetting')}</th><th>${t('info.bots.thEasy')}</th><th>${t('info.bots.thMedium')}</th><th>${t('info.bots.thHard')}</th></tr>
            <tr><td>${t('info.bots.rDecision')}</td><td>${(BOT_CONFIGS.easy.decisionInterval / SIM_TICK_HZ).toFixed(1)}s</td><td>${(BOT_CONFIGS.medium.decisionInterval / SIM_TICK_HZ).toFixed(1)}s</td><td>${(BOT_CONFIGS.hard.decisionInterval / SIM_TICK_HZ).toFixed(1)}s</td></tr>
            <tr><td>${t('info.bots.rReserve')}</td><td>$${BOT_CONFIGS.easy.reserve} / $${BOT_CONFIGS.easy.hardFloor}</td><td>$${BOT_CONFIGS.medium.reserve} / $${BOT_CONFIGS.medium.hardFloor}</td><td>$${BOT_CONFIGS.hard.reserve} / $${BOT_CONFIGS.hard.hardFloor}</td></tr>
            <tr><td>${t('info.bots.rHarvesters')}</td><td>${BOT_CONFIGS.easy.harvesterCap}</td><td>${BOT_CONFIGS.medium.harvesterCap}</td><td>${BOT_CONFIGS.hard.harvesterCap}</td></tr>
            <tr><td>${t('info.bots.rDozers')}</td><td>${BOT_CONFIGS.easy.maintainDozers}</td><td>${BOT_CONFIGS.medium.maintainDozers}</td><td>${BOT_CONFIGS.hard.maintainDozers}</td></tr>
            <tr><td>${t('info.bots.rArmy')}</td><td>${BOT_CONFIGS.easy.armyThreshold}</td><td>${BOT_CONFIGS.medium.armyThreshold}</td><td>${BOT_CONFIGS.hard.armyThreshold}</td></tr>
            <tr><td>${t('info.bots.rAttack')}</td><td>${(BOT_CONFIGS.easy.attackInterval / SIM_TICK_HZ).toFixed(1)}s</td><td>${(BOT_CONFIGS.medium.attackInterval / SIM_TICK_HZ).toFixed(1)}s</td><td>${(BOT_CONFIGS.hard.attackInterval / SIM_TICK_HZ).toFixed(1)}s</td></tr>
            <tr><td>${t('info.bots.rPower')}</td><td>${BOT_CONFIGS.easy.powerMargin}</td><td>${BOT_CONFIGS.medium.powerMargin}</td><td>${BOT_CONFIGS.hard.powerMargin}</td></tr>
          </table>
          <h3>${t('info.bots.h4')}</h3>
          <ul>
          ${BOT_DIFFICULTIES.map((d) => botProse(d, BOT_CONFIGS[d])).join('')}
          </ul>
          <p>${t('info.bots.deterministic')}</p>
        `
        break
      case 'tech':
        html = `
          <h3>${t('info.tech.h3')}</h3>
          <p class="hint">${t('info.devNote')}</p>
          <table class="cat-table">
            <tr><th>${t('info.tech.thUpgrade')}</th><th>${t('info.tech.thCost')}</th><th>${t('info.tech.thTime')}</th><th>${t('info.tech.thAt')}</th></tr>
          ${Object.values(UPGRADES)
            .map((base: UpgradeDef) => {
              const u = getUpgrade(base.id, resolvedDevSettings())
              return `<tr><td><b>${esc(tn(u.id, u.name))}</b></td><td>$${u.cost}</td><td>${sec(u.researchTimeTicks)}</td><td>${esc(tn(u.availableAt, BUILDINGS[u.availableAt]?.name ?? u.availableAt))}</td></tr>`
            })
            .join('')}
          </table>
          <p>${t('info.tech.p')}</p>
        `
        break
      default:
        html = `<p>${t('info.empty')}</p>`
    }
    infoContent.innerHTML = html
  }

  const setInfoTab = (tab: string): void => {
    for (const b of infoTabs.querySelectorAll<HTMLButtonElement>('button')) {
      b.classList.toggle('active', b.dataset.tab === tab)
    }
    renderInfoTab(tab)
  }

  const renderActiveInfoTab = (): void => {
    const active = infoTabs.querySelector<HTMLButtonElement>('button.active')
    renderInfoTab(active?.dataset.tab ?? 'start')
  }

  for (const b of infoTabs.querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => setInfoTab(b.dataset.tab ?? 'start'))
  }
  renderInfoTab('start')

  return { renderInfoTab, setInfoTab, renderActiveInfoTab, controlsInfoHtml }
}
