@echo off
cd /d "%~dp0"
node scripts\launcher.js --stop
if errorlevel 1 pause
