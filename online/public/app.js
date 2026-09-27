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
  'features.units.title': 'The unit roster',
  'features.units.subtitle': 'Every unit from the game, with its role, stats and weapons.',
  'u.none': 'Sprite in development',
  'feat.group.core': 'Core gameplay',
  'feat.group.vision': 'Vision & combat',
  'feat.group.tech': 'Progression & tech',
  'feat.group.maps': 'Maps & content',
  'feat.group.online': 'Online & fairness',
  'feat.eco.title': 'Dual-resource economy',
  'feat.eco.text': 'Two resources run your base: Supplies (income from Harvesters and fields) and Power (generated by plants, consumed by buildings). Run a deficit and production shuts down.',
  'feat.build.title': 'Construction & repair',
  'feat.build.text': 'Bulldozers place and repair buildings. New buildings are vulnerable while being built, so timing matters.',
  'feat.supply.title': 'Supply & oil economies',
  'feat.supply.text': 'Harvesters ferry supply from fields to your Supply Dock for credits. Oil fields add a second income source worth fighting over.',
  'feat.fog.title': 'Fog of war',
  'feat.fog.text': 'Three fog modes (memory, classic, hard) plus satellites, scouts and line-of-sight decide what either side can see.',
  'feat.stealth.title': 'Stealth & detection',
  'feat.stealth.text': 'Stealth tech hides your units, mines punish pushes, and detectors plus smoke keep the battlefield readable.',
  'feat.weather.title': 'Day/night & weather',
  'feat.weather.text': 'A full day/night cycle with rain, snow and thunderstorms changes the mood and readability of every map.',
  'feat.combat.title': 'Deep combat',
  'feat.combat.text': 'Turrets and bunkers, AA platforms, artillery splash, sea missiles, fighter strikes and Super Weapons — the full weapon table ships in the catalog.',
  'feat.tech.title': 'Tech tree & upgrades',
  'feat.tech.text': 'Twelve research steps from Radar and Satellite to Mine Tech, Grenades & Smoke, the Defense Dome and rank-gated Super Weapons.',
  'feat.veterancy.title': 'Veterancy & ranks',
  'feat.veterancy.text': 'Units gain veterancy in battle while players earn XP, levels and commander ranks (★) that gate the strongest research.',
  'feat.super.title': 'Super weapons',
  'feat.super.text': 'The orbital Space Laser, a 4-bomber Airstrike and a base-wide EMP — powerful, visible and on cooldown.',
  'feat.maps.title': 'Maps & map builder',
  'feat.maps.text': 'Procedural maps plus a built-in editor: paint ground and water, place spawns, supply and oil fields, then import or export.',
  'feat.airnav.title': 'Air & naval warfare',
  'feat.airnav.text': 'Fighters fly over anything, strike and return to the Air Force to re-arm; Carriers and APCs move whole armies across open water.',
  'feat.modes.title': 'Bots, teams & spawns',
  'feat.modes.text': 'Offline Bots Match or up to 8-player rooms online — play Free-for-All or teams and assign every player a spawn.',
  'feat.lobbies.title': 'Online lobbies',
  'feat.lobbies.text': 'Create password-protected rooms, search open matches and play friendly or ranked games on the live server.',
  'feat.replay.title': 'Replays & backups',
  'feat.replay.text': 'Deterministic lockstep lets you save any match as a local replay file, and encrypted backups carry your progress anywhere.',
  'feat.mods.title': 'Balance mods',
  'feat.mods.text': 'Tune the economy, units and weapons with JSON mod files, then publish them to the community repository with ratings and downloads.',
  'feat.fairplay.title': 'Fair play',
  'feat.fairplay.text': 'Settings are verified on ranked matches, tampered clients get flagged, and replay files keep every match accountable.',
  'howto.catalog.title': 'The game catalog',
  'howto.catalog.subtitle': 'Buildings, units, weapons and upgrades — the full roster exactly as shipped.',
  'cat.buildings': 'Buildings',
  'cat.units': 'Units',
  'cat.weapons': 'Weapons',
  'cat.upgrades': 'Upgrades',
  'cls.infantry': 'Infantry',
  'cls.vehicle': 'Vehicle',
  'cls.air': 'Air',
  'cls.naval': 'Naval',
  'st.cost': 'Cost',
  'st.hp': 'HP',
  'st.vision': 'Vision',
  'st.speed': 'Speed',
  'st.build': 'Build',
  'st.prod': 'Produced by',
  'st.weapon': 'Weapon',
  'st.power': 'Power',
  'st.capacity': 'Capacity',
  'st.ammo': 'Ammo',
  'st.garrison': 'Garrison',
  's.range': 'Range',
  's.cooldown': 'Cooldown',
  's.splash': 'splash',
  's.antiAir': 'anti-air',
  's.sec': 's',
  's.rank': 'Rank {n}',
  's.rankAny': 'Any',
  'w.dmgLbl': 'dmg',
  'w.th.weapon': 'Weapon',
  'w.th.dmg': 'Damage',
  'w.th.range': 'Range',
  'w.th.cd': 'Cooldown',
  'w.th.notes': 'Notes',
  'u.th.name': 'Research',
  'u.th.cost': 'Cost',
  'u.th.time': 'Research time',
  'u.th.at': 'Building',
  'u.th.rank': 'Rank',
  'cat.units.bulldozer.name': 'Bulldozer',
  'cat.units.bulldozer.role': 'Builds and repairs your base and buildings.',
  'cat.units.harvester.name': 'Harvester',
  'cat.units.harvester.role': 'Gathers supply from fields and banks credits.',
  'cat.units.scout.name': 'Scout',
  'cat.units.scout.role': 'Fast, long-vision recon that reveals the map, spots enemy movement, and claims oil fields.',
  'cat.units.rifleman.name': 'Rifleman',
  'cat.units.rifleman.role': 'Reliable all-round infantry shooter.',
  'cat.units.rocket-trooper.name': 'Rocket Trooper',
  'cat.units.rocket-trooper.role': 'Heavy anti-armour rocket damage.',
  'cat.units.assault-walker.name': 'Assault Walker',
  'cat.units.assault-walker.role': 'Tough frontline vehicle with a cannon.',
  'cat.units.aa-platform.name': 'Anti-Air Platform',
  'cat.units.aa-platform.role': 'Anti-air defence platform.',
  'cat.units.artillery.name': 'Artillery',
  'cat.units.artillery.role': 'Long-range splash-damage bombardments.',
  'cat.units.engineer.name': 'Engineer',
  'cat.units.engineer.role': 'Repairs buildings and constructs structures.',
  'cat.units.apc.name': 'APC',
  'cat.units.apc.role': 'Armoured transport that carries infantry into the fight.',
  'cat.units.fighter.name': 'Fighter',
  'cat.units.fighter.role': 'Ghost fighter: flies over anything, strikes once, then returns to the Air Force to reload.',
  'cat.units.carrier.name': 'Carrier',
  'cat.units.carrier.role': 'Armoured troop transport that carries infantry across open water.',
  'cat.units.missile-boat.name': 'Missile Boat',
  'cat.units.missile-boat.role': 'Fast warship firing sea missiles that splash ground and naval targets — never aircraft.',
  'cat.buildings.command-center.name': 'Command Center',
  'cat.buildings.command-center.desc': 'Your base — generates power, trains Bulldozers and houses the Radar upgrade.',
  'cat.buildings.power-plant.name': 'Power Plant',
  'cat.buildings.power-plant.desc': 'Generates +50 power to keep your base running.',
  'cat.buildings.supply-dock.name': 'Supply Dock',
  'cat.buildings.supply-dock.desc': 'Builds Harvesters and banks the supply they gather.',
  'cat.buildings.barracks.name': 'Barracks',
  'cat.buildings.barracks.desc': 'Trains infantry: Scouts, Riflemen and Rocket Troopers.',
  'cat.buildings.war-factory.name': 'War Factory',
  'cat.buildings.war-factory.desc': 'Builds vehicles — from Assault Walkers to the Engineer and APC.',
  'cat.buildings.turret.name': 'Turret',
  'cat.buildings.turret.desc': 'Static defense that fires at ground and air targets.',
  'cat.buildings.tech-center.name': 'Tech Center',
  'cat.buildings.tech-center.desc': 'Unlocks the tech tree: radar, stealth, defenses and upgrades.',
  'cat.buildings.air-force.name': 'Air Force',
  'cat.buildings.air-force.desc': 'Builds Fighters and re-arms them between sorties.',
  'cat.buildings.super-weapon.name': 'Super Weapon',
  'cat.buildings.super-weapon.desc': 'Unlocks rank-3 power: Space Laser, Airstrike Payload and EMP.',
  'cat.buildings.bunker.name': 'Bunker',
  'cat.buildings.bunker.desc': 'Garrisonable defense that fires on attackers.',
  'cat.buildings.dock.name': 'Dock',
  'cat.buildings.dock.desc': 'Naval yard that builds Carriers and Missile Boats.',
  'cat.weapons.rifle.name': 'Rifle',
  'cat.weapons.rifle.desc': 'All-purpose rifle round.',
  'cat.weapons.rocket.name': 'Rocket',
  'cat.weapons.rocket.desc': 'Heavy anti-armour rocket.',
  'cat.weapons.cannon.name': 'Cannon',
  'cat.weapons.cannon.desc': 'Shells fired from tracked and walker vehicles.',
  'cat.weapons.aa.name': 'Anti-Air gun',
  'cat.weapons.aa.desc': 'Rapid anti-air cannon.',
  'cat.weapons.artillery.name': 'Artillery gun',
  'cat.weapons.artillery.desc': 'Long-range explosive shell with splash damage.',
  'cat.weapons.turret-gun.name': 'Turret gun',
  'cat.weapons.turret-gun.desc': 'Dual-purpose turret fire.',
  'cat.weapons.bunker-gun.name': 'Bunker gun',
  'cat.weapons.bunker-gun.desc': 'Garrison bunker fire.',
  'cat.weapons.air-cannon.name': 'Air cannon',
  'cat.weapons.air-cannon.desc': 'Fighter strike cannon.',
  'cat.weapons.sea-missile.name': 'Sea missile',
  'cat.weapons.sea-missile.desc': 'Missiles that splash ground and naval targets — never aircraft.',
  'cat.upgrades.radar.name': 'Radar',
  'cat.upgrades.radar.desc': 'Reveals a wide area around the Command Center.',
  'cat.upgrades.satellite.name': 'Satellite',
  'cat.upgrades.satellite.desc': 'Periodically reveals the whole map.',
  'cat.upgrades.space-laser.name': 'Space Laser',
  'cat.upgrades.space-laser.desc': 'Orbital strike that deals massive damage where you aim.',
  'cat.upgrades.stealth-tech.name': 'Stealth Tech',
  'cat.upgrades.stealth-tech.desc': 'Enables stealth on select units.',
  'cat.upgrades.detector-upgrade.name': 'Detector Upgrade',
  'cat.upgrades.detector-upgrade.desc': 'Improves detector range to spot stealth.',
  'cat.upgrades.mine-tech.name': 'Mine Tech',
  'cat.upgrades.mine-tech.desc': 'Lay mines to punish advancing enemies.',
  'cat.upgrades.abilities-tech.name': 'Grenades & Smoke',
  'cat.upgrades.abilities-tech.desc': 'Unlocks grenades and smoke for ground combat units.',
  'cat.upgrades.transport-capacity.name': 'Troop Capacity',
  'cat.upgrades.transport-capacity.desc': 'Transports carry more infantry.',
  'cat.upgrades.defense-dome.name': 'Defense Dome',
  'cat.upgrades.defense-dome.desc': 'Project shield that absorbs damage around your base.',
  'cat.upgrades.weapon-upgrade.name': 'Weapon Upgrade',
  'cat.upgrades.weapon-upgrade.desc': 'Increases weapon damage in three levels.',
  'cat.upgrades.airstrike-level.name': 'Airstrike Payload',
  'cat.upgrades.airstrike-level.desc': 'More and stronger airstrike bombers.',
  'cat.upgrades.emp-level.name': 'EMP Overcharge',
  'cat.upgrades.emp-level.desc': 'Overcharges the EMP radius and effect.',
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
  'features.units.title': 'وحدات الجيش',
  'features.units.subtitle': 'كل وحدة في اللعبة مع دورها وإحصائياتها وأسلحتها.',
  'u.none': 'صورة الوحدة قيد التطوير',
  'feat.group.core': 'أساسيات اللعب',
  'feat.group.vision': 'الرؤية والقتال',
  'feat.group.tech': 'التطوّر والتقنية',
  'feat.group.maps': 'الخرائط والمحتوى',
  'feat.group.online': 'الإنترنت والعدالة',
  'feat.eco.title': 'اقتصاد مزدوج الموارد',
  'feat.eco.text': 'موردان يديران قاعدتك: الإمداد (دخل من الحصادات والحقول) والطاقة (تولّدها المحطات وتستهلكها المباني). عجزُ الطاقة يوقف الإنتاج.',
  'feat.build.title': 'البناء والإصلاح',
  'feat.build.text': 'الجرافات تبني المباني وتصلحها، والمباني قيد الإنشاء تكون هشّة، لذا التوقيت مهم.',
  'feat.supply.title': 'اقتصاد الإمداد والنفط',
  'feat.supply.text': 'تنقل الحصادات الإمداد من الحقول إلى رصيف الإمداد ليصبح اعتمادات، وتضيف حقول النفط مصدر دخل ثانٍ يستحق القتال عليه.',
  'feat.fog.title': 'ضباب الحرب',
  'feat.fog.text': 'ثلاثة أنماط للضباب (ذاكرة/كلاسيكي/صعب) مع الأقمار الصناعية والكشافة وخط الرؤية تحدد ما يستطيع كل طرف رؤيته.',
  'feat.stealth.title': 'التخفي والكشف',
  'feat.stealth.text': 'تقنية التخفي تخفي وحداتك، والألغام تعاقب التقدم، والكواشف والدخان يحافظان على وضوح المعركة.',
  'feat.weather.title': 'الليل والنهار والطقس',
  'feat.weather.text': 'دورة كاملة ليل/نهار مع المطر والثلج والعواصف الرعدية تغيّر أجواء كل خريطة ووضوحها.',
  'feat.combat.title': 'قتال عميق',
  'feat.combat.text': 'الأبراج والمخابئ، ومنصات الدفاع الجوي، ومدفعية الانفجار، والصواريخ البحرية، وضربات المقاتلات والأسلحة الخارقة — وجدول الأسلحة الكامل في الكتالوج.',
  'feat.tech.title': 'شجرة التقنية والترقيات',
  'feat.tech.text': 'اثنتا عشرة خطوة بحث من الرادار والقمر الصناعي إلى تقنية الألغام والقنابل والدخان، وقبة الدفاع والأسلحة الخارقة المشروطة بالرتبة.',
  'feat.veterancy.title': 'القدامى والرتب',
  'feat.veterancy.text': 'تكتسب الوحدات خبرة قدامى في القتال بينما يربح اللاعبون خبرة ومستويات ورتب قائد (★) تتحكم بأقوى الأبحاث.',
  'feat.super.title': 'الأسلحة الخارقة',
  'feat.super.text': 'ليزر الفضاء المداري، وغارة من أربع قاذفات، ونبضة كهرومغناطيسية تغطي القاعدة — قوية ومرئية ولها تهدئة.',
  'feat.maps.title': 'الخرائط ومحرر الخرائط',
  'feat.maps.text': 'خرائط توليدية إضافة إلى محرر مدمج: ارسم الأرض والماء، وضَع نقاط الظهور وحقول الإمداد والنفط، ثم استورد وصدّر.',
  'feat.airnav.title': 'الحرب الجوية والبحرية',
  'feat.airnav.text': 'المقاتلات تحلق فوق أي شيء وتضرب ثم تعود إلى القوة الجوية لإعادة التسلح، وتنقل حاملات الجنود والناقلات الجيوش عبر المياه المفتوحة.',
  'feat.modes.title': 'البوتات والفرق ونقاط الظهور',
  'feat.modes.text': 'مباراة البوتات دون اتصال أو قاعات حتى 8 لاعبين عبر الإنترنت — العب كل ضد الجميع أو فرقًا وحدّد لكل لاعب نقطة ظهوره.',
  'feat.lobbies.title': 'القاعات عبر الإنترنت',
  'feat.lobbies.text': 'أنشئ قاعات محمية بكلمة مرور، وابحث عن المباريات المفتوحة، والعب مباريات ودية أو مصنفة على الخادم المباشر.',
  'feat.replay.title': 'إعادة المباراة والنسخ الاحتياطي',
  'feat.replay.text': 'التزامن القطعي يتيح حفظ أي مباراة كملف إعادة محلي، والنسخ الاحتياطية المشفرة تنقل تقدمك إلى أي مكان.',
  'feat.mods.title': 'تعديلات التوازن',
  'feat.mods.text': 'اضبط الاقتصاد والوحدات والأسلحة بملفات تعديل بصيغة JSON، ثم انشرها في مستودع المجتمع مع التقييمات والتنزيلات.',
  'feat.fairplay.title': 'اللعب النظيف',
  'feat.fairplay.text': 'تتحقق الإعدادات في المباريات المصنفة، ويُعلَّم المتلاعبون، وملفات إعادة المباراة تضمن المساءلة في كل جولة.',
  'howto.catalog.title': 'كتالوج اللعبة',
  'howto.catalog.subtitle': 'المباني والوحدات والأسلحة والترقيات — الكتالوج الكامل كما صدرت اللعبة.',
  'cat.buildings': 'المباني',
  'cat.units': 'الوحدات',
  'cat.weapons': 'الأسلحة',
  'cat.upgrades': 'الترقيات',
  'cls.infantry': 'مشاة',
  'cls.vehicle': 'مركبة',
  'cls.air': 'جوي',
  'cls.naval': 'بحري',
  'st.cost': 'التكلفة',
  'st.hp': 'الصحة',
  'st.vision': 'الرؤية',
  'st.speed': 'السرعة',
  'st.build': 'البناء',
  'st.prod': 'يُنتج في',
  'st.weapon': 'السلاح',
  'st.power': 'الطاقة',
  'st.capacity': 'السعة',
  'st.ammo': 'الذخيرة',
  'st.garrison': 'التحصين',
  's.range': 'المدى',
  's.cooldown': 'التهدئة',
  's.splash': 'انفجاري',
  's.antiAir': 'مضاد للطيران',
  's.sec': 'ث',
  's.rank': 'الرتبة {n}',
  's.rankAny': 'أي رتبة',
  'w.dmgLbl': 'ضرر',
  'w.th.weapon': 'السلاح',
  'w.th.dmg': 'الضرر',
  'w.th.range': 'المدى',
  'w.th.cd': 'التهدئة',
  'w.th.notes': 'ملاحظات',
  'u.th.name': 'البحث',
  'u.th.cost': 'التكلفة',
  'u.th.time': 'مدة البحث',
  'u.th.at': 'المبنى',
  'u.th.rank': 'الرتبة',
  'cat.units.bulldozer.name': 'الجرّافة',
  'cat.units.bulldozer.role': 'يبني ويصلح قاعدتك ومبانيك.',
  'cat.units.harvester.name': 'الحاصدة',
  'cat.units.harvester.role': 'يجمع الإمداد من الحقول ويحوّله اعتمادات.',
  'cat.units.scout.name': 'الكشاف',
  'cat.units.scout.role': 'استطلاع سريع بعيد المدى يكشف الخريطة ويرصد تحركات الأعداء ويدّعي حقول النفط.',
  'cat.units.rifleman.name': 'الرامي',
  'cat.units.rifleman.role': 'رامي مشاة موثوق لجميع الأدوار.',
  'cat.units.rocket-trooper.name': 'الصاروخي',
  'cat.units.rocket-trooper.role': 'صواريخ ثقيلة ضد المدرعات.',
  'cat.units.assault-walker.name': 'ماشي الاقتحام',
  'cat.units.assault-walker.role': 'مركبة أمامية صلبة بمدفع.',
  'cat.units.aa-platform.name': 'منصة الدفاع الجوي',
  'cat.units.aa-platform.role': 'منصة دفاع جوي.',
  'cat.units.artillery.name': 'المدفعية',
  'cat.units.artillery.role': 'قصف بعيد المدى بضرر انفجاري.',
  'cat.units.engineer.name': 'المهندس',
  'cat.units.engineer.role': 'يصلح المباني ويشيّد المنشآت.',
  'cat.units.apc.name': 'ناقلة جند',
  'cat.units.apc.role': 'ناقلة مدرعة تنقل المشاة إلى المعركة.',
  'cat.units.fighter.name': 'المقاتلة',
  'cat.units.fighter.role': 'مقاتلة شبحية: تحلق فوق كل شيء، تضرب مرة، ثم تعود إلى القوة الجوية لإعادة التحميل.',
  'cat.units.carrier.name': 'حاملة الجنود',
  'cat.units.carrier.role': 'ناقلة جند مدرعة تحمل المشاة عبر المياه المفتوحة.',
  'cat.units.missile-boat.name': 'الزورق الصاروخي',
  'cat.units.missile-boat.role': 'قطعة بحرية سريعة تطلق صواريخ بحرية تصيب الأهداف الأرضية والبحرية — ولا تستهدف الطيران أبدًا.',
  'cat.buildings.command-center.name': 'مركز القيادة',
  'cat.buildings.command-center.desc': 'قاعدتك — تولّد الطاقة، وتدرّب الجرافات، وتضم ترقية الرادار.',
  'cat.buildings.power-plant.name': 'محطة الطاقة',
  'cat.buildings.power-plant.desc': 'تولّد +50 طاقة لإبقاء قاعدتك تعمل.',
  'cat.buildings.supply-dock.name': 'رصيف الإمداد',
  'cat.buildings.supply-dock.desc': 'يبني الحصادات ويودع الإمداد الذي تجمعه.',
  'cat.buildings.barracks.name': 'الثكنة',
  'cat.buildings.barracks.desc': 'تدرّب المشاة: الكشاف والرامي والصاروخي.',
  'cat.buildings.war-factory.name': 'مصنع الحرب',
  'cat.buildings.war-factory.desc': 'يبني المركبات — من ماشي الاقتحام إلى المهندس والناقلة.',
  'cat.buildings.turret.name': 'البرج',
  'cat.buildings.turret.desc': 'دفاع ثابت يطلق النار على الأهداف البرية والجوية.',
  'cat.buildings.tech-center.name': 'مركز التقنية',
  'cat.buildings.tech-center.desc': 'يفتح شجرة التقنية: الرادار والتخفي والدفاعات والترقيات.',
  'cat.buildings.air-force.name': 'القوة الجوية',
  'cat.buildings.air-force.desc': 'يبني المقاتلات ويعيد تزويدها بالذخيرة بين الطلعات.',
  'cat.buildings.super-weapon.name': 'السلاح الخارق',
  'cat.buildings.super-weapon.desc': 'يفتح قوة الرتبة الثالثة: ليزر الفضاء وحمولة الغارة والـEMP.',
  'cat.buildings.bunker.name': 'المخبأ',
  'cat.buildings.bunker.desc': 'دفاع قابل للتحصين يطلق النار على المهاجمين.',
  'cat.buildings.dock.name': 'الرصيف البحري',
  'cat.buildings.dock.desc': 'حوض بحري يبني حاملات الجنود والزوارق الصاروخية.',
  'cat.weapons.rifle.name': 'البندقية',
  'cat.weapons.rifle.desc': 'طلقة بندقية متعددة الأغراض.',
  'cat.weapons.rocket.name': 'الصاروخ',
  'cat.weapons.rocket.desc': 'صاروخ ثقيل ضد المدرعات.',
  'cat.weapons.cannon.name': 'المدفع',
  'cat.weapons.cannon.desc': 'قذائف تطلقها المركبات المجنزرة والماشون.',
  'cat.weapons.aa.name': 'مدفع مضاد للطيران',
  'cat.weapons.aa.desc': 'مدفع سريع مضاد للطيران.',
  'cat.weapons.artillery.name': 'مدفعية',
  'cat.weapons.artillery.desc': 'قذيفة بعيدة المدى بضرر انفجاري.',
  'cat.weapons.turret-gun.name': 'مدفع البرج',
  'cat.weapons.turret-gun.desc': 'نيران البرج ثنائية الغرض.',
  'cat.weapons.bunker-gun.name': 'مدفع المخبأ',
  'cat.weapons.bunker-gun.desc': 'نيران المخبأ المحصّن.',
  'cat.weapons.air-cannon.name': 'مدفع جوي',
  'cat.weapons.air-cannon.desc': 'مدفع ضربة المقاتلة.',
  'cat.weapons.sea-missile.name': 'صاروخ بحري',
  'cat.weapons.sea-missile.desc': 'صواريخ تصيب الأهداف البرية والبحرية بانفجار — ولا تستهدف الطيران أبدًا.',
  'cat.upgrades.radar.name': 'الرادار',
  'cat.upgrades.radar.desc': 'يكشف مساحة واسعة حول مركز القيادة.',
  'cat.upgrades.satellite.name': 'القمر الصناعي',
  'cat.upgrades.satellite.desc': 'يكشف الخريطة كاملة بشكل دوري.',
  'cat.upgrades.space-laser.name': 'ليزر الفضاء',
  'cat.upgrades.space-laser.desc': 'ضربة مدارية تسبب ضررًا هائلًا حيث تهدف.',
  'cat.upgrades.stealth-tech.name': 'تقنية التخفي',
  'cat.upgrades.stealth-tech.desc': 'يتيح التخفي لوحدات مختارة.',
  'cat.upgrades.detector-upgrade.name': 'ترقية الكاشف',
  'cat.upgrades.detector-upgrade.desc': 'يحسّن مدى الكواشف لكشف المتخفين.',
  'cat.upgrades.mine-tech.name': 'تقنية الألغام',
  'cat.upgrades.mine-tech.desc': 'ألغام تعاقب الأعداء المتقدمين.',
  'cat.upgrades.abilities-tech.name': 'القنابل والدخان',
  'cat.upgrades.abilities-tech.desc': 'يفتح القنابل والدخان لوحدات القتال الأرضية.',
  'cat.upgrades.transport-capacity.name': 'سعة النقل',
  'cat.upgrades.transport-capacity.desc': 'الناقلات تحمل مشاة أكثر.',
  'cat.upgrades.defense-dome.name': 'قبة الدفاع',
  'cat.upgrades.defense-dome.desc': 'درع واقٍ يمتص الضرر حول قاعدتك.',
  'cat.upgrades.weapon-upgrade.name': 'تطوير الأسلحة',
  'cat.upgrades.weapon-upgrade.desc': 'يزيد ضرر الأسلحة عبر ثلاث مستويات.',
  'cat.upgrades.airstrike-level.name': 'حمولة الغارة الجوية',
  'cat.upgrades.airstrike-level.desc': 'قاذفات غارة أكثر وأقوى.',
  'cat.upgrades.emp-level.name': 'شحن النبضة الكهرومغناطيسية',
  'cat.upgrades.emp-level.desc': 'يزيد نصف قطر وأثر النبضة الكهرومغناطيسية.',
  'footer.desc': 'لعبة استراتيجية مفتوحة المصدر. أبلغ عن المشاكل على GitHub.',
  'footer.rights': 'صُنعت بحب ♪ — العب، عدّل، شارك.',
  'lang.other': 'English',
}

const LANGS = { en: EN, ar: AR }

/* ---------------- game catalog (mirrors shared/src/balance) ---------------- */

const CATALOG = {
  units: [
    { id: 'bulldozer', cls: 'vehicle', cost: 100, s: 5, hp: 300, vis: 4, spd: 55, prod: 'command-center', img: './img/units/bulldozer.png' },
    { id: 'harvester', cls: 'vehicle', cost: 0, s: 8, hp: 600, vis: 4, spd: 60, prod: 'supply-dock', img: './img/units/harvester.png' },
    { id: 'scout', cls: 'infantry', cost: 50, s: 5, hp: 100, vis: 10, spd: 120, prod: 'barracks', img: null },
    { id: 'rifleman', cls: 'infantry', cost: 100, s: 10, hp: 200, vis: 6, spd: 90, prod: 'barracks', w: 'rifle', img: null },
    { id: 'rocket-trooper', cls: 'infantry', cost: 150, s: 12, hp: 150, vis: 6, spd: 80, prod: 'barracks', w: 'rocket', img: null },
    { id: 'assault-walker', cls: 'vehicle', cost: 250, s: 15, hp: 400, vis: 8, spd: 72, prod: 'war-factory', w: 'cannon', img: './img/units/assault-walker.png' },
    { id: 'aa-platform', cls: 'vehicle', cost: 300, s: 18, hp: 350, vis: 8, spd: 68, prod: 'war-factory', w: 'aa', img: './img/units/aa-platform.png' },
    { id: 'artillery', cls: 'vehicle', cost: 350, s: 22, hp: 250, vis: 9, spd: 48, prod: 'war-factory', w: 'artillery', img: './img/units/artillery.png' },
    { id: 'engineer', cls: 'vehicle', cost: 150, s: 12, hp: 150, vis: 6, spd: 90, prod: 'war-factory', img: './img/units/engineer.png' },
    { id: 'apc', cls: 'vehicle', cost: 200, s: 10, hp: 250, vis: 7, spd: 78, prod: 'war-factory', cap: 10, img: './img/units/apc.png' },
    { id: 'fighter', cls: 'air', cost: 200, s: 15, hp: 150, vis: 8, spd: 130, prod: 'air-force', w: 'air-cannon', cap: 3, ammo: 2, img: './img/units/fighter.png' },
    { id: 'carrier', cls: 'naval', cost: 600, s: 35, hp: 900, vis: 8, spd: 55, prod: 'dock', cap: 12, img: './img/units/carrier.png' },
    { id: 'missile-boat', cls: 'naval', cost: 350, s: 20, hp: 320, vis: 8, spd: 80, prod: 'dock', w: 'sea-missile', img: './img/units/missile-boat.png' },
  ],
  buildings: [
    { id: 'command-center', cost: 500, s: 30, hp: 2000, pGen: 10, pUse: 0, produces: 'bulldozer', img: './img/buildings/command-center.png' },
    { id: 'power-plant', cost: 200, s: 20, hp: 800, pGen: 50, pUse: 0, img: './img/buildings/power-plant.png' },
    { id: 'supply-dock', cost: 300, s: 20, hp: 800, pGen: 0, pUse: 5, produces: 'harvester', img: './img/buildings/supply-dock.png' },
    { id: 'barracks', cost: 200, s: 20, hp: 600, pGen: 0, pUse: 5, produces: 'rifleman', img: './img/buildings/barracks.png' },
    { id: 'war-factory', cost: 400, s: 30, hp: 900, pGen: 0, pUse: 10, produces: 'assault-walker', img: './img/buildings/war-factory.png' },
    { id: 'turret', cost: 150, s: 15, hp: 500, pGen: 0, pUse: 5, w: 'turret-gun', img: './img/buildings/turret.png' },
    { id: 'tech-center', cost: 500, s: 40, hp: 700, pGen: 0, pUse: 10, img: './img/buildings/tech-center.png' },
    { id: 'air-force', cost: 500, s: 25, hp: 900, pGen: 0, pUse: 15, produces: 'fighter', img: './img/buildings/air-force.png' },
    { id: 'super-weapon', cost: 1500, s: 45, hp: 1500, pGen: 0, pUse: 100, img: './img/buildings/super-weapon.png' },
    { id: 'bunker', cost: 250, s: 20, hp: 700, pGen: 0, pUse: 5, w: 'bunker-gun', garrison: 5, img: './img/buildings/bunker.png' },
    { id: 'dock', cost: 400, s: 30, hp: 900, pGen: 0, pUse: 10, produces: 'carrier', img: './img/buildings/dock.png' },
  ],
  weapons: [
    { id: 'rifle', dmg: 12, cd: 0.4, rng: 6 },
    { id: 'rocket', dmg: 25, cd: 0.8, rng: 7 },
    { id: 'cannon', dmg: 40, cd: 0.6, rng: 7 },
    { id: 'aa', dmg: 18, cd: 0.4, rng: 8, aa: true },
    { id: 'artillery', dmg: 60, cd: 1.8, rng: 12, splash: true },
    { id: 'turret-gun', dmg: 20, cd: 0.48, rng: 8, aa: true },
    { id: 'bunker-gun', dmg: 22, cd: 0.48, rng: 8, aa: true },
    { id: 'air-cannon', dmg: 45, cd: 1.2, rng: 7 },
    { id: 'sea-missile', dmg: 60, cd: 1.6, rng: 9, splash: true },
  ],
  upgrades: [
    { id: 'radar', cost: 300, s: 15, at: 'command-center', rank: 0 },
    { id: 'satellite', cost: 500, s: 20, at: 'tech-center', rank: 0 },
    { id: 'stealth-tech', cost: 400, s: 20, at: 'tech-center', rank: 1 },
    { id: 'detector-upgrade', cost: 300, s: 15, at: 'tech-center', rank: 1 },
    { id: 'mine-tech', cost: 400, s: 20, at: 'tech-center', rank: 1 },
    { id: 'abilities-tech', cost: 400, s: 20, at: 'tech-center', rank: 1 },
    { id: 'transport-capacity', cost: 300, s: 20, at: 'tech-center', rank: 1 },
    { id: 'defense-dome', cost: 500, s: 20, at: 'tech-center', rank: 2 },
    { id: 'weapon-upgrade', cost: 400, s: 20, at: 'tech-center', rank: 2 },
    { id: 'space-laser', cost: 1000, s: 40, at: 'super-weapon', rank: 3 },
    { id: 'airstrike-level', cost: 1000, s: 40, at: 'super-weapon', rank: 3 },
    { id: 'emp-level', cost: 1000, s: 40, at: 'super-weapon', rank: 3 },
  ],
}

const SYSTEMS = [
  { group: 'core', icon: '⚙️', k: 'eco' },
  { group: 'core', icon: '🏗️', k: 'build' },
  { group: 'core', icon: '🗄️', k: 'supply' },
  { group: 'vision', icon: '🌫️', k: 'fog' },
  { group: 'vision', icon: '🕶️', k: 'stealth' },
  { group: 'vision', icon: '🌦️', k: 'weather' },
  { group: 'vision', icon: '💥', k: 'combat' },
  { group: 'tech', icon: '🧪', k: 'tech' },
  { group: 'tech', icon: '🎖️', k: 'veterancy' },
  { group: 'tech', icon: '⚡', k: 'super' },
  { group: 'maps', icon: '🗺️', k: 'maps' },
  { group: 'maps', icon: '🚁', k: 'airnav' },
  { group: 'maps', icon: '🤖', k: 'modes' },
  { group: 'online', icon: '🌐', k: 'lobbies' },
  { group: 'online', icon: '🎞️', k: 'replay' },
  { group: 'online', icon: '🎛️', k: 'mods' },
  { group: 'online', icon: '🛡️', k: 'fairplay' },
]

const t = (lang, key, vars) => {
  let s = LANGS[lang][key] ?? EN[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

/* ---------------- game catalog renderers ---------------- */

const fmtNum = (n) => {
  const r = Number.isInteger(n) ? n : Number(n.toFixed(2))
  return r.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')
}

const weaponLine = (u) => {
  const w = CATALOG.weapons.find((x) => x.id === u.w)
  if (!w) return ''
  const bits = [
    t(lang, 'cat.weapons.' + u.w + '.name'),
    `${w.dmg} ${t(lang, 'w.dmgLbl')}`,
    `${t(lang, 's.range')} ${w.rng}`,
    `${t(lang, 's.cooldown')} ${fmtNum(w.cd)}${t(lang, 's.sec')}`,
  ]
  if (w.splash) bits.push(t(lang, 's.splash'))
  if (w.aa) bits.push(t(lang, 's.antiAir'))
  return `<p class="cat-weapon">${bits.join(' · ')}</p>`
}

const renderUnitCard = (u) => {
  const nm = t(lang, 'cat.units.' + u.id + '.name')
  const role = t(lang, 'cat.units.' + u.id + '.role')
  const cls = t(lang, 'cls.' + u.cls)
  const img = u.img
    ? `<img class="cat-sprite" src="${u.img}" alt="${nm}" loading="lazy" />`
    : `<div class="cat-sprite cat-sprite-none" aria-hidden="true">✦</div>`
  let rows = `<li>${t(lang, 'st.cost')}: <b>${u.cost}</b></li>`
  rows += `<li>${t(lang, 'st.hp')}: <b>${u.hp}</b></li>`
  rows += `<li>${t(lang, 'st.vision')}: <b>${u.vis}</b></li>`
  rows += `<li>${t(lang, 'st.speed')}: <b>${u.spd}</b></li>`
  rows += `<li>${t(lang, 'st.build')}: <b>${u.s}${t(lang, 's.sec')}</b></li>`
  rows += `<li>${t(lang, 'st.prod')}: <b>${t(lang, 'cat.buildings.' + u.prod + '.name')}</b></li>`
  const chips = [`<span class="chip">${cls}</span>`]
  if (u.cap) chips.push(`<span class="chip">${t(lang, 'st.capacity')} ${u.cap}</span>`)
  if (u.ammo) chips.push(`<span class="chip">${t(lang, 'st.ammo')} ${u.ammo}</span>`)
  return (
    `<article class="card cat-card">` +
    img +
    `<h3>${nm}</h3>` +
    `<div class="cat-chips">${chips.join('')}</div>` +
    `<p class="cat-role">${role}</p>` +
    weaponLine(u) +
    `<ul class="cat-stats">${rows}</ul>` +
    `</article>`
  )
}

const renderBuildingCard = (b) => {
  const nm = t(lang, 'cat.buildings.' + b.id + '.name')
  const desc = t(lang, 'cat.buildings.' + b.id + '.desc')
  const net = b.pGen - b.pUse
  const powerBit = net > 0 ? `+${net}` : net < 0 ? `${net}` : '0'
  let rows = `<li>${t(lang, 'st.cost')}: <b>${b.cost}</b></li>`
  rows += `<li>${t(lang, 'st.hp')}: <b>${b.hp}</b></li>`
  rows += `<li>${t(lang, 'st.power')}: <b>${powerBit}</b></li>`
  rows += `<li>${t(lang, 'st.build')}: <b>${b.s}${t(lang, 's.sec')}</b></li>`
  if (b.produces) rows += `<li>${t(lang, 'st.prod')}: <b>${t(lang, 'cat.units.' + b.produces + '.name')}</b></li>`
  if (b.w) rows += `<li>${t(lang, 'st.weapon')}: <b>${t(lang, 'cat.weapons.' + b.w + '.name')}</b></li>`
  if (b.garrison) rows += `<li>${t(lang, 'st.garrison')}: <b>${b.garrison}</b></li>`
  return (
    `<article class="card cat-card">` +
    `<img class="cat-sprite" src="${b.img}" alt="${nm}" loading="lazy" />` +
    `<h3>${nm}</h3>` +
    `<p class="cat-role">${desc}</p>` +
    `<ul class="cat-stats">${rows}</ul>` +
    `</article>`
  )
}

const renderUnits = (containerId) => {
  const el = document.getElementById(containerId)
  if (!el) return
  el.innerHTML = CATALOG.units.map(renderUnitCard).join('')
}

const renderSystems = () => {
  const el = document.getElementById('systems-grid')
  if (!el) return
  const groups = ['core', 'vision', 'tech', 'maps', 'online']
  el.innerHTML = groups
    .map((g) => {
      const cards = SYSTEMS.filter((s) => s.group === g)
        .map(
          (s) =>
            `<article class="card">` +
            `<span class="card-icon">${s.icon}</span>` +
            `<h3>${t(lang, `feat.${s.k}.title`)}</h3>` +
            `<p>${t(lang, `feat.${s.k}.text`)}</p>` +
            `</article>`,
        )
        .join('')
      return `<div class="catalog-group"><h2 class="group-title">${t(lang, `feat.group.${g}`)}</h2><div class="grid">${cards}</div></div>`
    })
    .join('')
}

const renderWeaponsTable = () => {
  const thead =
    `<thead><tr>` +
    `<th>${t(lang, 'w.th.weapon')}</th>` +
    `<th>${t(lang, 'w.th.dmg')}</th>` +
    `<th>${t(lang, 'w.th.range')}</th>` +
    `<th>${t(lang, 'w.th.cd')}</th>` +
    `<th>${t(lang, 'w.th.notes')}</th>` +
    `</tr></thead>`
  const rows = CATALOG.weapons.map((w) => {
    const notes = []
    if (w.splash) notes.push(t(lang, 's.splash'))
    if (w.aa) notes.push(t(lang, 's.antiAir'))
    return (
      `<tr>` +
      `<td><b>${t(lang, 'cat.weapons.' + w.id + '.name')}</b><div class="cat-desc">${t(lang, 'cat.weapons.' + w.id + '.desc')}</div></td>` +
      `<td>${w.dmg}</td>` +
      `<td>${w.rng}</td>` +
      `<td>${fmtNum(w.cd)}${t(lang, 's.sec')}</td>` +
      `<td>${notes.join(', ') || '—'}</td>` +
      `</tr>`
    )
  })
  return `<div class="table-wrap"><table class="cat-table">${thead}<tbody>${rows.join('')}</tbody></table></div>`
}

const renderUpgradesTable = () => {
  const thead =
    `<thead><tr>` +
    `<th>${t(lang, 'u.th.name')}</th>` +
    `<th>${t(lang, 'u.th.cost')}</th>` +
    `<th>${t(lang, 'u.th.time')}</th>` +
    `<th>${t(lang, 'u.th.at')}</th>` +
    `<th>${t(lang, 'u.th.rank')}</th>` +
    `</tr></thead>`
  const rows = CATALOG.upgrades.map((u) => {
    const rank = u.rank === 0 ? t(lang, 's.rankAny') : t(lang, 's.rank', { n: u.rank })
    return (
      `<tr>` +
      `<td><b>${t(lang, 'cat.upgrades.' + u.id + '.name')}</b><div class="cat-desc">${t(lang, 'cat.upgrades.' + u.id + '.desc')}</div></td>` +
      `<td>${u.cost}</td>` +
      `<td>${u.s}${t(lang, 's.sec')}</td>` +
      `<td>${t(lang, 'cat.buildings.' + u.at + '.name')}</td>` +
      `<td>${rank}</td>` +
      `</tr>`
    )
  })
  return `<div class="table-wrap"><table class="cat-table">${thead}<tbody>${rows.join('')}</tbody></table></div>`
}

const renderCatalog = () => {
  const el = document.getElementById('game-catalog')
  if (!el) return
  el.innerHTML =
    `<h2 class="group-title">${t(lang, 'cat.buildings')}</h2>` +
    `<div class="grid cat-grid">${CATALOG.buildings.map(renderBuildingCard).join('')}</div>` +
    `<h2 class="group-title">${t(lang, 'cat.units')}</h2>` +
    `<div class="grid cat-grid">${CATALOG.units.map(renderUnitCard).join('')}</div>` +
    `<h2 class="group-title">${t(lang, 'cat.weapons')}</h2>` +
    renderWeaponsTable() +
    `<h2 class="group-title">${t(lang, 'cat.upgrades')}</h2>` +
    renderUpgradesTable()
}

const renderDynamic = () => {
  renderSystems()
  renderUnits('units-gallery')
  renderCatalog()
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
  renderDynamic()
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

  renderDynamic()

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