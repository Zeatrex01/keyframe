@echo off
rem Installs Keyframe Studio for this Windows user: Start menu and desktop shortcuts, and an
rem entry in Settings ^> Apps to remove it. You can also just run Keyframe Studio.exe from here.
set /p KF=<"%~dp0current"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0%KF%\install\install.ps1" -Source "%~dp0."
if errorlevel 1 pause
