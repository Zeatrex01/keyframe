@echo off
rem Opens the studio page. Drop a project folder onto this file to open that folder;
rem double-click it to open Projects.
if "%~1"=="" (
  node "%~dp0tools\studio.js" --open
) else (
  node "%~dp0tools\studio.js" --project "%~1" --open
)
pause
