#!/usr/bin/env bash
# Cavalyra iOS – one-command prepare for a fresh Mac.
# Installs deps, builds the web app, syncs Capacitor, writes signing config.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▶ npm install"
npm install

echo "▶ vite build"
npm run build

echo "▶ npx cap sync ios"
npx cap sync ios

echo "▶ signing config"
bash scripts/setup-ios-signing.sh || {
  echo
  echo "⚠  Signing config not written. This is fine for a first pass;"
  echo "   fill in ios/.env.local (see ios/.env.example) then re-run:"
  echo "     bash scripts/setup-ios-signing.sh"
}

echo
echo "✓ iOS project ready. Open in Xcode with:  npm run ios:open"
