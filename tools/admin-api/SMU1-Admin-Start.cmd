@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."
node "tools\admin-api\launcher.mjs" --owner --open
if errorlevel 1 (
  echo.
  echo Не удалось запустить локальную админку. Сообщите Павлу текст ошибки выше.
  pause
)
endlocal
