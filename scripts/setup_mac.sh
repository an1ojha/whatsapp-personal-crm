#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This setup script is for macOS because it reads WhatsApp Desktop's local Mac database."
  exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "Missing python3. Install Xcode Command Line Tools or Python 3."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Missing npm. Install Node.js from https://nodejs.org/."; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || { echo "Missing sqlite3. It should ship with macOS."; exit 1; }

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
npm install

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Paste your Anthropic API key in the Setup tab or edit .env."
fi

echo
.venv/bin/python scripts/doctor.py || true
echo
echo "Next: run npm run dev and open the Setup tab."
