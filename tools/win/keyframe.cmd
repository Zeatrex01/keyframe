@echo off
rem The `keyframe` command (the installer puts this folder on the user's PATH): the bundled Node
rem and whichever version is current. keyframe help lists what it does.
setlocal
set /p KF=<"%~dp0current"
"%~dp0%KF%\node\node.exe" "%~dp0%KF%\studio\tools\keyframe.js" %*
