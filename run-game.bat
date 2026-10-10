@echo off
setlocal
title Space Arenas v0.1 - launcher by sdevrami
cd /d "%~dp0"

REM --- background worker modes: re-invoke this same script for the long steps so
REM     the parent window can keep drawing a live progress bar while it runs. ---
if /I "%~1"=="__bg_build" goto :bg_build
if /I "%~1"=="__bg_deps" goto :bg_deps

REM --- clear previously generated invite QR codes ---
if exist "%~dp0invites" (
  del /q "%~dp0invites\*" >nul 2>&1
)

set "SA_PORT=17321"
set "SA_PASSPHRASE=changeme"
if not "%~1"=="" set "SA_PORT=%~1"
if not "%~2"=="" set "SA_PASSPHRASE=%~2"
if not "%~3"=="" set "SA_ROOM_CODE=%~3"

REM --- bundled Node.js installer (optional self-healing install) ---
set "SA_MSI_PATH="
for %%F in ("%~dp0lib\*.msi") do set "SA_MSI_PATH=%%F"

REM Node major version this game needs.
set "SA_REQUIRED_NODE=20"

REM --- carriage return used to redraw progress bars in place (best effort). ---
set "CR="
for /f %%A in ('copy /Z "%~f0" nul') do set "CR=%%A"

echo.
echo  ==========================================================
echo   Space Arenas - Game
echo.
echo   This launcher first CHECKs your device (Node, npm, deps,
echo   port, firewall, disk), fixes what it can automatically, and
echo   then starts the LAN host with automatic player discovery.
echo   Open the URL below and pick "Network Play" to create or join
echo   a match. "Offline Game" works the same way.
echo.
echo   If Node.js is missing, a bundled installer from lib\ is used.
echo   Any leftover instance from a previous run is stopped
echo   automatically, so you never have to fix port conflicts.
echo.
echo   Press 'c' in this window to stop the game. The host and this
echo   window close, and the port is freed for the next run.
echo  ==========================================================
echo.

REM --- stop leftover Space Arenas node processes from previous runs ---
call :stop_stale_instances
if errorlevel 1 exit /b 1
call :drawbar 8 "Stopping previous instances"

REM --- PREREQUISITE CHECKLIST (pause on anything fatal) ---
echo  [CHECK] Node.js (%SA_REQUIRED_NODE%+) ...
call :check_node
if not defined SA_NODE_OK goto :fatal_node
call :drawbar 16 "Node.js %SA_NODE_VERSION% ready"

echo  [CHECK] npm ...
call :check_npm
if errorlevel 1 goto :fatal_npm
call :drawbar 22 "npm %SA_NPM_VERSION% ready"

echo  [CHECK] Project dependencies ...
call :check_deps
if errorlevel 1 goto :fatal_deps

echo  [CHECK] System / network readiness ...
call :check_system
call :drawbar 55 "System and network check"

REM -- dry-run mode: report only, do not start the game (useful for support) --
if defined SA_CHECK_ONLY (
  echo.
  echo  Check-only mode: prerequisites verified. Not starting the game.
  endlocal
  exit /b 0
)

REM --- ensure the game port is free (auto-picks the next free port) ---
call :ensure_free_port
if errorlevel 1 exit /b 1
call :drawbar 62 "Game port %SA_PORT% ready"

REM --- start loading page so the browser opens immediately ---
set "SA_LOADING_PID="
del "%~dp0tools\.loading-pid" >nul 2>&1
start /b node tools/loading-server.mjs >nul 2>&1
REM Wait (up to ~10s) for the loading server to publish its PID. A fixed 1s delay
REM was sometimes too short for a cold Node start, and a missed PID left the loading
REM server alive on our port. The host then drifted to a different port while the
REM browser stayed on the old one, hanging on "Building game..." until a re-run.
set "SA_WAIT=0"
:wait_loading_pid
timeout /t 1 /nobreak >nul
if exist "%~dp0tools\.loading-pid" set /p SA_LOADING_PID=<"%~dp0tools\.loading-pid"
if defined SA_LOADING_PID goto :loading_ready
set /a SA_WAIT+=1
if %SA_WAIT% LSS 10 goto :wait_loading_pid
:loading_ready

echo.
echo  Opening loading page at http://localhost:%SA_PORT%/ ...
start "" "http://localhost:%SA_PORT%/"
call :drawbar 68 "Opening loading page"

REM --- build everything (long step: run in a worker so the bar can animate) ---
call :run_bg "__bg_build" "Building shared, client and host"
if not "%SA_BG_RC%"=="0" goto :build_failed
call :drawbar 100 "Build complete"

REM --- stop the loading server, then WAIT until our port is actually released ---
if defined SA_LOADING_PID (
  taskkill /PID %SA_LOADING_PID% /F >nul 2>&1
) else (
  echo   [WARN] Loading page did not report its PID - stopping it by name...
  powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'loading-server\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
)
del "%~dp0tools\.loading-pid" >nul 2>&1
call :wait_port_free

REM --- re-check the port right before hosting (defence in depth) ---
call :ensure_free_port
if errorlevel 1 exit /b 1

REM --- LAN addresses ---
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Output $_.IPAddress }" > "%TEMP%\space_arenas_lan_ips.txt"
if exist "%TEMP%\space_arenas_lan_ips.txt" (
  echo.
  echo  Your LAN addresses - other players on the network open one of these:
  for /f "delims=" %%I in (%TEMP%\space_arenas_lan_ips.txt) do echo    http://%%I:%SA_PORT%
  del "%TEMP%\space_arenas_lan_ips.txt" >nul 2>&1
)

set "SA_PRIMARY_IP="
for /f "delims=" %%I in ('powershell -NoProfile -Command "$r = Get-NetRoute -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1; if ($r) { $a = Get-NetIPAddress -InterfaceIndex $r.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1; if ($a) { $a.IPAddress } }"') do set "SA_PRIMARY_IP=%%I"

if not defined SA_PRIMARY_IP goto :no_qr
echo.
echo  Recommended (your phone): http://%SA_PRIMARY_IP%:%SA_PORT%/
echo  In the lobby press "Invite" to show the QR code for this address.
goto :no_qr
:no_qr

echo.
echo  The room code and passphrase are printed below when the host starts.
echo  Press 'c' in this window to stop the game and close this window.
echo  (Ctrl+C works too.)
echo.
echo  READY! Node source: %SA_NODE_SOURCE%  Version: %SA_NODE_VERSION%
echo.

node host/dist/host.js

REM --- host stopped (via 'c' or crash); free the port for the next run ---
call :stop_stale_instances
if errorlevel 1 exit /b 1

echo.
echo  Game stopped. Closing this window...
timeout /t 3 /nobreak >nul
endlocal
exit /b 0

REM ============================================================
REM  BUILD FAILURE
REM ============================================================

:build_failed
echo.
echo  [FAIL] Build failed. Log:
if exist "%TEMP%\sa_bg.log" type "%TEMP%\sa_bg.log"
echo.
echo  Fix the errors above, then run this again.
pause
exit /b 1

REM ============================================================
REM  FATAL helpers
REM ============================================================

:fatal_node
echo.
echo  [FAIL] Node.js %SA_REQUIRED_NODE%+ could not be found or prepared on this device.
if defined SA_MSI_PATH (
  echo  A bundled installer is available: "%SA_MSI_PATH%"
  echo  Run it once as Administrator ^(it installs Node.js and npm^), then run this again.
) else (
  echo  Install Node.js %SA_REQUIRED_NODE%+ from https://nodejs.org/ and run this again.
)
pause
exit /b 1

:fatal_npm
echo.
echo  [FAIL] npm is missing. Reinstall Node.js (it bundles npm) and run this again.
pause
exit /b 1

:fatal_deps
echo.
echo  [FAIL] Project dependencies could not be installed.
if not exist node_modules echo  Copy the node_modules folder from another device into this folder, or run this where internet is available.
pause
exit /b 1

REM ============================================================
REM  Prerequisite subroutines
REM ============================================================

:check_node
setlocal
set "SA_GOOD="
set "SA_NODE_SOURCE=system"

REM Try system Node first (must be >= SA_REQUIRED_NODE).
set "SA_VERSION_OK="
node --version >nul 2>nul
if %errorlevel% equ 0 (
  powershell -NoProfile -Command "try { $v = node --version; if ($v -notmatch '^v?(\d+)\.') { exit 2 }; if ([int]$Matches[1] -ge %SA_REQUIRED_NODE%) { exit 0 } else { exit 2 } } catch { exit 2 }"
  if errorlevel 1 (set "SA_VERSION_OK=") else (set "SA_VERSION_OK=1")
)
if defined SA_VERSION_OK set "SA_GOOD=1"

REM Fall back to a portable copy, if someone placed one in lib\node.
if not defined SA_GOOD (
  if exist "%~dp0lib\node\node.exe" (
    set "PATH=%~dp0lib\node;%PATH%"
    set "SA_NODE_SOURCE=portable lib\node"
    set "SA_GOOD=1"
  )
)

REM Last resort: silent-install the bundled installer from lib\.
if not defined SA_GOOD (
  if defined SA_MSI_PATH (
    echo.
    echo  [..] Node.js is missing - installing %SA_MSI_PATH% ...
    echo  ^(an Administrator consent window may appear^)
    msiexec /i "%SA_MSI_PATH%" /qn /norestart
    timeout /t 2 /nobreak >nul
    if exist "%ProgramFiles%\nodejs\node.exe" (
      set "PATH=%ProgramFiles%\nodejs;%PATH%"
      set "SA_NODE_SOURCE=installed from lib"
      set "SA_GOOD=1"
    ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
      set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
      set "SA_NODE_SOURCE=installed from lib"
      set "SA_GOOD=1"
    )
  )
)

if not defined SA_GOOD goto :node_missing
set "SA_NODE_VERSION="
for /f "delims=" %%V in ('node --version 2^>nul') do set "SA_NODE_VERSION=%%V"
echo   [PASS] Node.js %SA_NODE_VERSION%  ^(source: %SA_NODE_SOURCE%^)
goto :node_check_done

:node_missing
echo   [FAIL] Node.js %SA_REQUIRED_NODE%+ not found on this device.

:node_check_done
endlocal & set "PATH=%PATH%" & set "SA_NODE_OK=%SA_GOOD%" & set "SA_NODE_SOURCE=%SA_NODE_SOURCE%" & set "SA_NODE_VERSION=%SA_NODE_VERSION%"
if defined SA_NODE_OK exit /b 0
exit /b 1

:check_npm
call npm --version >nul 2>nul
if errorlevel 1 (
  echo   [FAIL] npm is not available.
  exit /b 1
)
set "SA_NPM_VERSION="
for /f "delims=" %%V in ('call npm --version 2^>nul') do set "SA_NPM_VERSION=%%V"
echo   [PASS] npm %SA_NPM_VERSION%
exit /b 0

:check_deps
if not exist "node_modules\vite\package.json" goto :deps_install
echo   [PASS] Dependencies ^(node_modules^) present.
call :drawbar 34 "Dependencies present"
exit /b 0

:deps_install
echo.
echo   [..] node_modules missing - installing dependencies (needs internet)...
call :run_bg "__bg_deps" "Installing dependencies"
if not "%SA_BG_RC%"=="0" goto :deps_failed
echo   [PASS] Dependencies installed.
call :drawbar 40 "Dependencies installed"
exit /b 0

:deps_failed
echo   [FAIL] npm install failed.
if exist "%TEMP%\sa_bg.log" type "%TEMP%\sa_bg.log"
exit /b 1

:check_system
REM --- Windows firewall ---
net session >nul 2>&1
if errorlevel 1 (
  echo   [INFO] Not running as Administrator - no automatic firewall rule.
  echo          If players cannot connect, allow Node.js through Windows Firewall ^(Private networks^).
) else (
  powershell -NoProfile -Command "$s = (Get-Command node -ErrorAction SilentlyContinue).Source; if (-not $s) { Write-Output 'skip' } elseif (Get-NetFirewallRule -DisplayName 'Space Arenas - LAN host' -ErrorAction SilentlyContinue) { Write-Output 'ok' } else { try { New-NetFirewallRule -DisplayName 'Space Arenas - LAN host' -Direction Inbound -Action Allow -Program $s -Profile Private -ErrorAction Stop | Out-Null; Write-Output 'added' } catch { Write-Output 'failed' } }" > "%TEMP%\space_arenas_fw.txt"
  set "SA_FW="
  if exist "%TEMP%\space_arenas_fw.txt" set /p SA_FW=<"%TEMP%\space_arenas_fw.txt"
  del "%TEMP%\space_arenas_fw.txt" >nul 2>&1
  if "%SA_FW%"=="ok" (
    echo   [PASS] Windows Firewall already allows Space Arenas.
  ) else if "%SA_FW%"=="added" (
    echo   [PASS] Added Windows Firewall inbound rule for Node.js ^(Private networks^).
  ) else (
    echo   [WARN] Could not auto-configure the firewall. If players cannot connect, allow Node.js manually ^(Networks/Private^).
  )
)

REM --- game port ---
for /f "delims=" %%B in ('powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort $env:SA_PORT -State Listen -ErrorAction SilentlyContinue) { Write-Output 'busy' } else { Write-Output 'free' }"') do set "SA_PORTSTATE=%%B"
if "%SA_PORTSTATE%"=="busy" (
  echo   [WARN] Port %SA_PORT% is busy - the launcher switches to a free port automatically.
) else (
  echo   [PASS] Port %SA_PORT% is free.
)

REM --- game files present ---
if not exist "client\src\main.ts" (
  echo   [FAIL] Game source files are missing. Is this a complete copy of the game folder?
  pause
  exit /b 1
)
echo   [PASS] Game source files present.

REM --- disk space ---
for /f "delims=" %%D in ('powershell -NoProfile -Command "$f = (Get-PSDrive -Name $env:SystemDrive[0]).Free; if ($f -lt 1GB) { Write-Output 'low' } else { Write-Output 'ok' }"') do set "SA_DISK=%%D"
if "%SA_DISK%"=="low" (
  echo   [WARN] Low free disk space on %SystemDrive% - the build may fail.
) else (
  echo   [PASS] Disk space looks fine.
)

REM --- folder writable (profile/backup, invites, archive rely on it) ---
for /f "delims=" %%W in ('powershell -NoProfile -Command "try { New-Item -ItemType File -Force -Path '.sa-write-test' | Out-Null; Remove-Item -Force '.sa-write-test'; Write-Output 'ok' } catch { Write-Output 'fail' }"') do set "SA_WRITE=%%W"
if "%SA_WRITE%"=="ok" (
  echo   [PASS] Game folder is writable.
) else (
  echo   [FAIL] Cannot write to the game folder. Move it somewhere writable and run again.
  pause
  exit /b 1
)

REM --- online: is a new Node / info available? (informational only) ---
powershell -NoProfile -Command "try { $l = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' -TimeoutSec 6)[0].version; Write-Output ('[INFO] Online: latest Node.js is ' + $l + ' | this game needs ' + %SA_REQUIRED_NODE% + '+ | you have ' + (node --version).Trim()) } catch { Write-Output '[INFO] Offline - node-update check skipped.' }"

exit /b 0

REM ============================================================
REM  Safety helpers
REM ============================================================

:stop_stale_instances
REM Closes EVERY process a previous Space Arenas run could have left behind, then
REM frees our game port. Called once before hosting and once after the host exits,
REM so nothing this game owns survives on open OR on close.
REM NOTE: a browser tab pointed at the game is deliberately NOT touched - those
REM sockets are the browser's own outgoing retries (shown as SYN_SENT), not our
REM server. Only close the tab to clear them.
REM 1) leftover background workers (cmd.exe running "run-game.bat __bg_*")
powershell -NoProfile -Command "$w = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match 'run-game\.bat.*__bg' }; $w | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output ('Stopped leftover launcher worker (PID ' + $_.ProcessId + ')') }"
REM 2) any node.exe that looks like this game's host or loading server
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'host[\\/]dist[\\/]host(\.js)?|loading-server\.mjs' }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output ('Stopped leftover Space Arenas process (PID ' + $_.ProcessId + ')') }"
REM 3) backstop: if something still listens on our own port and it is node.exe,
REM    it is almost certainly a leftover Space Arenas server (host or page) from a
REM    previous run -- stop it so the port is free for this run. This covers old
REM    builds and dev servers (tsx watch) whose command line prong 1 cannot see.
powershell -NoProfile -Command "$o = Get-NetTCPConnection -LocalPort $env:SA_PORT -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($o) { $pr = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $o) -ErrorAction SilentlyContinue; if ($pr -and $pr.Name -eq 'node.exe') { Stop-Process -Id $o -Force -ErrorAction SilentlyContinue; Write-Output ('Freed port ' + $env:SA_PORT + ' (stopped leftover node process PID ' + $o + ')') } else { Write-Output ('NOTE: port ' + $env:SA_PORT + ' is held by a non-node process (PID ' + $o + '); the game will switch ports instead.') } }"
if errorlevel 1 (
  echo.
  echo  Could not scan for leftover processes. Continuing anyway...
)
exit /b 0

:wait_port_free
REM Blocks until nothing listens on SA_PORT (up to ~10s). The just-killed loading
REM server frees the port asynchronously; without this wait, :ensure_free_port
REM could see it briefly busy and drift the host to a different port than the
REM already-open browser, leaving the loading page polling forever.
set "SA_PF=0"
:wait_port_free_loop
set "SA_BUSY="
for /f "delims=" %%B in ('powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort $env:SA_PORT -State Listen -ErrorAction SilentlyContinue) { 'busy' }"') do set "SA_BUSY=%%B"
if not defined SA_BUSY exit /b 0
set /a SA_PF+=1
if %SA_PF% GEQ 10 (
  echo   [WARN] Port %SA_PORT% is still held after stopping the loading page.
  exit /b 0
)
timeout /t 1 /nobreak >nul
goto :wait_port_free_loop

:ensure_free_port
REM Verifies nothing else is listening on SA_PORT; if a foreign program holds
REM it, automatically falls back to the next free port (up to 10 tries).
set "SA_FREE_TRIES=0"
:ensure_free_port_retry
set "SA_BUSY="
for /f "delims=" %%B in ('powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort $env:SA_PORT -State Listen -ErrorAction SilentlyContinue) { 'busy' }"') do set "SA_BUSY=%%B"
if not defined SA_BUSY exit /b 0
set /a SA_FREE_TRIES+=1
if %SA_FREE_TRIES% GEQ 10 (
  echo.
  echo  ERROR: no free port found near %SA_PORT%.
  echo  Close the programs using these ports and run this again.
  pause
  exit /b 1
)
set /a SA_PORT+=1
echo    Port was busy - automatically switching to %SA_PORT%...
goto :ensure_free_port_retry

REM ============================================================
REM  Progress-bar helpers
REM ============================================================

:drawbar
REM Prints one milestone line: "[####....] N% label". %1 = percent, %2 = label.
setlocal EnableDelayedExpansion
set "pct=%~1"
set "label=%~2"
set /a "fill=(pct*24)/100"
set "bar="
for /L %%i in (1,1,24) do (
  if %%i LEQ !fill! (set "bar=!bar!#") else (set "bar=!bar!.")
)
<nul set /p "=  [!bar!] !pct!%% !label!"
echo(
endlocal
exit /b

:run_bg
REM Runs a long step as a background worker (this same script, %1 = worker token)
REM while :anim animates a bar until the worker writes its exit code. %2 = label.
del "%TEMP%\sa_bg_rc.txt" >nul 2>&1
if exist "%TEMP%\sa_bg.log" del "%TEMP%\sa_bg.log" >nul 2>&1
start /b "" cmd /c call "%~f0" %~1
call :anim "%~2"
set "SA_BG_RC="
if exist "%TEMP%\sa_bg_rc.txt" set /p SA_BG_RC=<"%TEMP%\sa_bg_rc.txt"
if not defined SA_BG_RC set "SA_BG_RC=1"
exit /b

:anim
REM Indeterminate in-place bar; stops when the worker writes its rc file. %1 = label.
setlocal EnableDelayedExpansion
set "label=%~1"
if not defined CR goto :anim_plain
set "pos=2"
set "dir=1"
:anim_loop
if exist "%TEMP%\sa_bg_rc.txt" goto :anim_done
set "bar="
for /L %%i in (1,1,24) do (
  if %%i==!pos! (set "bar=!bar!>") else (set "bar=!bar!=")
)
<nul set /p "=  [!bar!] !label!                                   !CR!"
timeout /t 1 /nobreak >nul
set /a "pos+=dir"
if !pos! GEQ 24 (set "pos=23" & set "dir=-1")
if !pos! LEQ 1 (set "pos=2" & set "dir=1")
goto :anim_loop

:anim_plain
:anim_plain_wait
if exist "%TEMP%\sa_bg_rc.txt" goto :anim_done
echo   [..] !label! ...
timeout /t 2 /nobreak >nul
goto :anim_plain_wait

:anim_done
set "full="
for /L %%i in (1,1,24) do set "full=!full!#"
if defined CR (
  <nul set /p "=  [!full!] !label!                                  !CR!"
  echo(
) else (
  echo   [PASS] !label!
)
endlocal
exit /b

REM ============================================================
REM  Background workers (re-invoked with a worker argument)
REM ============================================================

:bg_build
call npm run build -w shared -w client -w host > "%TEMP%\sa_bg.log" 2>&1
> "%TEMP%\sa_bg_rc.txt" echo %errorlevel%
exit /b 0

:bg_deps
call npm install > "%TEMP%\sa_bg.log" 2>&1
> "%TEMP%\sa_bg_rc.txt" echo %errorlevel%
exit /b 0
