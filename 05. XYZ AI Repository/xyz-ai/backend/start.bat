@echo off
REM One-command launcher for XYZ AI on Windows (Command Prompt / PowerShell).
REM Equivalent to start.sh, for machines without Git Bash/WSL.
REM
REM On every run this:
REM   1. Sets up a Python virtual environment
REM   2. Installs every dependency the backend needs, including the local
REM      voice stack (torch, transformers, parler-tts)
REM   3. Starts the server, with the local voice model loaded (if it's been
REM      downloaded - see below) before the first request comes in
REM
REM This script does NOT download the voice model. Run that once,
REM separately, before your first real demo:
REM
REM   python download_tts_model.py
REM
REM (see download_tts_model.py / the README). Skipping it is fine - the app
REM still runs, spoken replies just use the browser's built-in voice instead
REM of the local one until you run it.
REM
REM Usage: double-click this file, or run it from a terminal opened in this
REM   "backend" folder:  start.bat
REM
REM Safe to re-run any time: pip skips work that's already done, so every
REM run after the first starts in a couple of seconds.

setlocal
cd /d "%~dp0"

echo ==^> [1/3] Python environment
if not exist ".venv" (
    python -m venv .venv
    if errorlevel 1 (
        echo Failed to create the virtual environment. Is Python installed and on PATH?
        pause
        exit /b 1
    )
)
call .venv\Scripts\activate.bat

echo ==^> [2/3] Installing dependencies (includes torch + transformers + parler-tts for local voice)
python -m pip install --upgrade pip -q
pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo !! pip install failed. If you saw a torch/torchaudio DLL error before,
    echo    try:  pip uninstall -y torch torchaudio torchvision ^&^& pip cache purge
    echo    then re-run this script.
    pause
    exit /b 1
)

if not exist ".env" (
    echo ==^> No .env found - copying .env.example. Fill in GROQ_API_KEY before your first real demo.
    copy .env.example .env >nul
)

echo ==^> [3/3] Starting the server on http://localhost:8000
echo     (Voice model not downloaded yet? Run "python download_tts_model.py" - browser voice is used until then.)
REM TTS_BLOCK_ON_STARTUP=1: load the voice model into memory (if cached)
REM before opening for requests, so voice is ready - or its failure is
REM printed - from the first reply on.
set TTS_BLOCK_ON_STARTUP=1
uvicorn app:app --host 0.0.0.0 --port 8000
