@echo off
cd /d "%~dp0.."
echo Opening Ringside Archive at http://127.0.0.1:4173
start "" http://127.0.0.1:4173
py -m http.server 4173
pause
