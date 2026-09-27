/* Space Arenas — landing page (GitHub Pages).
 * i18n EN/AR toggle (localStorage + ?lang=), account login/register, and a
 * login-gated community section: browse / rate / download / publish balance mods
 * against the Render API. Short TTL cache for the mod list keeps API traffic low.
 */

// The public Render API. Set this to your deployed service origin.
const SA_ONLINE_URL = 'https://space-arenas-online.onrender.com'

const CACHE_KEY = 'sa-modlist-cache-v1'
const AUTH_KEY = 'sa-auth'
const LANG_KEY = 'sa-lang'
const MODS_TTL_MS = 5 * 60 * 1000

const EN = {
  brand: 'Space Arenas',
  'nav.home': 'Home',
  'nav.features': 'Features',
  'nav.howto': 'How to join',
  'nav.community': 'Community',
  'nav.repo': 'Source',
  'hero.badge': 'Real-time strategy in space',
  'hero.title': 'Command your fleet on maps that fight back.',
  'hero.subtitle': 'Build your base, harvest resources, and out-think your rivals with tactical airstrikes, stealth, mines and more — solo or online with friends.',
  'hero.ctaRepo': 'Get the game',
  'hero.ctaCommunity': 'Browse community mods',
  'home.teaserTitle': 'Space Arenas in short',
  'home.teaserFeatures': 'Classic RTS core with fog of war, stealth, day/night and a veteran system — all moddable.',
  'home.teaserHowto': 'Clone the repo, make a free account and start playing straight in your browser.',
  'home.teaserCommunity': 'Browse, rate and download balance mods — or publish your own for everyone.',
  'home.moreFeatures': 'Explore the features',
  'home.moreHowto': 'See how to join',
  'features.title': 'Built for deep, readable battles',
  'features.subtitle': 'Everything that makes Space Arenas worth your time.',
  'features.rts.title': 'Classic RTS core',
  'features.rts.text': 'Harvesters, supply fields, tech trees and a veteran system — all rendered on an infinite hexes canvas.',
  'features.fog.title': 'Fog, day & night',
  'features.fog.text': 'Dynamic line-of-sight, stealth units and a full day/night cycle change how you scout and strike.',
  'features.mods.title': 'Balance mods',
  'features.mods.text': 'Tune the economy, units and weapons with downloadable mod files — then share them in the community repository.',
  'features.online.title': 'Online lobbies',
  'features.online.text': 'Create password-protected rooms, search open matches and climb the global leaderboard with a free account.',
  'howto.title': 'Join in three steps',
  'howto.st1.title': 'Get the game',
  'howto.st1.text': 'Clone the repository and run run-game.bat — no install required, it runs straight in your browser.',
  'howto.st2.title': 'Make an account',
  'howto.st2.text': 'Sign up in the online lobby to unlock the leaderboard, data backups and the mod repository.',
  'howto.st3.title': 'Play & share',
  'howto.st3.text': 'Create or join a room, pick a balance mod, and carry your progress anywhere with encrypted backups.',
  'community.title': 'Community mods',
  'community.subtitle': 'Browse, rate and download balance mods — or publish your own.',
  'community.needLogin': 'Sign in to browse, rate, download and share community mods.',
  'community.by': 'by @{name}',
  'community.downloads': '{n} downloads',
  'community.noRating': 'not rated yet',
  'community.rating': '{avg} / 5 ({c})',
  'community.loading': 'Loading…',
  'community.empty': 'No mods published yet — be the first!',
  'community.error': 'Could not load the mod repository.',
  'community.download': 'Download',
  'community.downloading': 'Downloading…',
  'community.downloadLimit': 'Download limit reached — try again in a minute.',
  'community.downloadError': 'Download failed. Please try again.',
  'community.rateOk': 'Thanks — rated {n} / 5.',
  'community.rateFail': 'Could not save the rating. Please try again.',
  'community.upload.title': 'Share a mod',
  'community.upload.hint': 'Pick a balance mod file you exported, write a short description and publish it for everyone. Only you can delete your own mods.',
  'community.upload.descPlaceholder': 'Short description… (up to 160 characters)',
  'community.upload.button': 'Publish',
  'community.upload.working': 'Publishing…',
  'community.upload.ok': 'Mod published to the repository.',
  'community.upload.needDesc': 'Write a short description first.',
  'community.upload.needFile': 'Choose a mod file first.',
  'community.upload.fail': 'Could not publish the mod.',
  'auth.signin': 'Sign in',
  'auth.signout': 'Sign out',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.username': 'Username',
  'auth.toRegister': 'Create an account',
  'auth.toLogin': 'Already have an account? Sign in',
  'auth.working': 'Please wait…',
  'auth.invalid': 'Fill in the email, password and username.',
  'auth.loginFail': 'Wrong email or password.',
  'auth.registerFail': 'Could not create the account — maybe that username or email is taken.',
  'auth.network': 'Could not reach the server.',
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
  'nav.home': 'الرئيسية',
  'nav.features': 'المميزات',
  'nav.howto': 'كيف تلعب',
  'nav.community': 'المجتمع',
  'nav.repo': 'المصدر',
  'hero.badge': 'استراتيجية في الزمن الحقيقي في الفضاء',
  'hero.title': 'قُد أسطولك في خرائط تقاومك.',
  'hero.subtitle': 'ابنِ قاعدتك، اجمع الموارد، وتفوق على خصومك بالغارات التكتيكية، والتخفي، والألغام والمزيد — منفرداً أو عبر الإنترنت مع أصدقائك.',
  'hero.ctaRepo': 'حمّل اللعبة',
  'hero.ctaCommunity': 'تصفح تعديلات المجتمع',
  'home.teaserTitle': 'ساحات الفضاء باختصار',
  'home.teaserFeatures': 'جوهر استراتيجية كلاسيكي مع ضباب الحرب والتخفي والليل والنهار ونظام خبرة — وكل شيء قابل للتعديل.',
  'home.teaserHowto': 'انسخ المستودع، أنشئ حساباً مجانياً وابدأ اللعب مباشرة في متصفحك.',
  'home.teaserCommunity': 'تصفح وقيّم وحمّل تعديلات التوازن — أو انشر تعديلك للجميع.',
  'home.moreFeatures': 'اكتشف المميزات',
  'home.moreHowto': 'شاهد كيفية الانضمام',
  'features.title': 'مصممة لمعارك عميقة وواضحة',
  'features.subtitle': 'كل ما يجعل ساحات الفضاء تستحق وقتك.',
  'features.rts.title': 'جوهر استراتيجية كلاسيكي',
  'features.rts.text': 'حصادات، حقول إمداد، شجرات تقنية ونظام خبرة قدامى — كل ذلك على لوحة سداسية لا نهائية.',
  'features.fog.title': 'ضباب، ليل ونهار',
  'features.fog.text': 'خط رؤية ديناميكي، وحدات متخفية ودورة كاملة ليل/نهار تغيّر طريقة استطلاعك وهجومك.',
  'features.mods.title': 'تعديلات التوازن',
  'features.mods.text': 'اضبط الاقتصاد والوحدات والأسلحة بملفات تعديل قابلة للتنزيل — ثم شاركها في مستودع المجتمع.',
  'features.online.title': 'قاعات على الإنترنت',
  'features.online.text': 'أنشئ قاعات محمية بكلمة مرور، ابحث عن المباريات المفتوحة وارتقِ في لوحة المتصدرين العالمية بحساب مجاني.',
  'howto.title': 'انضم في ثلاث خطوات',
  'howto.st1.title': 'حمّل اللعبة',
  'howto.st1.text': 'انسخ المستودع وشغّل run-game.bat — لا حاجة لأي تثبيت، تعمل مباشرة في متصفحك.',
  'howto.st2.title': 'أنشئ حساباً',
  'howto.st2.text': 'سجّل في قاعة اللعب لفتح لوحة المتصدرين والنسخ الاحتياطية ومستودع التعديلات.',
  'howto.st3.title': 'العب وشارك',
  'howto.st3.text': 'أنشئ قاعة أو انضم إليها، اختر تعديل توازن، وانقل تقدمك أينما كنت بنسخ احتياطية مشفرة.',
  'community.title': 'تعديلات المجتمع',
  'community.subtitle': 'تصفّح وقيّم وحمّل تعديلات التوازن — أو انشر تعديلاً من عندك.',
  'community.needLogin': 'سجّل الدخول لتصفّح وقيّم وتنزّل وتشارك تعديلات المجتمع.',
  'community.by': 'بواسطة @{name}',
  'community.downloads': '{n} تنزيل',
  'community.noRating': 'لم يُقيَّم بعد',
  'community.rating': '{avg} / 5 ({c})',
  'community.loading': 'جارٍ التحميل…',
  'community.empty': 'لا توجد تعديلات بعد — كن أول من ينشر!',
  'community.error': 'تعذّر تحميل مستودع التعديلات.',
  'community.download': 'تنزيل',
  'community.downloading': 'جارٍ التنزيل…',
  'community.downloadLimit': 'وصلت لحد التنزيل — حاول مرة أخرى بعد دقيقة.',
  'community.downloadError': 'فشل التنزيل. حاول مرة أخرى.',
  'community.rateOk': 'شكراً — تم التقييم {n} / 5.',
  'community.rateFail': 'تعذّر حفظ التقييم. حاول مرة أخرى.',
  'community.upload.title': 'شارك تعديلاً',
  'community.upload.hint': 'اختر ملف تعديل صدرته من اللعبة، اكتب وصفاً قصيراً وانشره للجميع. لا يمكنك حذف تعديلاتك إلا أنت.',
  'community.upload.descPlaceholder': 'وصف قصير… (حتى 160 حرفاً)',
  'community.upload.button': 'نشر',
  'community.upload.working': 'جارٍ النشر…',
  'community.upload.ok': 'تم نشر التعديل في المستودع.',
  'community.upload.needDesc': 'اكتب وصفاً قصيراً أولاً.',
  'community.upload.needFile': 'اختر ملف تعديل أولاً.',
  'community.upload.fail': 'تعذّر نشر التعديل.',
  'auth.signin': 'تسجيل الدخول',
  'auth.signout': 'تسجيل الخروج',
  'auth.email': 'البريد الإلكتروني',
  'auth.password': 'كلمة المرور',
  'auth.username': 'اسم المستخدم',
  'auth.toRegister': 'إنشاء حساب',
  'auth.toLogin': 'لديك حساب بالفعل؟ سجّل الدخول',
  'auth.working': 'الرجاء الانتظار…',
  'auth.invalid': 'املأ البريد الإلكتروني وكلمة المرور واسم المستخدم.',
  'auth.loginFail': 'بريد إلكتروني أو كلمة مرور خاطئة.',
  'auth.registerFail': 'تعذّر إنشاء الحساب — ربما اسم المستخدم أو البريد موجود بالفعل.',
  'auth.network': 'تعذّر الوصول إلى الخادم.',
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
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(lang, el.getAttribute('data-i18n-placeholder'))
  }
  const toggle = document.getElementById('lang-toggle')
  if (toggle) toggle.textContent = t(lang, 'lang.other')
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* private mode */
  }
  loadCommunity()
}

/* ---------------- account / session ---------------- */

const state = { token: null, username: '', email: '', userId: '' }

let authMode = 'login' // 'login' | 'register'

const saveAuth = () => {
  try {
    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({ token: state.token, username: state.username, email: state.email, userId: state.userId }),
    )
  } catch {
    /* private mode */
  }
}

const clearAuth = () => {
  try {
    localStorage.removeItem(AUTH_KEY)
  } catch {
    /* private mode */
  }
}

const api = async (path, { method = 'GET', body, token } = {}) => {
  const headers = { Accept: 'application/json' }
  const options = { method, headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    options.body = body
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${SA_ONLINE_URL}${path}`, options)
  let j = null
  try {
    j = await res.json()
  } catch {
    /* empty body */
  }
  return { ok: res.ok, status: res.status, body: j }
}

const restoreSession = async () => {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return
    const s = JSON.parse(raw)
    if (!s.token) return
    state.token = s.token
    state.username = s.username ?? ''
    state.email = s.email ?? ''
    state.userId = s.userId ?? ''
    try {
      const me = await api('/api/auth/me', { token: s.token })
      if (me.ok && me.body?.ok && me.body?.data) {
        state.username = me.body.data.username ?? state.username
        state.userId = me.body.data.userId ?? state.userId
        state.email = me.body.data.email ?? state.email
        saveAuth()
      } else {
        clearAuth()
        state.token = null
      }
    } catch {
      /* offline — keep the stored session for now */
    }
  } catch {
    clearAuth()
    state.token = null
  }
  updateAuthUI()
  if (state.token) void loadCommunity(true)
}

const signOut = () => {
  clearAuth()
  state.token = null
  state.username = ''
  state.email = ''
  state.userId = ''
  updateAuthUI()
}

/* ---------------- UI wiring ---------------- */

const updateAuthUI = () => {
  const loggedIn = Boolean(state.token)
  const flash = (id, show) => {
    const el = document.getElementById(id)
    if (el) el.hidden = !show
  }
  flash('nav-community', loggedIn)
  flash('auth-user', loggedIn)
  flash('btn-signout', loggedIn)
  flash('btn-signin', !loggedIn)
  flash('hero-login', !loggedIn)
  flash('community-login-prompt', !loggedIn)
  flash('community-content', loggedIn)
  const userEl = document.getElementById('auth-user')
  if (userEl && loggedIn) {
    userEl.textContent = state.username ? t(lang, 'community.by', { name: state.username }).replace(/^by\s+|^بواسطة\s+/, '') : ''
  }
}

const openAuth = (mode, focus) => {
  authMode = mode
  const overlay = document.getElementById('auth-overlay')
  const title = document.getElementById('auth-title')
  const usernameEl = document.getElementById('auth-username')
  const submit = document.getElementById('auth-submit')
  const toggle = document.getElementById('auth-toggle-mode')
  const error = document.getElementById('auth-error')
  overlay.hidden = false
  title.textContent = t(lang, mode === 'login' ? 'auth.signin' : 'auth.toRegister')
  usernameEl.hidden = mode !== 'register'
  submit.textContent = t(lang, mode === 'login' ? 'auth.signin' : 'auth.toRegister')
  toggle.textContent = t(lang, mode === 'login' ? 'auth.toRegister' : 'auth.toLogin')
  error.hidden = true
  if (focus) focus.focus()
}

const closeAuth = () => {
  document.getElementById('auth-overlay').hidden = true
}

const authError = (text) => {
  const el = document.getElementById('auth-error')
  el.textContent = text
  el.hidden = false
}

const submitAuth = async (ev) => {
  ev.preventDefault()
  const email = document.getElementById('auth-email').value.trim()
  const password = document.getElementById('auth-password').value
  const username = document.getElementById('auth-username').value.trim()
  const submit = document.getElementById('auth-submit')
  if (authMode === 'login' && (!email || !password)) {
    authError(t(lang, 'auth.loginFail'))
    return
  }
  if (authMode === 'register' && (!email || !password || !username)) {
    authError(t(lang, 'auth.invalid'))
    return
  }
  const prev = submit.textContent
  submit.textContent = t(lang, 'auth.working')
  submit.disabled = true
  try {
    if (authMode === 'register') {
      const reg = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, username }),
      })
      if (!reg.ok) {
        authError(t(lang, 'auth.registerFail'))
        return
      }
    }
    const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    if (!login.ok || !login.body?.data?.token) {
      authError(t(lang, authMode === 'login' ? 'auth.loginFail' : 'auth.registerFail'))
      return
    }
    const d = login.body.data
    state.token = d.token
    state.username = d.username ?? username
    state.email = d.email ?? email
    state.userId = d.userId ?? ''
    saveAuth()
    closeAuth()
    document.getElementById('auth-password').value = ''
    document.getElementById('auth-username').value = ''
    updateAuthUI()
    void loadCommunity(true)
  } catch {
    authError(t(lang, 'auth.network'))
  } finally {
    submit.textContent = prev
    submit.disabled = false
  }
}

/* ---------------- community mods ---------------- */

const modsEl = () => document.getElementById('community-grid')
const statusEl = () => document.getElementById('community-status')

const starsFor = (avg) => {
  if (avg === null || avg === undefined) return null
  const n = Math.round(avg)
  return '\u2605'.repeat(n) + '\u2606'.repeat(5 - n)
}

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US') : String(n))

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const safeFileName = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'mod'

const setStatus = (text, isError = false) => {
  const el = statusEl()
  if (!el) return
  el.textContent = text
  el.classList.toggle('error', isError)
}

const loadCommunity = async (force = false) => {
  updateAuthUI()
  if (!state.token) return
  const grid = modsEl()
  if (!grid) return
  grid.innerHTML = `<p class="mods-empty">${t(lang, 'community.loading')}</p>`
  let data = null
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
      if (cached && Date.now() - cached.at < MODS_TTL_MS) data = cached.data
    } catch {
      /* ignore bad cache */
    }
  }
  if (data === null) {
    try {
      const res = await fetch(`${SA_ONLINE_URL}/api/mods/repo?sort=rating&limit=250`, {
        headers: { Accept: 'application/json' },
      })
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
      /* handled below */
    }
  }
  if (data === null) {
    grid.innerHTML = `<p class="mods-empty">${t(lang, 'community.error')}</p>`
    return
  }
  if (!Array.isArray(data) || data.length === 0) {
    grid.innerHTML = `<p class="mods-empty">${t(lang, 'community.empty')}</p>`
    return
  }
  grid.innerHTML = data.map(fmtCard).join('')
}

const fmtCard = (m) => {
  const stars = starsFor(m.ratingAvg)
  const ratingLine =
    stars !== null
      ? `<span class="stars" title="${m.ratingAvg} / 5">${stars}</span> <span>${t(lang, 'community.rating', { avg: m.ratingAvg, c: m.ratingCount })}</span>`
      : `<span class="mod-meta">${t(lang, 'community.noRating')}</span>`
  const rateRow =
    `<span class="rate-row">` +
    [1, 2, 3, 4, 5]
      .map((n) => `<button type="button" class="rate-star" data-id="${escapeHtml(m.id)}" data-n="${n}" aria-label="${n}">\u2605</button>`)
      .join('') +
    `</span>`
  const byName = m.ownerName ? m.ownerName : m.author ? m.author : '?'
  return (
    `<article class="card mod-card">` +
    `<h3>${escapeHtml(m.name)}</h3>` +
    `<div class="mod-meta">${t(lang, 'community.by', { name: escapeHtml(byName) })}</div>` +
    (m.description ? `<div class="mod-desc">${escapeHtml(m.description)}</div>` : '') +
    `<div class="mod-line">${ratingLine}<span class="mod-downloads">\u2B07 ${t(lang, 'community.downloads', { n: fmt(m.downloads) })}</span></div>` +
    `<div class="mod-actions">` +
    `<button class="mod-download" type="button" data-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}">\u2B07 ${t(lang, 'community.download')}</button>` +
    rateRow +
    `</div>` +
    `</article>`
  )
}

/** Fetches a mod's JSON from the Render API and saves it as `<name>.json`.
 *  Downloads bump the server counter and are rate-limited server-side (429 → hint). */
const downloadMod = async (btn) => {
  const id = btn.dataset.id
  const name = btn.dataset.name
  if (!id) return
  btn.disabled = true
  const prev = btn.textContent
  btn.textContent = t(lang, 'community.downloading')
  try {
    const res = await fetch(`${SA_ONLINE_URL}/api/mods/${encodeURIComponent(id)}`)
    if (res.status === 429) {
      setStatus(t(lang, 'community.downloadLimit'), true)
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
    setStatus(t(lang, 'community.downloadError'), true)
  } finally {
    btn.disabled = false
    btn.textContent = prev
  }
}

const rateMod = async (id, n) => {
  if (!state.token) return
  const res = await api(`/api/mods/${encodeURIComponent(id)}/rate`, {
    method: 'POST',
    token: state.token,
    body: JSON.stringify({ rating: n }),
  })
  if (!res.ok || !res.body?.ok) {
    setStatus(t(lang, 'community.rateFail'), true)
    return
  }
  setStatus(t(lang, 'community.rateOk', { n }))
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* private mode */
  }
  void loadCommunity(true)
}

const uploadMod = async () => {
  const fileEl = document.getElementById('community-file')
  const descEl = document.getElementById('community-desc')
  const file = fileEl.files?.[0]
  const desc = descEl.value.trim()
  if (!file) {
    setStatus(t(lang, 'community.upload.needFile'), true)
    return
  }
  if (!desc) {
    setStatus(t(lang, 'community.upload.needDesc'), true)
    return
  }
  const uploadBtn = document.getElementById('community-upload')
  const prev = uploadBtn.textContent
  uploadBtn.textContent = t(lang, 'community.upload.working')
  uploadBtn.disabled = true
  try {
    const text = await file.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      setStatus(t(lang, 'community.upload.fail'), true)
      return
    }
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      payload.meta = { ...(payload.meta ?? {}), description: desc }
    }
    const res = await api('/api/mods', {
      method: 'POST',
      token: state.token,
      body: JSON.stringify(payload),
    })
    if (!res.ok || !res.body?.ok) {
      setStatus(res.body?.error ?? t(lang, 'community.upload.fail'), true)
      return
    }
    fileEl.value = ''
    descEl.value = ''
    setStatus(t(lang, 'community.upload.ok'))
    try {
      localStorage.removeItem(CACHE_KEY)
    } catch {
      /* private mode */
    }
    void loadCommunity(true)
  } catch {
    setStatus(t(lang, 'community.upload.fail'), true)
  } finally {
    uploadBtn.textContent = prev
    uploadBtn.disabled = false
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const currentPage = (window.location.pathname.split('/').pop() || 'index.html').split('?')[0]
  for (const a of document.querySelectorAll('.nav a[data-page]')) {
    if (a.getAttribute('data-page') === currentPage) a.classList.add('active')
  }

  setLang(lang)
  void restoreSession()

  document.getElementById('lang-toggle')?.addEventListener('click', () => setLang(lang === 'en' ? 'ar' : 'en'))
  document.getElementById('btn-signin')?.addEventListener('click', () => openAuth('login'))
  document.getElementById('btn-signout')?.addEventListener('click', signOut)
  document.getElementById('hero-login')?.addEventListener('click', () => openAuth('login'))
  document.getElementById('community-login-cta')?.addEventListener('click', () => openAuth('login'))
  document.getElementById('auth-close')?.addEventListener('click', closeAuth)
  document.getElementById('auth-overlay')?.addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) closeAuth()
  })
  document.getElementById('auth-toggle-mode')?.addEventListener('click', () => {
    openAuth(authMode === 'login' ? 'register' : 'login')
  })
  document.getElementById('auth-form')?.addEventListener('submit', (ev) => void submitAuth(ev))

  const grid = document.getElementById('community-grid')
  grid?.addEventListener('click', (ev) => {
    const btn = ev.target?.closest?.(`button[data-n]`)
    if (btn && grid.contains(btn)) {
      void rateMod(btn.dataset.id, Number(btn.dataset.n))
      return
    }
    const dl = ev.target?.closest?.('.mod-download')
    if (dl && grid.contains(dl)) void downloadMod(dl)
  })

  document.getElementById('community-upload')?.addEventListener('click', () => void uploadMod())
})