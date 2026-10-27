@echo off
title Harbor Desktop Dev
cd /d "%~dp0"
powershell.exe -NoExit -ExecutionPolicy Bypass -File "%~dp0run_dev.ps1"
