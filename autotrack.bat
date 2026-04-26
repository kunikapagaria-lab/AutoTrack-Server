@echo off
title AutoTrack Controller
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║         AUTOTRACK CONTROLLER         ║
echo  ╚══════════════════════════════════════╝
echo.
echo  1. Start AutoTrack
echo  2. Stop AutoTrack
echo  3. Restart AutoTrack
echo  4. View live logs
echo  5. Open in browser
echo  6. Rebuild (after update)
echo  7. Exit
echo.
set /p choice=Choose an option (1-7):

if "%choice%"=="1" goto start
if "%choice%"=="2" goto stop
if "%choice%"=="3" goto restart
if "%choice%"=="4" goto logs
if "%choice%"=="5" goto browser
if "%choice%"=="6" goto rebuild
if "%choice%"=="7" exit

:start
echo Starting AutoTrack...
docker compose up -d
echo.
echo AutoTrack is running. Open http://localhost in your browser.
pause
exit

:stop
echo Stopping AutoTrack...
docker compose down
echo Done.
pause
exit

:restart
echo Restarting AutoTrack...
docker compose restart
echo Done.
pause
exit

:logs
echo Showing live logs (press Ctrl+C to stop)...
docker compose logs -f
pause
exit

:browser
start http://localhost
exit

:rebuild
echo Pulling latest changes and rebuilding...
echo This may take several minutes.
docker compose down
docker compose up -d --build
echo Done. Open http://localhost in your browser.
pause
exit
