/* Space Arenas — landing page (GitHub Pages).
 * i18n EN/AR toggle (localStorage + ?lang=) and a read-only top-mods strip that
 * caches the Render API response locally (short TTL) to keep traffic to the API low.
 */

// The public Render API. Set this to your deployed service origin.
const SA_ONLINE_URL = 'https://space-arenas-online.onrender.com'

const TOP_MODS_TTL_MS = 5 * 60 * 1000
const CACHE_KEY = 'sa-topmods-cache-v1'
const LANG_KEY = 'sa-lang'

const EN = {
  brand: 'Space Arenas',
  'nav.features': 'Features',
  'nav.howto': 'How to join',
  'nav.mods': 'Mods',
  'nav.repo': 'Source',
  'hero.badge': 'Real-time strategy in space',
  'hero.title': 'Command your fleet on maps that fight back.',
  'hero.subtitle': 'Build your base, harvest resources, and out-think your rivals with tactical airstrikes, stealth, mines and more — solo or online with friends.',
  'hero.ctaRepo': 'Get the game',
  'features.title': 'Built for deep, readable battles',
  'features.rts.title': 'Classic RTS core',
  'features.rts.text': 'Harvesters, supply fields, tech trees and a veteran system — all rendered on an infinite hexes canvas.',
  'features.fog.title': 'Fog, day & night',
  'features.fog.text': 'Dynamic line-of-sight, stealth units and a full day/night cycle change how you scout and strike.',
  'features.mods.title': 'Balance mods',
  'features.mods.text': 'Tune the economy, units and weapons with downloadable mod files — then share them in the online repository.',
  'features.online.title': 'Online lobbies',
  'features.online.text': 'Create password-protected rooms, search open matches and climb the global leaderboard with a free account.',
  'howto.title': 'Join in three steps',
  'howto.st1.title': 'Get the game',
  'howto.st1.text': 'Clone the repository and run run-game.bat — no install required, it runs straight in your browser.',
  'howto.st2.title': 'Make an account',
  'howto.st2.text': 'Sign up in the online lobby to unlock the leaderboard, data backups and the mod repository.',
  'howto.st3.title': 'Play & share',
  'howto.st3.text': 'Create or join a room, pick a balance mod, and carry your progress anywhere with encrypted backups.',
  'mods.title': 'Community balance mods',
  'mods.subtitle': 'Top-rated from the shared repository.',
  'mods.loading': 'Loading…',
  'mods.empty': 'No mods published yet — be the first!',
  'mods.error': 'Could not reach the mod repository right now.',
  'mods.by': 'by {author}',
  'mods.downloads': '{n} downloads',
  'mods.noRating': 'not rated yet',
  'mods.download': 'Download',
  'mods.downloading': 'Downloading…',
  'mods.downloadLimit': 'Download limit reached — try again in a minute.',
  'mods.downloadError': 'Download failed. Please try again.',
  'media.title': 'Seen in action',
  'media.battle': 'Skirmish view',
  'media.mod': 'Mod tuning',
  'media.online': 'Online lobby',
  'footer.desc': 'Open-source real-time strategy game. Report issues on GitHub.',
  'footer.rights': 'Made with ♪ — play, mod, share.',
  'lang.other': 'العربية',
}

const AR = {
  brand: 'ساحات الفضاء',
  'nav.features': 'المميزات',
  'nav.howto': 'كيف تلعب',
  'nav.mods': 'التعديلات',
  'nav.repo': 'المصدر',
  'hero.badge': 'استراتيجية في الزمن الحقيقي في الفضاء',
  'hero.title': 'قُد أسطولك في خرائط تقاومك.',
  'hero.subtitle': 'ابنِ قاعدتك، اجمع الموارد، وتفوق على خصومك بالغارات التكتيكية، والتخفي، والألغام والمزيد — منفرداً أو عبر الإنترنت مع أصدقائك.',
  'hero.ctaRepo': 'حمّل اللعبة',
  'features.title': 'مصممة لمعارك عميقة وواضحة',
  'features.rts.title': 'جوهر استراتيجية كلاسيكي',
  'features.rts.text': 'حصادات، حقول إمداد، شجرات تقنية ونظام خبرة قدامى — كل ذلك على لوحة سداسية لا نهائية.',
  'features.fog.title': 'ضباب، ليل ونهار',
  'features.fog.text': 'خط رؤية ديناميكي، وحدات متخفية ودورة كاملة ليل/نهار تغيّر طريقة استطلاعك وهجومك.',
  'features.mods.title': 'تعديلات التوازن',
  'features.mods.text': 'اضبط الاقتصاد والوحدات والأسلحة بملفات تعديل قابلة للتنزيل — ثم شاركها في مستودع التعديلات.',
  'features.online.title': 'قاعات على الإنترنت',
  'features.online.text': 'أنشئ قاعات محمية بكلمة مرور، ابحث عن المباريات المفتوحة وارتقِ في لوحة المتصدرين العالمية بحساب مجاني.',
  'howto.title': 'انضم في ثلاث خطوات',
  'howto.st1.title': 'حمّل اللعبة',
  'howto.st1.text': 'انسخ المستودع وشغّل run-game.bat — لا حاجة لأي تثبيت، تعمل مباشرة في متصفحك.',
  'howto.st2.title': 'أنشئ حساباً',
  'howto.st2.text': 'سجّل في قاعة اللعب لفتح لوحة المتصدرين والنسخ الاحتياطية ومستودع التعديلات.',
  'howto.st3.title': 'العب وشارك',
  'howto.st3.text': 'أنشئ قاعة أو انضم إليها، اختر تعديل توازن، وانقل تقدمك أينما كنت بنسخ احتياطية مشفرة.',
  'mods.title': 'تعديلات توازن المجتمع',
  'mods.subtitle': 'الأعلى تقييماً من المستودع المشترك.',
  'mods.loading': 'جارٍ التحميل…',
  'mods.empty': 'لا توجد تعديلات بعد — كن أول من ينشر!',
  'mods.error': 'تعذّر الوصول إلى مستودع التعديلات حالياً.',
  'mods.by': 'بواسطة {author}',
  'mods.downloads': '{n} تنزيل',
  'mods.noRating': 'لم يُقيَّم بعد',
  'mods.download': 'تنزيل',
  'mods.downloading': 'جارٍ التنزيل…',
  'mods.downloadLimit': 'وصلت لحد التنزيل — حاول مرة أخرى بعد دقيقة.',
  'mods.downloadError': 'فشل التنزيل. حاول مرة أخرى.',
  'media.title': 'شاهدها أثناء اللعب',
  'media.battle': 'منظر المعركة',
  'media.mod': 'ضبط التعديلات',
  'media.online': 'قاعة اللعب',
  'footer.desc': 'لعبة استراتيجية مفتوحة المصدر. أبلغ عن المشاكل على GitHub.',
  'footer.rights': 'صُنعت بحب ♪ — العب، عدّل، شارك.',
  'lang.other': 'English',
}

const LANGS = { en: EN, ar: AR }

const t = (lang, key, vars) => {
  let s = LANGS[lang][key] ?? EN[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

const resolvedLang = () => {
  const param = new URLSearchParams(window.location.search).get('lang')
  if (param === 'en' || param === 'ar') return param
  const saved = localStorage.getItem(LANG_KEY)
  if (saved === 'en' || saved === 'ar') return saved
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

let lang = resolvedLang()

const setLang = (next) => {
  lang = next
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n')
    if (key) el.textContent = t(lang, key)
  }
  const toggle = document.getElementById('lang-toggle')
  if (toggle) toggle.textContent = t(lang, 'lang.other')
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* private mode */
  }
  loadTopMods()
}

const starsFor = (avg) => {
  if (avg === null || avg === undefined) return null
  const n = Math.round(avg)
  return '\u2605'.repeat(n) + '\u2606'.repeat(5 - n)
}

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US') : String(n))

const loadTopMods = async () => {
  const row = document.getElementById('top-mods')
  if (!row) return
  setModsNote('')
  row.innerHTML = `<p class="mods-empty">${t(lang, 'mods.loading')}</p>`
  let data = null
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
    if (cached && Date.now() - cached.at < TOP_MODS_TTL_MS) {
      data = cached.data
    }
  } catch {
    /* ignore bad cache */
  }
  if (data === null) {
    try {
      const res = await fetch(`${SA_ONLINE_URL}/api/mods/repo?sort=rating&limit=5`, { headers: { Accept: 'application/json' } })
      const body = await res.json()
      if (res.ok && Array.isArray(body.mods)) {
        data = body.mods
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }))
        } catch {
          /* storage full / private mode */
        }
      }
    } catch {
      /* network error handled below */
    }
  }
  if (data === null) {
    row.innerHTML = `<p class="mods-empty">${t(lang, 'mods.error')}</p>`
    return
  }
  if (!Array.isArray(data) || data.length === 0) {
    row.innerHTML = `<p class="mods-empty">${t(lang, 'mods.empty')}</p>`
    return
  }
  row.innerHTML = data
    .map((m) => {
      const stars = starsFor(m.ratingAvg)
      const ratingLine =
        stars !== null
          ? `<span class="stars" title="${m.ratingAvg} / 5">${stars}</span> <span>${m.ratingAvg} / 5</span>`
          : `<span class="mod-meta">${t(lang, 'mods.noRating')}</span>`
      return (
        `<article class="mod-card">` +
        `<h3>${escapeHtml(m.name)}</h3>` +
        `<div class="mod-meta">${t(lang, 'mods.by', { author: escapeHtml(m.author || '—') })}</div>` +
        (m.description ? `<div class="mod-desc">${escapeHtml(m.description)}</div>` : '') +
        `<div class="mod-line">${ratingLine}<span class="mod-downloads">\u2B07 ${t(lang, 'mods.downloads', { n: fmt(m.downloads) })}</span></div>` +
        `<button class="mod-download" type="button" data-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}">\u2B07 ${t(lang, 'mods.download')}</button>` +
        `</article>`
      )
    })
    .join('')
}

const safeFileName = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'mod'

const setModsNote = (text) => {
  const note = document.getElementById('mods-note')
  if (!note) return
  if (text) {
    note.textContent = text
    note.hidden = false
  } else {
    note.hidden = true
  }
}

/** Fetches a mod's JSON from the Render API and saves it as `<name>.json`.
 *  Downloads bump the server counter and are rate-limited server-side (429 → hint). */
const downloadMod = async (btn) => {
  const id = btn.dataset.id
  const name = btn.dataset.name
  if (!id) return
  btn.disabled = true
  const prev = btn.textContent
  btn.textContent = t(lang, 'mods.downloading')
  setModsNote('')
  try {
    const res = await fetch(`${SA_ONLINE_URL}/api/mods/${encodeURIComponent(id)}`)
    if (res.status === 429) {
      setModsNote(t(lang, 'mods.downloadLimit'))
      return
    }
    if (!res.ok) throw new Error(String(res.status))
    const blob = new Blob([await res.text()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeFileName(name)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch {
    setModsNote(t(lang, 'mods.downloadError'))
  } finally {
    btn.disabled = false
    btn.textContent = prev
  }
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

document.addEventListener('DOMContentLoaded', () => {
  setLang(lang)
  document.getElementById('lang-toggle')?.addEventListener('click', () => setLang(lang === 'en' ? 'ar' : 'en'))
  const row = document.getElementById('top-mods')
  row?.addEventListener('click', (ev) => {
    const btn = ev.target?.closest?.('.mod-download')
    if (btn && row.contains(btn)) void downloadMod(btn)
  })
})