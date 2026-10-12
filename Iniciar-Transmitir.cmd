@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Iniciar-Transmitir.ps1"
if errorlevel 1 (
  echo.
  echo O iniciador encontrou um problema. Veja a mensagem acima.
  pause
)
