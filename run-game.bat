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
echo  ==========================================================
echo.

REM --- start loading page so the browser opens immediately ---
set "SA_LOADING_PID="
del "%~dp0tools\.loading-pid" >nul 2>&1
start /b node tools/loading-server.mjs >nul 2>&1
timeout /t 1 /nobreak >nul
if exist "%~dp0tools\.loading-pid" set /p SA_LOADING_PID=<"%~dp0tools\.loading-pid"

echo  Opening loading page...
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
