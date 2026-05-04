@echo off
title Building AutoTrack Launcher
echo.
echo  Building AutoTrack.exe launcher...
echo  This takes about 2-3 minutes.
echo.

cd /d "%~dp0"

:: Use python -m prefix to bypass Device Guard restrictions on pip.exe/pyinstaller.exe
python -m pip install -r requirements.txt --quiet

:: Build the launcher
python -m PyInstaller --onefile ^
                      --noconsole ^
                      --name AutoTrack ^
                      --distpath dist ^
                      --workpath build ^
                      --specpath build ^
                      main.py

echo.
if exist dist\AutoTrack.exe (
    echo  SUCCESS — dist\AutoTrack.exe is ready.
    echo  Copy it into the installer\ folder before building the installer.
    copy dist\AutoTrack.exe ..\installer\AutoTrack.exe >nul
    echo  Copied to installer\AutoTrack.exe
) else (
    echo  ERROR — build failed. Check the output above.
)
echo.
pause
