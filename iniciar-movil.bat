@echo off
chcp 65001 >nul
title TPV Comandero - Servidor para Movil

echo.
echo ==========================================================
echo    TPV COMANDERO - Servidor para Movil
echo ==========================================================
echo.
echo  Asegurate de que el movil esta en la MISMA red WiFi
echo  que este ordenador.
echo.

:: Get the local IP address (IPv4, excluding loopback)
set "IP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    if not defined IP (
        set "IP=%%a"
    )
)
:: Trim leading space
if defined IP set "IP=%IP: =%"

echo  Abre esta URL en el navegador del movil:
echo.
if defined IP (
    echo     http://%IP%:3000
) else (
    echo     http://<IP-de-este-PC>:3000
    echo.
    echo  (No se pudo detectar la IP automaticamente.
    echo   Ejecuta "ipconfig" para encontrar tu IPv4.)
)
echo.
echo  IMPORTANTE: Manten esta ventana abierta mientras usas
echo  el TPV en el movil. Para parar el servidor, cierra esta
echo  ventana o pulsa Ctrl+C.
echo.
echo ==========================================================
echo  Arrancando servidor...
echo ==========================================================
echo.

cd /d "%~dp0"
npm run dev

echo.
echo  Servidor detenido. Pulsa cualquier tecla para cerrar...
pause >nul
