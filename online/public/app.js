/* Space Arenas — landing page (GitHub Pages).
 * i18n EN/AR toggle (localStorage + ?lang=) and a public, read-only community section:
 * browse community mods and maps against the Render API. Downloading, rating and publishing
 * all live inside the game client. Short TTL cache keeps API traffic low.
 */

// The public Render API. Set this to your deployed service origin.
const SA_ONLINE_URL = 'https://space-arenas-online.onrender.com'

const CACHE_KEY = 'sa-modlist-cache-v1'
const MAPS_CACHE_KEY = 'sa-maplist-cache-v1'
const LANG_KEY = 'sa-lang'
const MODS_TTL_MS = 5 * 60 * 1000

const EN = {
  brand: 'Space Arenas',
  'nav.home': 'Home',
  'nav.community': 'Community',
  'nav.repo': 'Source',
  'hero.badge': 'Real-time strategy in space',
  'hero.title': 'Command your fleet on maps that fight back.',
  'hero.subtitle': 'Build your base, harvest resources, and out-think your rivals with tactical airstrikes, stealth, mines and more — solo or online with friends.',
  'hero.ctaRepo': 'Get the game',
  'hero.ctaCommunity': 'Browse community mods',
  'home.teaserTitle': 'Space Arenas in short',
  'home.intro': 'A deterministic, real-time strategy game. Build a base, harvest supplies, manage power and destroy every enemy Command Center — solo, against AI bots, or online with friends. Deep vision, stealth, day/night weather, Super Weapons and a balance-mod system keep battles readable and fair.',
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
  'howto.st2.text': 'Sign in with Google in the online lobby to unlock the leaderboard, data backups and the community repository.',
  'howto.st3.title': 'Play & share',
  'howto.st3.text': 'Create or join a room, pick a balance mod, and carry your progress anywhere with encrypted backups.',
  'community.title': 'Community',
  'community.subtitle': 'Browse community mods and maps. Downloading, rating and publishing happen inside the game.',
  'community.gameOnly': 'Download, rating and publishing happen inside the game.',
  'community.by': 'by @{name}',
  'community.downloads': '{n} downloads',
  'community.players': '{n} players',
  'community.noRating': 'not rated yet',
  'community.rating': '{avg} / 5 ({c})',
  'community.loading': 'Loading…',
  'community.tab.mods': 'Mods',
  'community.tab.maps': 'Maps',
  'community.empty': 'No mods published yet — be the first!',
  'community.maps.empty': 'No maps published yet — be the first!',
  'community.error': 'Could not load the mod repository.',
  'community.maps.error': 'Could not load the map repository.',
  'media.title': 'Seen in action',
  'media.battle': 'Skirmish view',
  'media.mod': 'Mod tuning',
  'media.online': 'Online lobby',
  'mapbuild.title': 'Paint your own arenas',
  'mapbuild.subtitle': 'The built-in Map Builder turns any idea into a playable battlefield — resize, paint and place objects, then publish your map for everyone in the community Maps repository.',
  'mapbuild.group.features': 'Map Builder features',
  'mapbuild.group.objects': 'Objects you can add',
  'mapbuild.f.resize.title': 'Free-size arenas',
  'mapbuild.f.resize.text': 'Resize a map any time — the editor keeps your painted tiles, fields and obstacles and just re-frames the battlefield.',
  'mapbuild.f.terrain.title': 'Terrain painting',
  'mapbuild.f.terrain.text': 'Paint ground, water, cliffs and roads, flood-fill large areas in one click, or give the ground your own custom colors.',
  'mapbuild.f.spawns.title': 'Spawn points',
  'mapbuild.f.spawns.text': 'Place a per-player spawn for up to 8 players and set up Free-for-All or team layouts.',
  'mapbuild.f.economy.title': 'Supply & oil fields',
  'mapbuild.f.economy.text': 'Drop fixed-size supply patches and oil fields that become the resource nodes bases fight over.',
  'mapbuild.f.world.title': 'Real-world import',
  'mapbuild.f.world.text': 'Import a satellite or local image and the editor automatically turns its pixels into playable terrain.',
  'mapbuild.f.share.title': 'Save & share',
  'mapbuild.f.share.text': 'Keep an unlimited map library, export and import .json files, and publish maps to the community Maps repo — or download everyone else\u2019s.',
  'mapbuild.o.spawns.title': 'Player spawns',
  'mapbuild.o.spawns.text': 'One team-colored starting spot per player, up to 8 players.',
  'mapbuild.o.supply.title': 'Supply fields',
  'mapbuild.o.supply.text': 'Fixed square patches that Harvesters mine into credits.',
  'mapbuild.o.oil.title': 'Oil fields',
  'mapbuild.o.oil.text': 'Circular oil pools — a second income source worth fighting over.',
  'mapbuild.o.rock.title': 'Rocks',
  'mapbuild.o.rock.text': 'Impassable cover that blocks movement and line of sight.',
  'mapbuild.o.tree.title': 'Trees',
  'mapbuild.o.tree.text': 'Soft cover and a natural look around spawns and bases.',
  'mapbuild.o.wreck.title': 'Wrecks',
  'mapbuild.o.wreck.text': 'Burned-out vehicle husks — battlefield scenery and cover.',
  'mapbuild.o.terrain.title': 'Terrain & colors',
  'mapbuild.o.terrain.text': 'Water, cliffs, roads and a full custom color palette for the ground.',
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
  'howto.catalog.subtitle': 'Buildings, units, scenery, weapons and upgrades — the full roster exactly as shipped.',
  'cat.buildings': 'Buildings',
  'cat.units': 'Units',
  'cat.scenery': 'Scenery & Objects',
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
  'cat.scenery.rock.name': 'Rock',
  'cat.scenery.rock.desc': 'Impassable terrain that blocks movement and line of fire.',
  'cat.scenery.tree.name': 'Tree',
  'cat.scenery.tree.desc': 'Scenery that slows units moving through it.',
  'cat.scenery.wreck.name': 'Wreck',
  'cat.scenery.wreck.desc': 'Destroyed vehicle remains — cover for infantry, blocking for vehicles.',
  'cat.scenery.mine.name': 'Mine',
  'cat.scenery.mine.desc': 'Explodes on contact, damaging anything that steps on it.',
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
  'footer.rights': 'Made with ♥ — play, mod, share.',
  'footer.terms': 'Terms of Use',
  'footer.privacy': 'Privacy Policy',
  'footer.contact': 'Contact',
  'legal.updated': 'Last updated: October 20, 2026',

  // ---- Terms of Use (terms.html) ----
  'terms.docTitle': 'Terms of Use · Space Arenas',
  'terms.title': 'Terms of Use',
  'terms.intro':
    'Space Arenas is an open-source real-time strategy game. These Terms cover the game, the website at https://sdevrami.github.io/space-arenas (the “Site”) and the online service behind it — lobbies, leaderboards, the community repository (the “Service”). Please read them before you play online.',
  'terms.s1.title': '1. Acceptance',
  'terms.s1.text':
    'By using the Site, creating an account or playing online, you agree to these Terms. If you do not agree, do not use the Service — the offline game and its source code stay available under the repository’s licence.',
  'terms.s2.title': '2. About the Service',
  'terms.s2.text':
    'The Service is a free, non-commercial, volunteer-run project. It is not required to play: single-player and local games run in your browser without an account. An account is only needed for online lobbies, the leaderboard, encrypted backups and publishing to the community repository.',
  'terms.s3.title': '3. Eligibility and your account',
  'terms.s3.text':
    'You must be at least 13 years old (or the minimum age of digital consent in your country) to create an account. Accounts are created by signing in with Google inside the game — we never see or store your Google password. Keep your Google account secure: anyone who can sign in with it can use your Space Arenas account. Use one account per person; do not share, buy, sell or transfer accounts, and do not create accounts automatically or in bulk.',
  'terms.s4.title': '4. Acceptable use',
  'terms.s4.text':
    'You agree not to: cheat, modify the client for an advantage, or exploit bugs in ranked or verified matches; tamper with the online protocol, the server or other players’ clients; publish content that is unlawful, hateful, harassing, sexually explicit, or that infringes someone else’s rights; impersonate the developers or other players, or take a reserved username; attack, overload, scrape or otherwise abuse the Service or its API, or try to reach data or accounts that are not yours; distribute malware or anything that harms other players.',
  'terms.s5.title': '5. Usernames and profiles',
  'terms.s5.text':
    'Your username is your public handle in lobbies, on the leaderboard and on everything you publish. It must be 1–24 characters and is unique regardless of letter case. We may reserve, refuse, rename or reclaim usernames that are misleading, offensive, impersonating, or that infringe rights. Profiles show your username and gameplay statistics only.',
  'terms.s6.title': '6. Content you publish',
  'terms.s6.text':
    'When you publish a balance mod or map, or post a rating or comment, you keep ownership of it. You grant the project a worldwide, non-exclusive, royalty-free licence to store, display, distribute and let other players download that content as part of the Service. You confirm you own it or have the rights to share it, and that it breaks no law or third-party licence (including the licences of any assets you used).',
  'terms.s7.title': '7. Downloads and third-party content',
  'terms.s7.text':
    'Community mods and maps are made by other players and are provided “as is”, without review or warranty. Downloading and using them is at your own risk — they can change game balance in unexpected ways. Download only from this Site or through the in-game repository, and report anything harmful.',
  'terms.s8.title': '8. Fair play',
  'terms.s8.text':
    'Ranked matches record settings and results, and clients that tamper with these values are flagged. If we reasonably believe a result came from cheating, exploiting or tampering, we may reject or void the result, adjust statistics, remove published content, or restrict access to online features. This is a manual human decision, not an automatic punishment system.',
  'terms.s9.title': '9. Availability and changes',
  'terms.s9.text':
    'The Service is free and provided on a best-effort basis. Features may change, break or be discontinued at any time, including permanent removal of online features, leaderboard resets or data loss. We try to announce significant changes in the repository, but we cannot promise uninterrupted availability.',
  'terms.s10.title': '10. Intellectual property',
  'terms.s10.text':
    'The game’s source code, artwork, sounds and website are released under the licence stated in the project repository. The “Space Arenas” name and logos belong to the project maintainer. Third-party parts (for example Google sign-in, Supabase, GitHub Pages) stay under their own terms.',
  'terms.s11.title': '11. Disclaimer of warranties',
  'terms.s11.text':
    'The Site, the Service and all community content are provided “as is” and “as available”, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement. We do not warrant that the Service will be error-free, secure or uninterrupted, or that data — backups, statistics or published content — will never be lost.',
  'terms.s12.title': '12. Limitation of liability',
  'terms.s12.text':
    'To the maximum extent permitted by law, the maintainer and contributors are not liable for indirect, incidental, special, consequential or punitive damages, or for lost data, progress or profits, arising from your use of the Service — even if advised of the possibility. Because the Service is free, our total liability for any claim is limited to what you paid us: zero. Nothing here limits rights you have under mandatory consumer law in your country.',
  'terms.s13.title': '13. Suspension and termination',
  'terms.s13.text':
    'You may stop using the Service at any time. We may suspend or end access to online features if these Terms are broken, or to protect the Service and its players. To have your account and related data deleted, use the contact channel below.',
  'terms.s14.title': '14. Changes to these Terms',
  'terms.s14.text':
    'We may update these Terms as the Service evolves. The new version appears on this page with a new “last updated” date, and material changes are noted in the repository. Continuing to use the Service after a change means you accept the updated Terms.',
  'terms.s15.title': '15. Contact',
  'terms.s15.text': 'Questions about these Terms: open an issue at https://github.com/SDevRami/space-arenas/issues.',

  // ---- Privacy Policy (privacy.html) ----
  'privacy.docTitle': 'Privacy Policy · Space Arenas',
  'privacy.title': 'Privacy Policy',
  'privacy.s1.title': '1. Privacy at a glance',
  'privacy.s1.text':
    'We collect as little as possible. To play online you sign in with Google, and we store the email address Google returns, the username you choose, your match statistics, and anything you deliberately publish (mods, maps, ratings, comments) or save (encrypted backups). We do not sell your data, we run no advertising and no third-party analytics, and the website works with no account at all.',
  'privacy.s2.title': '2. Who we are and what this covers',
  'privacy.s2.text':
    'Space Arenas is an open-source, non-commercial game project. This policy explains how the website (the “Site”) and the online service behind it (the “Service”) handle personal data. The offline game needs no account and sends your data nowhere. The project maintainer (see Contact) is the controller for the Service.',
  'privacy.s3.title': '3. Information you give us',
  'privacy.s3.text':
    'Account: when you sign in with Google we receive your Google account identifier, your email address and the basic profile Google shares (name and profile picture) — used to create your account and confirm it is yours. We never receive your Google password. You then choose a public username. Content: balance mods and maps you publish, ratings and comments you post, and — if you use them — encrypted backups of your game settings and profile. Support messages: whatever you include when you contact us, for example in a GitHub issue.',
  'privacy.s4.title': '4. Information created by playing',
  'privacy.s4.text':
    'Match records (map, winner, participants, scores), your profile counters (matches played, wins, high score) and leaderboard entries. These make the leaderboard and match history work, and are visible to other players together with your username.',
  'privacy.s5.title': '5. Technical information',
  'privacy.s5.text':
    'Like any web service, the server sees the IP address and basic request details of connections (path, time, browser), used to enforce rate limits and prevent abuse. WebSocket connections are counted for capacity. Traffic inside a live match is relayed between players and is not stored. Server logs are short-lived and are not used to profile you.',
  'privacy.s6.title': '6. Storage in your browser',
  'privacy.s6.text':
    'The Site and the game keep small amounts of data in your browser’s local storage: your chosen language, a short-lived cache of the public mod/map list, and (in the game) your session token and settings. This is functional storage, not tracking. We use no advertising cookies, no cross-site trackers and no third-party analytics.',
  'privacy.s7.title': '7. What we do not do',
  'privacy.s7.text':
    'We do not sell or rent personal data; we run no ads or email marketing; we do not track you across other websites; we do not collect passwords (sign-in goes through Google); and we do not build advertising profiles.',
  'privacy.s8.title': '8. Google sign-in and third-party services',
  'privacy.s8.text':
    'Sign-in is handled by Google (OAuth) through Supabase Auth. Data is stored and processed by: Supabase (authentication and database hosting), Render (hosting the online API — lobbies, leaderboards, repositories), GitHub Pages / GitHub (hosting the Site and the source repository) and Google (sign-in and consent screen). Each has its own terms and privacy policy. We share data with them only to run the Service, and we do not permit them to use it for their own advertising.',
  'privacy.s9.title': '9. How we use your information',
  'privacy.s9.text':
    'To create and secure your account; run lobbies, rankings and backups; show and distribute community content; prevent cheating and abuse; answer your requests; and comply with the law. Where the GDPR applies we rely on performance of a contract (running the Service you signed up for), legitimate interests (security, abuse prevention) and, where required, your consent — which you can withdraw at any time simply by using the game without an account.',
  'privacy.s10.title': '10. How long we keep it',
  'privacy.s10.text':
    'Profile, statistics and published content stay while your account exists. Match records are kept for leaderboard history, but the match table is capped to a limited number of the newest rows. Backups expire automatically. Transient request logs are kept only as long as needed for security. Deleting your account deletes the rows linked to it (profile, statistics, leaderboard entry, backups).',
  'privacy.s11.title': '11. Your rights and deleting your data',
  'privacy.s11.text':
    'You can see your statistics in the game, change your username in the game lobby, and ask for access, correction, export or deletion through the contact channel below. In the EEA/UK you may also object, ask us to restrict processing, and complain to your local data protection authority. We carry out deletion requests by removing your profile and the rows linked to it, and removing your username from retained match history on request. As a free, volunteer-run service, please allow reasonable time.',
  'privacy.s12.title': '12. Children',
  'privacy.s12.text':
    'The Service is not directed at children under 13 (or the minimum age of digital consent in your country). We do not knowingly create accounts for them; if you believe a child has an account, contact us and we will delete it.',
  'privacy.s13.title': '13. Security',
  'privacy.s13.text':
    'Data travels over HTTPS, server-side secrets (database service keys) never reach your browser, backups are encrypted with a passphrase that never leaves your device (we store only a hash so a wrong passphrase is rejected), room passwords are compared as hashes, and database access is restricted. No system is perfectly secure.',
  'privacy.s14.title': '14. International transfers',
  'privacy.s14.text':
    'Our providers (Supabase, Render, GitHub, Google) may process and store data outside your country, including in the United States and the European Union, under standard contractual or equivalent safeguards.',
  'privacy.s15.title': '15. Changes to this policy',
  'privacy.s15.text':
    'We may update this policy when the Service changes. The new version is posted here with a new date; material changes are noted in the repository.',
  'privacy.s16.title': '16. Contact',
  'privacy.s16.text': 'Privacy questions and data requests: open an issue at https://github.com/SDevRami/space-arenas/issues.',

  'lang.other': 'العربية',
}

const AR = {
  brand: 'ساحات الفضاء',
  'nav.home': 'الرئيسية',
  'nav.community': 'المجتمع',
  'nav.repo': 'المصدر',
  'hero.badge': 'استراتيجية في الزمن الحقيقي في الفضاء',
  'hero.title': 'قُد أسطولك في خرائط تقاومك.',
  'hero.subtitle': 'ابنِ قاعدتك، اجمع الموارد، وتفوق على خصومك بالغارات التكتيكية، والتخفي، والألغام والمزيد — منفرداً أو عبر الإنترنت مع أصدقائك.',
  'hero.ctaRepo': 'حمّل اللعبة',
  'hero.ctaCommunity': 'تصفح تعديلات المجتمع',
  'home.teaserTitle': 'ساحات الفضاء باختصار',
  'home.intro': 'لعبة استراتيجية حتمية في الزمن الحقيقي. ابنِ قاعدتك، اجمع الإمداد، أدِر الطاقة، ودمّر كل مركز قيادة معادٍ — منفرداً، ضد بوتات ذكية، أو عبر الإنترنت مع أصدقائك. رؤية عميقة، وتخفي، وطقس ليل/نهار، وأسلحة خارقة، ونظام تعديلات يجعلون كل معركة واضحة وعادلة.',
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
  'howto.st2.text': 'سجّل الدخول باستخدام Google في قاعة اللعب لفتح لوحة المتصدرين والنسخ الاحتياطية ومستودع المجتمع.',
  'howto.st3.title': 'العب وشارك',
  'howto.st3.text': 'أنشئ قاعة أو انضم إليها، اختر تعديل توازن، وانقل تقدمك أينما كنت بنسخ احتياطية مشفرة.',
  'community.title': 'مجتمع اللاعبين',
  'community.subtitle': 'تصفّح تعديلات وخرائط المجتمع. التنزيل والتقييم والنشر تتم من داخل اللعبة.',
  'community.gameOnly': 'التنزيل والتقييم والنشر تتم من داخل اللعبة.',
  'community.by': 'بواسطة @{name}',
  'community.downloads': '{n} تنزيل',
  'community.players': '{n} لاعبي',
  'community.noRating': 'لم يُقيَّم بعد',
  'community.rating': '{avg} / 5 ({c})',
  'community.loading': 'جارٍ التحميل…',
  'community.tab.mods': 'التعديلات',
  'community.tab.maps': 'الخرائط',
  'community.empty': 'لا توجد تعديلات بعد — كن أول من ينشر!',
  'community.maps.empty': 'لا توجد خرائط بعد — كن أول من ينشر!',
  'community.error': 'تعذّر تحميل مستودع التعديلات.',
  'community.maps.error': 'تعذّر تحميل مستودع الخرائط.',
  'media.title': 'شاهدها أثناء اللعب',
  'media.battle': 'منظر المعركة',
  'media.mod': 'ضبط التعديلات',
  'media.online': 'قاعة اللعب',
  'mapbuild.title': 'ارسم ساحاتك الخاصة',
  'mapbuild.subtitle': 'محرر الخرائط المدمج يحوّل أي فكرة إلى ساحة معركة قابلة للعب — كبّر وارسم وضع العناصر، ثم انشر خريطتك للجميع في مستودع خرائط المجتمع.',
  'mapbuild.group.features': 'مزايا محرر الخرائط',
  'mapbuild.group.objects': 'عناصر يمكنك إضافتها',
  'mapbuild.f.resize.title': 'ساحات بأي حجم',
  'mapbuild.f.resize.text': 'غيّر حجم الخريطة في أي وقت — يحتفظ المحرر ببلاطاتك وحقولك وعوائقك ويعيد فقط تأطير ساحة المعركة.',
  'mapbuild.f.terrain.title': 'طلاء التضاريس',
  'mapbuild.f.terrain.text': 'ارسم الأرض والماء والمنحدرات والطرق، واملأ المساحات الكبيرة بنقرة واحدة، أو أضف ألوانك المخصصة إلى الأرض.',
  'mapbuild.f.spawns.title': 'نقاط الظهور',
  'mapbuild.f.spawns.text': 'ضع نقطة ظهور لكل لاعب حتى 8 لاعبين وجهّز تخطيطات كل ضد الجميع أو الفرق.',
  'mapbuild.f.economy.title': 'حقول الإمداد والنفط',
  'mapbuild.f.economy.text': 'أضف رقع الإمداد ذات الحجم الثابت وحقول النفط لتصبح عقد الموارد التي يتنازع عليها الأساس.',
  'mapbuild.f.world.title': 'استيراد من العالم الحقيقي',
  'mapbuild.f.world.text': 'استورد صورة قمر صناعي أو صورة محلية فيحوّلها المحرر تلقائيًا إلى تضاريس قابلة للعب.',
  'mapbuild.f.share.title': 'احفظ وشارك',
  'mapbuild.f.share.text': 'مكتبة خرائط غير محدودة، واستيراد وتصدير ملفات JSON، وانشر خرائطك في مستودع خرائط المجتمع — أو حمّل خرائط الآخرين.',
  'mapbuild.o.spawns.title': 'نقاط ظهور اللاعبين',
  'mapbuild.o.spawns.text': 'نقطة بداية واحدة ملوّنة بحسب الفريق لكل لاعب حتى 8 لاعبين.',
  'mapbuild.o.supply.title': 'حقول الإمداد',
  'mapbuild.o.supply.text': 'رقع مربعة ثابتة يستخرجها الحصادون لتصبح اعتمادات.',
  'mapbuild.o.oil.title': 'حقول النفط',
  'mapbuild.o.oil.text': 'برك نفط دائرية — مصدر دخل ثانٍ يستحق القتال عليه.',
  'mapbuild.o.rock.title': 'الصخور',
  'mapbuild.o.rock.text': 'غطاء لا يمكن عبوره يمنع الحركة ويقطع خط الرؤية.',
  'mapbuild.o.tree.title': 'الأشجار',
  'mapbuild.o.tree.text': 'غطاء طبيعي ومظهر حي حول نقاط الظهور والقواعد.',
  'mapbuild.o.wreck.title': 'الحطام',
  'mapbuild.o.wreck.text': 'بقايا مركبات محترقة — مشاهد ميدانية وغطاء في المعركة.',
  'mapbuild.o.terrain.title': 'التضاريس والألوان',
  'mapbuild.o.terrain.text': 'الماء والمنحدرات والطرق ولوحة ألوان مخصصة كاملة للأرض.',
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
  'cat.scenery': 'التضاريس والأشياء',
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
  'cat.scenery.rock.name': 'صخرة',
  'cat.scenery.rock.desc': 'تضاريس غير قابلة للعبور تمنع الحركة وخط النار.',
  'cat.scenery.tree.name': 'شجرة',
  'cat.scenery.tree.desc': 'تضاريس تُبطئ الوحدات التي تتحرك خلالها.',
  'cat.scenery.wreck.name': 'حطام',
  'cat.scenery.wreck.desc': 'بقايا مركبة مدمّرة — غطاء للمشاة وحاجز للمركبات.',
  'cat.scenery.mine.name': 'لغم',
  'cat.scenery.mine.desc': 'ينفجر عند التلامس ويضر بأي شيء يخطو عليه.',
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
  'footer.rights': 'صُنعت بحب ♥ — العب، عدّل، شارك.',
  'footer.terms': 'شروط الاستخدام',
  'footer.privacy': 'سياسة الخصوصية',
  'footer.contact': 'تواصل',
  'legal.updated': 'آخر تحديث: 20 أكتوبر 2026',

  // ---- شروط الاستخدام (terms.html) ----
  'terms.docTitle': 'شروط الاستخدام · ساحات الفضاء',
  'terms.title': 'شروط الاستخدام',
  'terms.intro':
    'ساحات الفضاء لعبة استراتيجية مفتوحة المصدر في الزمن الحقيقي. تغطي هذه الشروط اللعبة، والموقع على https://sdevrami.github.io/space-arenas («الموقع»)، والخدمة على الإنترنت التي تدعمها — القاعات، ولوحة المتصدرين، ومستودع المجتمع («الخدمة»). يُرجى قراءتها قبل اللعب عبر الإنترنت.',
  'terms.s1.title': '1. الموافقة',
  'terms.s1.text':
    'باستخدامك الموقع، أو إنشاء حساب، أو اللعب عبر الإنترنت، فإنك توافق على هذه الشروط. وإذا لم توافق، فلا تستخدم الخدمة — تظل اللعبة دون اتصال وشيفرتها المصدرية متاحة وفق ترخيص المستودع.',
  'terms.s2.title': '2. عن الخدمة',
  'terms.s2.text':
    'الخدمة مشروع مجاني غير تجاري يديره متطوعون. وهي ليست ضرورية للعب: فاللعب الفردي والمحلي يعمل في متصفحك دون حساب. ولا يلزم الحساب إلا للقاعات عبر الإنترنت، ولوحة المتصدرين، والنسخ الاحتياطية المشفّرة، والنشر في مستودع المجتمع.',
  'terms.s3.title': '3. الأهلية وحسابك',
  'terms.s3.text':
    'يجب أن يكون عمرك 13 عاماً على الأقل (أو الحد الأدنى لعمر الموافقة الرقمية في بلدك) لإنشاء حساب. تُنشأ الحسابات بتسجيل الدخول عبر Google داخل اللعبة — ولا نرى كلمة مرور Google أو نخزّنها أبداً. حافظ على أمان حساب Google الخاص بك: فمن يستطيع تسجيل الدخول به يستطيع استخدام حسابك في ساحات الفضاء. استخدم حساباً واحداً لكل شخص؛ ولا تشارك الحسابات أو تبيعها أو تشتريها أو تنقلها، ولا تنشئ حسابات تلقائياً أو بالجملة.',
  'terms.s4.title': '4. الاستخدام المقبول',
  'terms.s4.text':
    'أنت توافق على ألا تقوم بـ: الغش، أو تعديل العميل للحصول على ميزة، أو استغلال الأخطاء في المباريات المصنّفة أو المتحقَّق منها؛ أو العبث بالبروتوكول أو الخادم أو عملاء اللاعبين الآخرين؛ أو نشر محتوى غير قانوني أو كراهية أو تحرّش أو جنسي صريح أو ينتهك حقوق الآخرين؛ أو انتحال شخصية المطوّرين أو اللاعبين الآخرين، أو استخدام اسم محجوز؛ أو مهاجمة الخدمة أو واجهتها أو إثقالها أو كشطها أو إساءة استخدامها بأي شكل، أو محاولة الوصول إلى بيانات أو حسابات لا تخصّك؛ أو توزيع برمجيات خبيثة أو أي شيء يضر اللاعبين الآخرين.',
  'terms.s5.title': '5. أسماء المستخدمين والملفات الشخصية',
  'terms.s5.text':
    'اسم المستخدم هو معرّفك العام في القاعات وعلى لوحة المتصدرين وعلى كل ما تنشره. يجب أن يكون من 1 إلى 24 حرفاً، وهو فريد بصرف النظر عن حالة الأحرف. ويحق لنا حجز أو رفض أو تغيير أو استعادة الأسماء المضلّلة أو المسيئة أو المنتحِلة أو المنتهِكة للحقوق. وتعرض الملفات الشخصية اسم المستخدم وإحصاءات اللعب فقط.',
  'terms.s6.title': '6. المحتوى الذي تنشره',
  'terms.s6.text':
    'عند نشرك تعديل توازن أو خريطة، أو إضافة تقييم أو تعليق، تظل مالكاً له. وتمنح المشروع ترخيصاً عالمياً غير حصري وبلا مقابل لتخزين ذلك المحتوى وعرضه وتوزيعه والسماح للاعبين الآخرين بتنزيله كجزء من الخدمة. وأنت تؤكد أنك تملكه أو لديك حقوق مشاركته، وأنه لا يخالف أي قانون أو ترخيص طرف ثالث (بما في ذلك تراخيص أي أصول استخدمتها).',
  'terms.s7.title': '7. التنزيلات ومحتوى الغير',
  'terms.s7.text':
    'تعديلات وخرائط المجتمع من صنع لاعبين آخرين، وتُقدَّم «كما هي» دون مراجعة أو ضمان. وتنزيلها واستخدامها على مسؤوليتك — فقد تغيّر توازن اللعبة بطرق غير متوقعة. نزّل فقط من هذا الموقع أو من خلال المستودع داخل اللعبة، وأبلغ عن أي شيء ضار.',
  'terms.s8.title': '8. اللعب النزيه',
  'terms.s8.text':
    'تسجّل المباريات المصنّفة الإعدادات والنتائج، وتُوسَم العملاء التي تتلاعب بهذه القيم. وإذا اعتقدنا بشكل معقول أن نتيجة ما جاءت بالغش أو الاستغلال أو التلاعب، فقد نرفض النتيجة أو نبطلها، أو نعدّل الإحصاءات، أو نحذف المحتوى المنشور، أو نقيّد الوصول إلى الميزات عبر الإنترنت. وهذا قرار بشري يدوي، وليس نظام عقوبات تلقائياً.',
  'terms.s9.title': '9. التوفّر والتغييرات',
  'terms.s9.text':
    'الخدمة مجانية وتُقدَّم على أساس أفضل جهد. وقد تتغير الميزات أو تتعطل أو تتوقف في أي وقت، بما في ذلك الإزالة الدائمة لميزات الإنترنت أو إعادة ضبط لوحة المتصدرين أو فقدان البيانات. ونحاول الإعلان عن التغييرات المهمة في المستودع، لكننا لا نضمن توفّراً متواصلاً.',
  'terms.s10.title': '10. الملكية الفكرية',
  'terms.s10.text':
    'تُنشر شيفرة اللعبة ورسوماتها وأصواتها وموقعها وفق الترخيص المذكور في مستودع المشروع. أما اسم «ساحات الفضاء» وشعاراتها فتملُكها جهة صيانة المشروع. وتبقى الأجزاء الخارجية (مثل تسجيل الدخول عبر Google وSupabase وGitHub Pages) تحت شروطها الخاصة.',
  'terms.s11.title': '11. إخلاء المسؤولية عن الضمانات',
  'terms.s11.text':
    'يُقدَّم الموقع والخدمة وكل محتوى المجتمع «كما هي» و«حسب التوفّر»، دون أي ضمانات صريحة أو ضمنية، بما في ذلك القابلية للتسويق والملاءمة لغرض معين وعدم الانتهاك. ولا نضمن أن تكون الخدمة خالية من الأخطاء أو آمنة أو متواصلة، ولا أن البيانات — النسخ الاحتياطية أو الإحصاءات أو المحتوى المنشور — لن تُفقد أبداً.',
  'terms.s12.title': '12. حدود المسؤولية',
  'terms.s12.text':
    'إلى الحد الأقصى الذي يسمح به القانون، لا تتحمل جهة الصيانة والمساهمون مسؤولية أي أضرار غير مباشرة أو عرضية أو خاصة أو تبعية أو تأديبية، ولا فقدان البيانات أو التقدم أو الأرباح، الناتجة عن استخدامك للخدمة — حتى مع إبلاغهم بإمكان حدوث ذلك. ولأن الخدمة مجانية، فإن مسؤوليتنا الإجمالية عن أي مطالبة تقتصر على ما دفعتَه لنا: صفر. ولا يحد أي شيء هنا من حقوقك بموجب قوانين حماية المستهلك الإلزامية في بلدك.',
  'terms.s13.title': '13. التعليق والإنهاء',
  'terms.s13.text':
    'يمكنك التوقف عن استخدام الخدمة في أي وقت. ويحق لنا تعليق أو إنهاء الوصول إلى الميزات عبر الإنترنت إذا خُرقت هذه الشروط، أو لحماية الخدمة ولاعبيها. ولحذف حسابك وبياناتك المرتبطة به، استخدم قناة التواصل أدناه.',
  'terms.s14.title': '14. تغييرات هذه الشروط',
  'terms.s14.text':
    'قد نحدّث هذه الشروط مع تطور الخدمة. وتظهر النسخة الجديدة على هذه الصفحة بتاريخ «آخر تحديث» جديد، وتُذكر التغييرات الجوهرية في المستودع. واستمرارك في استخدام الخدمة بعد التغيير يعني قبولك للشروط المحدَّثة.',
  'terms.s15.title': '15. التواصل',
  'terms.s15.text': 'للأسئلة حول هذه الشروط: افتح بلاغاً على https://github.com/SDevRami/space-arenas/issues.',

  // ---- سياسة الخصوصية (privacy.html) ----
  'privacy.docTitle': 'سياسة الخصوصية · ساحات الفضاء',
  'privacy.title': 'سياسة الخصوصية',
  'privacy.s1.title': '1. الخصوصية باختصار',
  'privacy.s1.text':
    'نجمع أقل قدر ممكن. للعب عبر الإنترنت تسجّل الدخول عبر Google، ونحتفظ ببريدك الإلكتروني الذي يعيده Google، واسم المستخدم الذي تختاره، وإحصاءات مبارياتك، وكل ما تنشره عمداً (تعديلات، خرائط، تقييمات، تعليقات) أو تحفظه (نسخ احتياطية مشفّرة). ولا نبيع بياناتك، ولا نشغّل إعلانات ولا تحليلات من أطراف ثالثة، ويعمل الموقع دون أي حساب على الإطلاق.',
  'privacy.s2.title': '2. من نحن وما الذي تشمله هذه السياسة',
  'privacy.s2.text':
    'ساحات الفضاء مشروع لعبة مفتوح المصدر وغير تجاري. توضّح هذه السياسة كيف يتعامل الموقع («الموقع») والخدمة على الإنترنت التي تدعمه («الخدمة») مع البيانات الشخصية. أما اللعبة دون اتصال فلا تحتاج إلى حساب ولا ترسل بياناتك إلى أي مكان. وجهة صيانة المشروع (انظر التواصل) هي المتحكّم بالخدمة.',
  'privacy.s3.title': '3. معلومات تقدّمها لنا',
  'privacy.s3.text':
    'الحساب: عند تسجيل الدخول عبر Google نتلقى معرّف حساب Google وبريدك الإلكتروني والملف الأساسي الذي يشاركه Google (الاسم والصورة) — ويُستخدم لإنشاء حسابك والتأكد من أنه لك. ولا نتلقى كلمة مرور Google أبداً. ثم تختار اسم مستخدم عاماً. المحتوى: تعديلات التوازن والخرائط التي تنشرها، والتقييمات والتعليقات التي تضعها، وأيضاً — إن استخدمتها — نسخ احتياطية مشفّرة لإعدادات لعبتك وملفك. رسائل الدعم: أي شيء تضمّنه عند تواصلك معنا، مثل بلاغ على GitHub.',
  'privacy.s4.title': '4. معلومات تُنشأ باللعب',
  'privacy.s4.text':
    'سجلات المباريات (الخريطة، الفائز، المشاركون، النتائج)، وعدّادات ملفك (المباريات، الانتصارات، أعلى نتيجة)، ومدخلات لوحة المتصدرين. وتُستخدم لجعل لوحة المتصدرين وسجل المباريات يعملان، وتظهر للاعبين الآخرين مع اسم المستخدم الخاص بك.',
  'privacy.s5.title': '5. معلومات تقنية',
  'privacy.s5.text':
    'مثل أي خدمة ويب، يرى الخادم عنوان IP وتفاصيل الطلب الأساسية للاتصالات (المسار، الوقت، المتصفح)، وتُستخدم لفرض حدود المعدل ومنع الإساءة. وتُعدّ اتصالات WebSocket لأغراض السعة. أما حركة المرور داخل المباراة الجارية فتُمرَّر بين اللاعبين ولا تُخزَّن. وسجلات الخادم مؤقتة ولا تُستخدم لبناء ملف عنك.',
  'privacy.s6.title': '6. التخزين في متصفحك',
  'privacy.s6.text':
    'يحفظ الموقع واللعبة كميات صغيرة من البيانات في التخزين المحلي لمتصفحك: لغتك المختارة، وذاكرة مؤقتة قصيرة لقائمة التعديلات والخرائط العامة، و(في اللعبة) رمز جلستك وإعداداتك. وهذا تخزين وظيفي لا تتبّع. ولا نستخدم أي ملفات تعريف إعلانية أو أدوات تتبّع عبر المواقع أو تحليلات من أطراف ثالثة.',
  'privacy.s7.title': '7. ما لا نقوم به',
  'privacy.s7.text':
    'لا نبيع البيانات الشخصية أو نؤجّرها؛ ولا نشغّل إعلانات أو تسويقاً بالبريد؛ ولا نتتبّعك عبر مواقع أخرى؛ ولا نجمع كلمات المرور (فالتسجيل يتم عبر Google)؛ ولا نبني ملفات إعلانية.',
  'privacy.s8.title': '8. تسجيل الدخول عبر Google والخدمات الخارجية',
  'privacy.s8.text':
    'يُدار تسجيل الدخول بواسطة Google (OAuth) عبر Supabase Auth. ويجري تخزين البيانات ومعالجتها لدى: Supabase (المصادقة واستضافة قاعدة البيانات)، وRender (استضافة واجهة الإنترنت — القاعات، لوحة المتصدرين، المستودعات)، وGitHub Pages / GitHub (استضافة الموقع والمستودع المصدري)، وGoogle (تسجيل الدخول وشاشة الموافقة). ولكل منهم شروطه وسياسة خصوصيته. ولا نشارك البيانات معهم إلا لتشغيل الخدمة، ولا نمنحهم إذناً باستخدامها في إعلاناتهم الخاصة.',
  'privacy.s9.title': '9. كيف نستخدم معلوماتك',
  'privacy.s9.text':
    'لإنشاء حسابك وتأمينه؛ وتشغيل القاعات والترتيب والنسخ الاحتياطية؛ وعرض محتوى المجتمع وتوزيعه؛ ومنع الغش والإساءة؛ والرد على طلباتك؛ والامتثال للقانون. وحيثما ينطبق النظام الأوروبي (GDPR) نعتمد على تنفيذ العقد (تشغيل الخدمة التي سجّلت فيها)، والمصالح المشروعة (الأمان ومنع الإساءة)، وعند الاقتضاء موافقتك — ويمكنك سحبها في أي وقت بمجرد استخدام اللعبة دون حساب.',
  'privacy.s10.title': '10. مدة الاحتفاظ',
  'privacy.s10.text':
    'تبقى الملفات والإحصاءات والمحتوى المنشور ما دام حسابك قائماً. وتُحفظ سجلات المباريات لتاريخ لوحة المتصدرين، ولكن جدول المباريات محدود بعدد معيّن من أحدث الصفوف. وتنتهي النسخ الاحتياطية تلقائياً. وتُحفظ سجلات الطلبات المؤقتة للمدة اللازمة للأمان فقط. وحذف حسابك يحذف الصفوف المرتبطة به (الملف، الإحصاءات، مدخل لوحة المتصدرين، النسخ الاحتياطية).',
  'privacy.s11.title': '11. حقوقك وحذف بياناتك',
  'privacy.s11.text':
    'يمكنك رؤية إحصاءاتك في اللعبة، وتغيير اسم المستخدم في قاعة اللعب، وطلب الوصول إلى بياناتك أو تصحيحها أو تصديرها أو حذفها عبر قناة التواصل أدناه. وفي المنطقة الاقتصادية الأوروبية والمملكة المتحدة يمكنك أيضاً الاعتراض وطلب تقييد المعالجة والشكوى إلى سلطة حماية البيانات المحلية. وننفّذ طلبات الحذف بإزالة ملفك والصفوف المرتبطة به، وبإزالة اسم المستخدم من سجل المباريات المحفوظ عند الطلب. ولأن الخدمة مجانية ويديرها متطوعون، يُرجى منحنا وقتاً معقولاً.',
  'privacy.s12.title': '12. الأطفال',
  'privacy.s12.text':
    'الخدمة غير موجّهة للأطفال دون 13 عاماً (أو الحد الأدنى لعمر الموافقة الرقمية في بلدك). ولا ننشئ حسابات لهم عن علم؛ وإذا كنت تعتقد أن طفلاً لديه حساب، فتواصل معنا وسنحذفه.',
  'privacy.s13.title': '13. الأمان',
  'privacy.s13.text':
    'تنتقل البيانات عبر HTTPS، ولا تصل أسرار الخادم (مفاتيح خدمة قاعدة البيانات) إلى متصفحك أبداً، وتُشفَّر النسخ الاحتياطية بعبارة مرور لا تغادر جهازك أبداً (ولا نخزّن سوى بصمة للتحقق لرفض عبارة المرور الخاطئة)، وتُقارن كلمات مرور الغرف كبصمات، والوصول إلى قاعدة البيانات مقيّد. ولا يوجد نظام آمن تماماً.',
  'privacy.s14.title': '14. النقل الدولي',
  'privacy.s14.text':
    'قد يعالج مزوّدونا (Supabase وRender وGitHub وGoogle) البيانات ويخزّنونها خارج بلدك، بما في ذلك في الولايات المتحدة والاتحاد الأوروبي، وفق ضمانات تعاقدية قياسية أو مكافئة.',
  'privacy.s15.title': '15. تغييرات هذه السياسة',
  'privacy.s15.text':
    'قد نحدّث هذه السياسة عند تغيّر الخدمة. وتُنشر النسخة الجديدة هنا بتاريخ جديد؛ وتُذكر التغييرات الجوهرية في المستودع.',
  'privacy.s16.title': '16. التواصل',
  'privacy.s16.text': 'أسئلة الخصوصية وطلبات البيانات: افتح بلاغاً على https://github.com/SDevRami/space-arenas/issues.',
  'lang.other': 'English',
}

const LANGS = { en: EN, ar: AR }

/* ---------------- game catalog (mirrors shared/src/balance) ---------------- */

const CATALOG = {
  units: [
    { id: 'bulldozer', cls: 'vehicle', cost: 100, s: 5, hp: 300, vis: 4, spd: 55, prod: 'command-center', img: './img/hud/hud_v_b.png' },
    { id: 'harvester', cls: 'vehicle', cost: 0, s: 8, hp: 600, vis: 4, spd: 60, prod: 'supply-dock', img: './img/hud/hud_v_h.png' },
    { id: 'scout', cls: 'infantry', cost: 50, s: 5, hp: 100, vis: 10, spd: 120, prod: 'barracks', img: './img/hud/hud_t_s.png' },
    { id: 'rifleman', cls: 'infantry', cost: 100, s: 10, hp: 200, vis: 6, spd: 90, prod: 'barracks', w: 'rifle', img: './img/hud/hud_t_r.png' },
    { id: 'rocket-trooper', cls: 'infantry', cost: 150, s: 12, hp: 150, vis: 6, spd: 80, prod: 'barracks', w: 'rocket', img: './img/hud/hud_t_l.png' },
    { id: 'assault-walker', cls: 'vehicle', cost: 250, s: 15, hp: 400, vis: 8, spd: 72, prod: 'war-factory', w: 'cannon', img: './img/hud/hud_v_aw.png' },
    { id: 'aa-platform', cls: 'vehicle', cost: 300, s: 18, hp: 350, vis: 8, spd: 68, prod: 'war-factory', w: 'aa', img: './img/hud/hud_v_aa.png' },
    { id: 'artillery', cls: 'vehicle', cost: 350, s: 22, hp: 250, vis: 9, spd: 48, prod: 'war-factory', w: 'artillery', img: './img/hud/hud_v_a.png' },
    { id: 'engineer', cls: 'vehicle', cost: 150, s: 12, hp: 150, vis: 6, spd: 90, prod: 'war-factory', img: './img/hud/hud_v_e.png' },
    { id: 'apc', cls: 'vehicle', cost: 200, s: 10, hp: 250, vis: 7, spd: 78, prod: 'war-factory', cap: 10, img: './img/hud/hud_v_at.png' },
    { id: 'fighter', cls: 'air', cost: 200, s: 15, hp: 150, vis: 8, spd: 130, prod: 'air-force', w: 'air-cannon', cap: 3, ammo: 2, img: './img/hud/hud_v_f.png' },
    { id: 'carrier', cls: 'naval', cost: 600, s: 35, hp: 900, vis: 8, spd: 55, prod: 'dock', cap: 12, img: './img/hud/hud_v_c.png' },
    { id: 'missile-boat', cls: 'naval', cost: 350, s: 20, hp: 320, vis: 8, spd: 80, prod: 'dock', w: 'sea-missile', img: './img/hud/hud_v_mb.png' },
  ],
  buildings: [
    { id: 'command-center', cost: 500, s: 30, hp: 2000, pGen: 10, pUse: 0, produces: 'bulldozer', img: './img/hud/hud_cc.png' },
    { id: 'power-plant', cost: 200, s: 20, hp: 800, pGen: 50, pUse: 0, img: './img/hud/hud_pp.png' },
    { id: 'supply-dock', cost: 300, s: 20, hp: 800, pGen: 0, pUse: 5, produces: 'harvester', img: './img/hud/hud_sd.png' },
    { id: 'barracks', cost: 200, s: 20, hp: 600, pGen: 0, pUse: 5, produces: 'rifleman', img: './img/hud/hud_b.png' },
    { id: 'war-factory', cost: 400, s: 30, hp: 900, pGen: 0, pUse: 10, produces: 'assault-walker', img: './img/hud/hud_wf.png' },
    { id: 'turret', cost: 150, s: 15, hp: 500, pGen: 0, pUse: 5, w: 'turret-gun', img: './img/hud/hud_t.png' },
    { id: 'tech-center', cost: 500, s: 40, hp: 700, pGen: 0, pUse: 10, img: './img/hud/hud_tc.png' },
    { id: 'air-force', cost: 500, s: 25, hp: 900, pGen: 0, pUse: 15, produces: 'fighter', img: './img/hud/hud_af.png' },
    { id: 'super-weapon', cost: 1500, s: 45, hp: 1500, pGen: 0, pUse: 100, img: './img/hud/hud_sp.png' },
    { id: 'bunker', cost: 250, s: 20, hp: 700, pGen: 0, pUse: 5, w: 'bunker-gun', garrison: 5, img: './img/hud/hud_bn.png' },
    { id: 'dock', cost: 400, s: 30, hp: 900, pGen: 0, pUse: 10, produces: 'carrier', img: './img/hud/hud_d.png' },
  ],
  scenery: [
    { id: 'rock', img: './img/scenery/rock.png' },
    { id: 'tree', img: './img/scenery/tree.png' },
    { id: 'wreck', img: './img/scenery/wreck.png' },
    { id: 'mine', img: './img/scenery/mine.png' },
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

const MAPBUILD_FEATURES = [
  { icon: '📐', k: 'resize' },
  { icon: '🖌️', k: 'terrain' },
  { icon: '🎯', k: 'spawns' },
  { icon: '⛽', k: 'economy' },
  { icon: '🌍', k: 'world' },
  { icon: '📦', k: 'share' },
]

const MAPBUILD_OBJECTS = [
  { icon: '🎯', k: 'spawns' },
  { icon: '⛽', k: 'supply' },
  { icon: '🛢️', k: 'oil' },
  { icon: '🪨', k: 'rock' },
  { icon: '🌲', k: 'tree' },
  { icon: '💥', k: 'wreck' },
  { icon: '🟩', k: 'terrain' },
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

const renderMapBuilder = () => {
  const el = document.getElementById('mapbuilder-gallery')
  if (!el) return
  const cards = (items) =>
    items
      .map(
        (o) =>
          `<article class="card">` +
          `<span class="card-icon">${o.icon}</span>` +
          `<h3>${t(lang, `mapbuild.${o.k}.title`)}</h3>` +
          `<p>${t(lang, `mapbuild.${o.k}.text`)}</p>` +
          `</article>`,
      )
      .join('')
  el.innerHTML =
    `<div class="catalog-group"><h2 class="group-title">${t(lang, 'mapbuild.group.features')}</h2>` +
    `<div class="grid">${cards(MAPBUILD_FEATURES.map((o) => ({ ...o, k: `f.${o.k}` })))}</div></div>` +
    `<div class="catalog-group"><h2 class="group-title">${t(lang, 'mapbuild.group.objects')}</h2>` +
    `<div class="grid">${cards(MAPBUILD_OBJECTS.map((o) => ({ ...o, k: `o.${o.k}` })))}</div></div>`
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

const renderSceneryCard = (s) => {
  const nm = t(lang, 'cat.scenery.' + s.id + '.name')
  const desc = t(lang, 'cat.scenery.' + s.id + '.desc')
  return (
    `<article class="card cat-card">` +
    `<img class="cat-sprite" src="${s.img}" alt="${nm}" loading="lazy" />` +
    `<h3>${nm}</h3>` +
    `<p class="cat-role">${desc}</p>` +
    `</article>`
  )
}

const renderCatalog = () => {
  const el = document.getElementById('game-catalog')
  if (!el) return
  el.innerHTML =
    `<h2 class="group-title">${t(lang, 'cat.buildings')}</h2>` +
    `<div class="grid cat-grid">${CATALOG.buildings.map(renderBuildingCard).join('')}</div>` +
    `<h2 class="group-title">${t(lang, 'cat.units')}</h2>` +
    `<div class="grid cat-grid">${CATALOG.units.map(renderUnitCard).join('')}</div>` +
    `<h2 class="group-title">${t(lang, 'cat.scenery')}</h2>` +
    `<div class="grid cat-grid">${CATALOG.scenery.map(renderSceneryCard).join('')}</div>` +
    `<h2 class="group-title">${t(lang, 'cat.weapons')}</h2>` +
    renderWeaponsTable() +
    `<h2 class="group-title">${t(lang, 'cat.upgrades')}</h2>` +
    renderUpgradesTable()
}

const renderDynamic = () => {
  renderSystems()
  renderMapBuilder()
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
  reloadRepoViews()
}
/* ---------------- community hub: mods / maps (read-only) ---------------- */

const modsEl = () => document.getElementById('community-grid')
const mapsEl = () => document.getElementById('community-maps-grid')
const statusEl = () => document.getElementById('community-status')
const mapsStatusEl = () => document.getElementById('community-maps-status')

const starsFor = (avg) => {
  if (avg === null || avg === undefined) return null
  const n = Math.round(avg)
  return '\u2605'.repeat(n) + '\u2606'.repeat(5 - n)
}

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US') : String(n))

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const setStatus = (text, isError = false, el = statusEl()) => {
  if (!el) return
  el.textContent = text
  el.classList.toggle('error', isError)
}

const fetchRepo = async (kind, sort = 'rating') => {
  const res = await fetch(`${SA_ONLINE_URL}/api/${kind}/repo?sort=${sort}&limit=250`, {
    headers: { Accept: 'application/json' },
  })
  const body = await res.json()
  return res.ok && Array.isArray(body[kind]) ? body[kind] : null
}

const renderRepoGrid = (grid, data, kind, errText, emptyText) => {
  if (data === null) {
    grid.innerHTML = `<p class="mods-empty">${errText}</p>`
    return
  }
  if (!Array.isArray(data) || data.length === 0) {
    grid.innerHTML = `<p class="mods-empty">${emptyText}</p>`
    return
  }
  grid.innerHTML = data.map((m) => fmtCard(m, kind)).join('')
}

const loadMods = async (force = false) => {
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
    data = await fetchRepo('mods')
    if (data) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }))
      } catch {
        /* storage full / private mode */
      }
    }
  }
  renderRepoGrid(grid, data, 'mod', t(lang, 'community.error'), t(lang, 'community.empty'))
}

const loadMaps = async (force = false) => {
  const grid = mapsEl()
  if (!grid) return
  grid.innerHTML = `<p class="mods-empty">${t(lang, 'community.loading')}</p>`
  let data = null
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(MAPS_CACHE_KEY) ?? 'null')
      if (cached && Date.now() - cached.at < MODS_TTL_MS) data = cached.data
    } catch {
      /* ignore bad cache */
    }
  }
  if (data === null) {
    data = await fetchRepo('maps')
    if (data) {
      try {
        localStorage.setItem(MAPS_CACHE_KEY, JSON.stringify({ at: Date.now(), data }))
      } catch {
        /* storage full / private mode */
      }
    }
  }
  renderRepoGrid(grid, data, 'map', t(lang, 'community.maps.error'), t(lang, 'community.maps.empty'))
}

const reloadRepoViews = (force = false) => {
  void loadMods(force)
  void loadMaps(force)
}

/** Read-only catalog card. Downloading, rating and publishing all live inside the game
 *  client, so the landing shows the numbers but offers no interactive controls. */
const fmtCard = (m, kind) => {
  const stars = starsFor(m.ratingAvg)
  const ratingLine = stars
    ? `<span class="stars">${stars}</span> <span>${t(lang, 'community.rating', { avg: m.ratingAvg, c: m.ratingCount })}</span>`
    : `<span class="mod-meta">${t(lang, 'community.noRating')}</span>`
  const byName = m.ownerName ? m.ownerName : m.author ? m.author : '?'
  const metaLine =
    kind === 'map'
      ? `<div class="mod-meta">${m.width}\u00d7${m.height} \u00b7 ${t(lang, 'community.players', { n: m.players })} \u00b7 ${t(lang, 'community.by', { name: escapeHtml(byName) })}</div>`
      : `<div class="mod-meta">${t(lang, 'community.by', { name: escapeHtml(byName) })}</div>`
  return (
    `<article class="card mod-card">` +
    `<h3>${escapeHtml(m.name)}</h3>` +
    metaLine +
    (m.description ? `<div class="mod-desc">${escapeHtml(m.description)}</div>` : '') +
    `<div class="mod-line">${ratingLine}<span class="mod-downloads">\u2B07 ${t(lang, 'community.downloads', { n: fmt(m.downloads) })}</span></div>` +
    `</article>`
  )
}

const switchCommunityTab = (tab) => {
  document.querySelectorAll('.community-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab))
  document.querySelectorAll('.community-panel').forEach((p) => {
    p.hidden = p.dataset.panel !== tab
  })
  if (tab === 'maps') void loadMaps(false)
  else void loadMods(false)
}

document.addEventListener('DOMContentLoaded', () => {
  let currentPage = (window.location.pathname.split('/').pop() || 'index.html').split('?')[0]
  if (!currentPage.endsWith('.html')) currentPage = 'index.html'
  for (const a of document.querySelectorAll('.nav a[data-page]')) {
    if (a.getAttribute('data-page') === currentPage) a.classList.add('active')
  }

  // No sign-in here any more: the catalog is public and read-only, and the language toggle
  // re-renders it. Downloading / rating / publishing live in the game client.
  setLang(lang)

  document.getElementById('lang-toggle')?.addEventListener('click', () => setLang(lang === 'en' ? 'ar' : 'en'))
  document.querySelectorAll('.community-tab').forEach((b) => b.addEventListener('click', () => switchCommunityTab(b.dataset.tab)))
})
