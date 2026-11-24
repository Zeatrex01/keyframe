@echo off
rem Starts Keyframe Studio. This is the launcher of a package built without the C# compiler
rem (not on Windows); a release package has Keyframe Studio.exe instead.
set /p KF=<"%~dp0current"
start "" "%~dp0%KF%\node\node.exe" "%~dp0%KF%\studio\tools\studio.js" --app %*
