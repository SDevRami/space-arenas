@echo off
setlocal
title Space Arenas - Game (LAN auto-discovery)
cd /d "%~dp0"

REM --- clear previously generated invite QR codes ---
if exist "%~dp0invites" (
  del /q "%~dp0invites\*" >nul 2>&1
)

set "SA_PORT=17321"
set "SA_PASSPHRASE=changeme"
if not "%~1"=="" set "SA_PORT=%~1"
if not "%~2"=="" set "SA_PASSPHRASE=%~2"
if not "%~3"=="" set "SA_ROOM_CODE=%~3"

echo.
echo  ==========================================================
echo   Space Arenas - Game
echo.
echo   This single launcher builds and starts the LAN host with
echo   automatic player discovery. Open the URL below and pick
echo   "Network Play" to see who is on your network, create or
echo   join a match, and chat. "Offline Game" works the same way.
echo.
echo   Any leftover instance from a previous run is stopped
echo   automatically, so you never have to fix port conflicts.
echo  ==========================================================
echo.

REM --- stop leftover Space Arenas node processes from previous runs ---
call :stop_stale_instances
if errorlevel 1 exit /b 1

REM --- ensure the game port is free (auto-picks the next free port) ---
call :ensure_free_port
if errorlevel 1 exit /b 1

REM --- start loading page so the browser opens immediately ---
set "SA_LOADING_PID="
del "%~dp0tools\.loading-pid" >nul 2>&1
start /b node tools/loading-server.mjs >nul 2>&1
timeout /t 1 /nobreak >nul
if exist "%~dp0tools\.loading-pid" set /p SA_LOADING_PID=<"%~dp0tools\.loading-pid"

echo.
echo  Opening loading page at http://localhost:%SA_PORT%/ ...
start "" "http://localhost:%SA_PORT%/"

REM --- build everything ---
echo.
echo  Building shared, client, host and map builder...
call npm run build -w shared -w client -w host -w mapbuilder
if errorlevel 1 (
  echo.
  echo  Build failed. Fix the errors above, then run this again.
  pause
  exit /b 1
)

REM --- stop loading server ---
if defined SA_LOADING_PID taskkill /PID %SA_LOADING_PID% /F >nul 2>&1

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
echo  Press Ctrl+C in this window to stop the server.
echo.

node host/dist/host.js

pause
endlocal
exit /b 0

REM ============================================================
REM  Safety helpers
REM ============================================================

:stop_stale_instances
REM Kills lingering Space Arenas node processes (game host or loading page)
REM from a previous run, so a second launch can never hit a stuck port.
REM Only processes whose command line references this game are touched.
REM 1) any node.exe that looks like this game's host or loading server
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'host[\\/]dist[\\/]host(\.js)?|loading-server\.mjs' }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output ('Stopped leftover Space Arenas process (PID ' + $_.ProcessId + ')') }"
REM 2) backstop: if something still listens on our own port, stop it only when it
REM    is node.exe running one of this game's servers (catches older host builds
REM    whose command-line shape prong 1 cannot see)
powershell -NoProfile -Command "$o = Get-NetTCPConnection -LocalPort $env:SA_PORT -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($o) { $pr = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $o) -ErrorAction SilentlyContinue; if ($pr -and $pr.Name -eq 'node.exe' -and $pr.CommandLine -match 'space-arenas|host[\\/]dist[\\/]host') { Stop-Process -Id $o -Force -ErrorAction SilentlyContinue; Write-Output ('Stopped stale Space Arenas process holding port ' + $env:SA_PORT + ' (PID ' + $o + ')') } else { Write-Output ('NOTE: port ' + $env:SA_PORT + ' is held by a non-Space Arenas process (PID ' + $o + '); the game will switch ports instead.') } }"
if errorlevel 1 (
  echo.
  echo  Could not scan for leftover processes. Continuing anyway...
)
exit /b 0

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