@echo off
cd /d "%USERPROFILE%\Desktop\Mac\flourish-race"
echo Starting Vite dev server...
start "" http://localhost:5173/
npm.cmd run dev
pause
