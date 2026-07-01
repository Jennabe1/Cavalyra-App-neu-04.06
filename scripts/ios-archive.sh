#!/usr/bin/env bash
# Cavalyra iOS – build an App Store archive from the command line.
# Uses signing values from ios/signing.local.xcconfig (or CI env).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BUILD_DIR="${BUILD_DIR:-$ROOT/ios/build}"
ARCHIVE_PATH="$BUILD_DIR/App.xcarchive"
EXPORT_PATH="$BUILD_DIR/export"
EXPORT_OPTIONS="$ROOT/ios/ExportOptions.plist"

mkdir -p "$BUILD_DIR"

echo "▶ Web build + Capacitor sync"
npm run build
npx cap sync ios

echo "▶ xcodebuild archive"
xcodebuild \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  clean archive

echo "▶ xcodebuild -exportArchive"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS"

echo
echo "✓ Archive: $ARCHIVE_PATH"
echo "✓ IPA:     $EXPORT_PATH/App.ipa"
echo
echo "Upload with:  xcrun altool --upload-app -f \"$EXPORT_PATH/App.ipa\" -t ios \\"
echo "                --apiKey \"\$APP_STORE_CONNECT_KEY_ID\" --apiIssuer \"\$APP_STORE_CONNECT_ISSUER_ID\""
