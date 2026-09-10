@echo off
REM ANUPALAN - double-click this file to start the demo.
REM
REM Why a .bat rather than the .ps1 directly: with no execution policy
REM configured, Windows falls back to Restricted, which refuses every
REM PowerShell script before its first line runs - so clicking the .ps1
REM flashes a window that closes instantly. -ExecutionPolicy Bypass on the
REM command line below applies to this one process only; no system
REM setting is changed.
REM
REM The pause at the end is what keeps this window open on EVERY path,
REM including an early exit, so a failure can always be read.
title ANUPALAN - demo stack
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-demo.ps1" -NoPause
echo.
pause
