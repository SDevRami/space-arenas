// Admin dashboard (Phase 7): password check, self-expiring session token, and the page itself.
//
// Deliberately undiscoverable: off unless `SA_ADMIN_PASSWORD` is set, never linked from the
// README, docs, landing pages or the game, and every response carries `X-Robots-Tag: noindex`.
// Read-only — there is no mutating action on this surface.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { ADMIN_ENABLED, ADMIN_PASSWORD, ADMIN_SESSION_TTL_MS } from './config.ts'

const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest()

export const adminEnabled = (): boolean => ADMIN_ENABLED

/** Constant-time password check. Both sides are SHA-256'd first so the buffers always have
 *  equal length (timingSafeEqual throws on a length mismatch, and a raw compare would leak). */
export const adminPasswordOk = (password: string): boolean => {
  if (!ADMIN_ENABLED) return false
  return timingSafeEqual(sha256(password), sha256(ADMIN_PASSWORD))
}

/** Signing key derived from the password (+ the room passphrase). Never stored, and rotating
 *  either value invalidates every outstanding token — which is the intended revocation path. */
const signingKey = (): Buffer => sha256(`sa-admin|${ADMIN_PASSWORD}|${process.env.SA_PASSPHRASE ?? ''}`)

const sign = (payload: string): string => createHmac('sha256', signingKey()).update(payload).digest('base64url')

/** Issues a stateless `<payload>.<signature>` token; the payload is the expiry timestamp. */
export const issueAdminToken = (now = Date.now()): { token: string; expiresAt: number } => {
  const expiresAt = now + ADMIN_SESSION_TTL_MS
  const payload = Buffer.from(String(expiresAt), 'utf8').toString('base64url')
  return { token: `${payload}.${sign(payload)}`, expiresAt }
}

/** Verifies the HMAC (constant-time) and the embedded expiry. Pure — `now` is injectable. */
export const verifyAdminToken = (token: string, now = Date.now()): boolean => {
  if (!ADMIN_ENABLED) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const payload = token.slice(0, dot)
  const provided = token.slice(dot + 1)
  const expected = sign(payload)
  if (provided.length !== expected.length) return false
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return false
  const expiresAt = Number(Buffer.from(payload, 'base64url').toString('utf8'))
  return Number.isFinite(expiresAt) && expiresAt > now
}

/** The whole dashboard: one self-contained page (no external assets, no dependency). */
export const adminPageHtml = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Space Arenas — Admin</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 18px; background: #0b0e14; color: #dbe3f0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
h1 { font-size: 17px; margin: 0; letter-spacing: 1px; text-transform: uppercase; }
h2 { font-size: 12px; margin: 0 0 10px; color: #8fa3c4; letter-spacing: 1.5px; text-transform: uppercase; }
.hidden { display: none !important; }
.muted { color: #7d8aa5; }
.err { color: #ff8080; font-size: 13px; min-height: 16px; margin-top: 10px; }
.card { max-width: 340px; margin: 14vh auto; background: #131824; border: 1px solid #26304a; border-radius: 10px; padding: 22px; }
.card p { margin: 6px 0 16px; }
input { width: 100%; padding: 10px 12px; background: #0b0e14; color: #dbe3f0; border: 1px solid #2c3856; border-radius: 6px; font: inherit; }
button { margin-top: 12px; width: 100%; padding: 10px 14px; background: #2b6cff; color: #fff; border: 1px solid #3f7dff; border-radius: 6px; font: inherit; cursor: pointer; }
button:hover { background: #3f7dff; }
button.ghost { width: auto; margin: 0; background: #1b2333; border-color: #2c3856; color: #b9c6dd; }
button.ghost:hover { background: #26304a; }
header { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
header .spacer { flex: 1; }
section { background: #10151f; border: 1px solid #1e2740; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.cell { background: #0b0e14; border: 1px solid #1b2333; border-radius: 6px; padding: 8px 10px; }
.cell .k { font-size: 11px; color: #7d8aa5; letter-spacing: .5px; text-transform: uppercase; }
.cell .v { font-size: 16px; margin-top: 3px; }
.stats { display: flex; gap: 20px; margin-bottom: 12px; color: #8fa3c4; }
.stats b { color: #dbe3f0; font-size: 17px; margin-right: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #1b2333; }
th { color: #7d8aa5; font-weight: 500; font-size: 11px; letter-spacing: .5px; text-transform: uppercase; }
</style>
</head>
<body>

<div id="admin-login" class="card">
  <h1>Admin</h1>
  <p class="muted">Read-only operations view.</p>
  <input id="admin-password" type="password" placeholder="Password" autocomplete="current-password" />
  <button id="admin-signin">Sign in</button>
  <div id="admin-error" class="err"></div>
</div>

<div id="admin-app" class="hidden">
  <header>
    <h1>Admin</h1>
    <span class="spacer"></span>
    <span id="admin-updated" class="muted"></span>
    <button id="admin-refresh" class="ghost">Refresh</button>
    <button id="admin-logout" class="ghost">Sign out</button>
  </header>
  <section><h2>Server</h2><div id="admin-server" class="grid"></div></section>
  <section><h2>Live lobby</h2><div id="admin-lobby"></div></section>
  <section><h2>Database</h2><div id="admin-db" class="grid"></div></section>
  <section><h2>Limits</h2><div id="admin-limits" class="grid"></div></section>
  <div id="admin-banner" class="err"></div>
</div>

<script>
(function () {
  'use strict';
  var TOKEN_KEY = 'space-arenas:admin-token';
  var loginEl = document.getElementById('admin-login');
  var appEl = document.getElementById('admin-app');
  var errEl = document.getElementById('admin-error');
  var bannerEl = document.getElementById('admin-banner');
  var pwEl = document.getElementById('admin-password');

  function token() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { if (t) { sessionStorage.setItem(TOKEN_KEY, t); } else { sessionStorage.removeItem(TOKEN_KEY); } } catch (e) {} }
  function showApp() { loginEl.classList.add('hidden'); appEl.classList.remove('hidden'); }
  function showLogin(msg) { appEl.classList.add('hidden'); loginEl.classList.remove('hidden'); errEl.textContent = msg || ''; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return (typeof n === 'number' && isFinite(n)) ? n.toLocaleString() : '—'; }
  function bytes(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    var u = ['B', 'KB', 'MB', 'GB']; var i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (Math.round(n * 10) / 10) + ' ' + u[i];
  }
  function dur(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '—';
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }
  function cell(label, value) { return '<div class="cell"><div class="k">' + esc(label) + '</div><div class="v">' + value + '</div></div>'; }

  function login() {
    errEl.textContent = '';
    fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwEl.value })
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, j: j }; });
    }).then(function (res) {
      if (res.status !== 200 || !res.j || !res.j.ok) { errEl.textContent = (res.j && res.j.error) || 'sign-in failed'; return; }
      setToken(res.j.data.token); pwEl.value = ''; showApp(); load();
    }).catch(function () { errEl.textContent = 'network error'; });
  }

  function load() {
    var t = token();
    if (!t) { showLogin(''); return; }
    fetch('/api/admin/stats', { headers: { Authorization: 'Bearer ' + t } }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, j: j }; });
    }).then(function (res) {
      if (res.status === 401) { setToken(''); showLogin('Session expired — sign in again.'); return; }
      if (res.status !== 200 || !res.j || !res.j.ok) { bannerEl.textContent = (res.j && res.j.error) || 'failed to load stats'; return; }
      bannerEl.textContent = '';
      showApp();
      render(res.j.data);
    }).catch(function () { bannerEl.textContent = 'network error'; });
  }

  function render(d) {
    document.getElementById('admin-updated').textContent = 'updated ' + new Date(d.now).toLocaleTimeString();

    var s = d.server;
    document.getElementById('admin-server').innerHTML =
      cell('Mode', esc(s.mode)) +
      cell('Protocol', s.protocol + ' <span class="muted">(min ' + s.minProtocol + ')</span>') +
      cell('Uptime', dur(s.uptimeMs)) +
      cell('Node', esc(s.node)) +
      cell('Memory RSS', bytes(s.memory.rss)) +
      cell('Heap used', bytes(s.memory.heapUsed) + ' <span class="muted">/ ' + bytes(s.memory.heapTotal) + '</span>') +
      cell('HTTP requests', num(s.http.requests)) +
      cell('HTTP 4xx', num(s.http.errors4xx)) +
      cell('HTTP 5xx', num(s.http.errors5xx)) +
      cell('Latency avg / p95', s.http.latencyMs.avg + 'ms <span class="muted">/ ' + s.http.latencyMs.p95 + 'ms</span>') +
      cell('Latency samples', num(s.http.latencyMs.samples)) +
      cell('WS active', num(s.ws.active)) +
      cell('WS total', num(s.ws.total)) +
      cell('WS messages in', num(s.ws.messagesIn)) +
      cell('Protocol violations', num(s.ws.protocolViolations)) +
      cell('Active relays', num(s.ws.relays)) +
      cell('Publishing', d.flags.publishingEnabled ? 'on' : 'off') +
      cell('Testers only', d.flags.testersOnly ? 'on' : 'off');

    var l = d.lobby;
    var rows = l.list.map(function (r) {
      return '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.hostName) + '</td><td>' + esc(r.mapName) +
        '</td><td>' + r.players + '/' + r.maxPlayers + '</td><td>' + esc(r.status) +
        '</td><td>' + (r.passwordRequired ? 'yes' : 'no') + '</td></tr>';
    }).join('');
    document.getElementById('admin-lobby').innerHTML =
      '<div class="stats"><span><b>' + num(l.rooms) + '</b> rooms</span><span><b>' + num(l.players) +
      '</b> players</span><span><b>' + num(l.started) + '</b> started</span></div>' +
      (rows
        ? '<table><thead><tr><th>Room</th><th>Host</th><th>Map</th><th>Players</th><th>Status</th><th>Password</th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="muted">No rooms open.</p>');

    var c = d.db.counts;
    document.getElementById('admin-db').innerHTML =
      cell('Configured', d.db.configured ? 'yes' : 'no') +
      cell('Reachable', d.db.reachable ? 'yes' : 'no') +
      cell('Accounts', num(c.profiles)) +
      cell('Matches', num(c.matches)) +
      cell('Mods', num(c.mods)) +
      cell('Mod ratings', num(c.modRatings)) +
      cell('Mod comments', num(c.modComments)) +
      cell('Maps', num(c.maps)) +
      cell('Map ratings', num(c.mapRatings)) +
      cell('Map comments', num(c.mapComments)) +
      cell('Backups', num(c.backups));

    document.getElementById('admin-limits').innerHTML = d.limits.map(function (x) {
      return cell(x.label, esc(x.value));
    }).join('');
  }

  document.getElementById('admin-signin').addEventListener('click', login);
  pwEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
  document.getElementById('admin-refresh').addEventListener('click', load);
  document.getElementById('admin-logout').addEventListener('click', function () { setToken(''); showLogin(''); });

  if (token()) { showApp(); load(); } else { showLogin(''); }
  setInterval(function () { if (token() && !appEl.classList.contains('hidden')) load(); }, 5000);
})();
</script>
</body>
</html>
`
