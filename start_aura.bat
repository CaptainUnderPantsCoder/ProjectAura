@echo off
cd /d "%~dp0"
if exist "run_backend.bat" (
    echo Lancement du backend original dans une autre fenetre...
    start "Aura - Backend" "%~dp0run_backend.bat"
) else (
    echo ATTENTION : run_backend.bat est introuvable dans ce dossier.
    echo Le site s'ouvrira quand meme, mais sans prediction IA.
    echo Pour une demonstration complete, copiez ces fichiers a la racine du backend.
    echo.
)
call "%~dp0start_frontend.bat"
