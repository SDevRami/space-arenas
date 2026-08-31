@echo off
setlocal
title Space Arenas - Map Builder
cd /d "%~dp0"

echo.
echo  ============================================
echo   Space Arenas - Map Builder (port 5174)
echo  ============================================
echo.
echo  Opening http://localhost:5174/ ...
echo  Press Ctrl+C in this window to stop the server.
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:5174/"

call npm run dev -w mapbuilder

pause
endlocal
