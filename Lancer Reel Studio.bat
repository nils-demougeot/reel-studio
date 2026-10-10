@echo off
rem Double-cliquez sur ce fichier pour lancer Reel Studio dans votre navigateur.
cd /d "%~dp0"
if not exist node_modules (
  echo Installation des dependances, premiere fois uniquement...
  call npm install
)
node server.js --open
pause
