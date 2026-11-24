@echo off
rem The studio's MCP server for agent clients (Claude Code, Codex, Cursor...), with the bundled
rem Node and whichever version is current, so a client's setting survives updates.
setlocal
set /p KF=<"%~dp0current"
"%~dp0%KF%\node\node.exe" "%~dp0%KF%\studio\tools\mcp-server.js" %*
