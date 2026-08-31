import type { ChatRelayMessage } from '@space-arenas/shared'
import { t } from '../i18n/index.ts'

type ChatTarget = 'all' | 'team'

interface ChatEntry {
  target: ChatTarget
  name?: string
  text: string
}

export class ChatBox {
  private readonly overlay = document.getElementById('chat-overlay')!
  private readonly historyEl = document.getElementById('chat-history')!
  private readonly input = document.getElementById('chat-input') as HTMLInputElement
  private readonly sendBtn = document.getElementById('chat-send') as HTMLButtonElement
  private readonly chatBtn = document.getElementById('chat-btn') as HTMLButtonElement
  private readonly closeBtn = document.getElementById('chat-close') as HTMLButtonElement
  private readonly globalTab = this.tabBtn('all')
  private readonly teamTab = this.tabBtn('team')
  private target: ChatTarget = 'all'
  private entries: ChatEntry[] = []
  private renderKey = ''
  private unread = 0

  constructor(
    private readonly onSend: (text: string, target: ChatTarget) => void,
    private readonly spectator: boolean,
  ) {
    this.chatBtn.addEventListener('click', this.onBtnClick)
    this.closeBtn.addEventListener('click', this.hide)
    this.sendBtn.addEventListener('click', this.send)
    this.globalTab.addEventListener('click', () => this.setTab('all'))
    this.teamTab.addEventListener('click', () => this.setTab('team'))
    this.input.addEventListener('keydown', this.onInputKey)
    if (this.spectator) {
      this.teamTab.disabled = true
      this.teamTab.title = t('chat.spectatorTeam')
    }
  }

  private tabBtn(target: ChatTarget): HTMLButtonElement {
    return this.overlay.querySelector(`[data-target="${target}"]`) as HTMLButtonElement
  }

  showButton(): void {
    this.chatBtn.classList.add('visible')
  }

  hideButton(): void {
    this.chatBtn.classList.remove('visible')
  }

  show(): void {
    this.overlay.classList.add('visible')
    this.unread = 0
    this.updateBadge()
    this.input.focus()
  }

  hide = (): void => {
    this.overlay.classList.remove('visible')
  }

  isVisible(): boolean {
    return this.overlay.classList.contains('visible')
  }

  toggle(): void {
    if (this.isVisible()) this.hide()
    else this.show()
  }

  private onBtnClick = (): void => {
    this.toggle()
  }

  setTab(target: ChatTarget): void {
    this.target = target
    this.globalTab.classList.toggle('active', target === 'all')
    this.teamTab.classList.toggle('active', target === 'team')
    this.render()
  }

  append(msg: ChatRelayMessage): void {
    this.entries.push({ target: msg.target, name: msg.name, text: msg.text })
    if (!this.isVisible() && msg.target !== this.target) this.unread++
    if (this.isVisible()) this.render()
    else this.updateBadge()
  }

  system(text: string): void {
    this.entries.push({ target: 'all', text })
    this.render()
  }

  private send = (): void => {
    const text = this.input.value.trim()
    if (!text) return
    this.input.value = ''
    this.onSend(text, this.target)
  }

  private onInputKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      this.send()
    }
  }

  private updateBadge(): void {
    const badge = this.chatBtn.querySelector('.badge')
    if (badge) badge.textContent = this.unread > 0 ? `${this.unread}` : ''
  }

  private render(): void {
    const key = `${this.target}:${this.entries.length}`
    if (key === this.renderKey) return
    this.renderKey = key
    this.historyEl.innerHTML = ''
    const filtered = this.entries.filter((en) => en.target === this.target)
    if (filtered.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'chat-empty'
      empty.textContent = this.target === 'all' ? t('chat.emptyGlobal') : t('chat.emptyTeam')
      this.historyEl.appendChild(empty)
      return
    }
    for (const en of filtered) {
      const line = document.createElement('div')
      line.className = `chat-line${en.target === 'team' ? ' team-line' : ''}`
      if (en.name) {
        const who = document.createElement('span')
        who.className = `who${en.target === 'team' ? ' team' : ''}`
        who.textContent = en.name
        line.appendChild(who)
      }
      line.appendChild(document.createTextNode(en.text))
      this.historyEl.appendChild(line)
    }
    this.historyEl.scrollTop = this.historyEl.scrollHeight
  }

  destroy(): void {
    this.hide()
    this.hideButton()
    this.chatBtn.removeEventListener('click', this.onBtnClick)
    this.closeBtn.removeEventListener('click', this.hide)
    this.sendBtn.removeEventListener('click', this.send)
    this.input.removeEventListener('keydown', this.onInputKey)
  }
}
