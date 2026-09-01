@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
call "tools\admin-api\SMU1-Admin-Start.cmd"
endlocal
