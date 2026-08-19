#!/usr/bin/env bash
# One-command launcher for XYZ AI.
#
# On every run this:
#   1. Sets up a Python virtual environment
#   2. Installs every dependency the backend needs, including the local
#      voice stack (torch, transformers, parler-tts)
#   3. Starts the server, with the local voice model loaded (if it's been
#      downloaded - see below) before the first request comes in
#
# This script does NOT download the voice model. Run that once, separately,
# before your first real demo:
#
#   python download_tts_model.py
#
# (see download_tts_model.py / the README). Skipping it is fine - the app
# still runs, spoken replies just use the browser's built-in voice instead
# of the local one until you run it.
#
# Usage:
#   cd "05. XYZ AI Repository/xyz-ai/backend"
#   ./start.sh
#
# Safe to re-run any time (e.g. to restart the app): pip skips work that's
# already done, so every run after the first starts in a couple of seconds.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> [1/3] Python environment"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

echo "==> [2/3] Installing dependencies (includes torch + transformers + parler-tts for local voice)"
pip install --upgrade pip -q
pip install -r requirements.txt

if [ ! -f ".env" ]; then
  echo "==> No .env found - copying .env.example. Fill in GROQ_API_KEY before your first real demo."
  cp .env.example .env
fi

echo "==> [3/3] Starting the server on http://localhost:8000"
echo "    (Voice model not downloaded yet? Run 'python download_tts_model.py' - browser voice is used until then.)"
# TTS_BLOCK_ON_STARTUP=1: load the voice model into memory (if cached) before
# opening for requests, so voice is ready - or its failure is printed - from
# the first reply on, rather than racing the first chat reply against it.
export TTS_BLOCK_ON_STARTUP=1
exec uvicorn app:app --host 0.0.0.0 --port 8000
