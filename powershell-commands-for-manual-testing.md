Run from the project root `D:\My Projects\23 - website HTML CSS JS\Space Arenas - RTS game`:

```powershell
npm test
```

That runs the full vitest suite (6 files, 47 tests). Others from the same root:

```powershell
npm test -- -t "e2e"     # only host e2e tests
npm run test:soak        # determinism/soak suite (serial)
npm run typecheck        # TS across all workspaces
npm run lint             # ESLint
npm run build            # production build, all workspaces
npm run validate:assets  # asset checks
```

Note: the e2e host test spawns its own host server automatically, so you don't need `npm run dev` running.

That's expected — `npm test` passed (47/47 green). The URLs in its output (`http://0.0.0.0:65284`) are **temporary test hosts** that the test suite spins up internally and kills when done. They're not meant to be opened in a browser.

To run the actual game in the browser:

```powershell
npm run dev
```

Then open `http://localhost:5173/` (client) and `http://localhost:5174/` (map builder). The host listens on port 17321 with a random room code shown in the terminal. Stop everything with `Ctrl+C`.

Use `npm test` only to verify the automated suite.

Yes — `Ctrl+C` stops the running command.

One caveat: in PowerShell, if `npm` spawns child processes (like the `concurrently` dev servers), `Ctrl+C` may leave orphaned node processes. If ports 5173/5174/17321 stay occupied afterward, run this to confirm they're down:

```powershell
Get-NetTCPConnection -LocalPort 5173,5174,17321 -State Listen -ErrorAction SilentlyContinue
```

If anything still shows, kill it with:

```powershell
Get-NetTCPConnection -LocalPort 5173,5174,17321 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```