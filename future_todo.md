## (a) Online Server — lobby panel (placeholder UI)

### What was added (just ui, online lobby panel)
- New lobby sidebar button **Online Server** (`#tab-online`, i18n `lobby.tab.online`) and panel `#online-panel` in `client/index.html`.
- Panel groups inputs into two columns:
  - **Account**: user name, email, password.
  - **Server**: server link (`wss://…`), database link, server region select (auto / EU / NA / Asia / Middle East / Africa / South America / Oceania).
- Action buttons: **Log in**, **Register**, **Change password**, **Connect**, **Refresh**, plus **+ Create match**, **Join selected**, **Clear table**.
- **Current matches** table (`#online-matches-table`) with columns Room / Map / Players / Status, rendered by `renderOnlineMatches()` in `client/src/main.ts`.


## my idea for the online system

### the server will be hosted on render (free tier) : the server should be working as channel for the game comms like now ever y player shoudl have the game files or get an invite from player that host a game (have the game full files to host) so it working on lan , now the render server should be workingon same system for lan but it make the game playable online (player can join and play from differant places) so the game hosting not on server its on clients devices
- so players to play online match search about host online public username or room id , or can select any room upper in the table (in online lobby panel)
- onlnie match cannot created without password (password input filed required)
- for anti-cheat simple sync in match player settings and values (there is now simple one for dev settings)
- also server should have front-end landing page for game info and Online mod repository: browse, rate, download balance mods, simple Community voting and comment section for reviews

### the database will be accessed by the server and hosted on supabase (free tier) : db should save online players profiles (not related to current offline profile)
- in online lobby should add tabs (current panel named 'quick match') and add tab 'leader board' that show player online profile status and teh list of best players (high score/rank on server)
- account will use email and password simple signin/login system 
- online account save only online status for player (no local data saved on db) add tab 'data' that have buttons/options to backup data (devsettings values and local profile status) and this backuped data have expire-date so the player use this bacup system only to move the his game to another pc
- match replays saved localy for each client in the match (if press 'save replay')


