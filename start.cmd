@echo off
cd /d "%~dp0"
node scripts\launcher.js
if errorlevel 1 pause
