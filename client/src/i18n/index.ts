import enRaw from './lang/en.json'
import arRaw from './lang/ar.json'

export type Lang = 'en' | 'ar'

type Dict = { [key: string]: string | Dict }
const dicts: Record<Lang, Dict> = { en: enRaw as Dict, ar: arRaw as Dict }

const STORAGE_KEY = 'space-arenas:lang'
const listeners = new Set<() => void>()

function lookup(dict: Dict, key: string): string | undefined {
  let node: string | Dict = dict
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = node[part] as string | Dict
  }
  return typeof node === 'string' ? node : undefined
}

export function getLang(): Lang {
  return current
}

let current: Lang = 'en'

export function setLang(lang: Lang, persist = true): void {
  if (!dicts[lang]) return
  current = lang
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      /* storage unavailable */
    }
  }
  applyLangAttrs()
  for (const fn of listeners) fn()
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function applyLangAttrs(): void {
  document.documentElement.lang = current
  document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr'
  document.title = t('app.title')
}

export function initLang(): Lang {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
  current = stored === 'ar' ? 'ar' : 'en'
  applyLangAttrs()
  return current
}

export function t(key: string, params?: Record<string, string | number>): string {
  let val = lookup(dicts[current], key)
  if (val === undefined) val = lookup(dicts.en, key)
  if (val === undefined) return key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.split(`{${k}}`).join(String(v))
    }
  }
  return val
}

export function tn(id: string, fallback: string): string {
  const key = `names.${id}`
  const val = lookup(dicts[current], key)
  if (val !== undefined) return val
  const enVal = lookup(dicts.en, key)
  return enVal ?? fallback
}

export function translateStatic(root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    const key = el.getAttribute('data-i18n')
    if (key) el.textContent = t(key)
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]'))) {
    const key = el.getAttribute('data-i18n-placeholder')
    if (key) el.setAttribute('placeholder', t(key))
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n-title]'))) {
    const key = el.getAttribute('data-i18n-title')
    if (key) el.setAttribute('title', t(key))
  }
}
