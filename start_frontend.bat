@echo off
cd /d "%~dp0"
title Aura - Site web
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" start_frontend.py
    goto end
)
where py >nul 2>nul
if not errorlevel 1 (
    py -3.13 start_frontend.py
    goto end
)
where python >nul 2>nul
if not errorlevel 1 (
    python start_frontend.py
    goto end
)
echo ERREUR : Python est introuvable.
echo Installez Python ou executez setup_backend.bat depuis le dossier backend.
:end
pause
