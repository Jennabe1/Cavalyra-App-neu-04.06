#!/usr/bin/env bash
# Cavalyra iOS – environment sanity check.
# Verifies every tool and file needed to archive & upload to App Store Connect.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n     → %s\n" "$1" "$2"; FAIL=$((FAIL+1)); }

echo "▶ Host"
[[ "$(uname)" == "Darwin" ]] && pass "macOS ($(sw_vers -productVersion))" \
  || fail "Not macOS" "iOS builds require macOS."

echo "▶ Toolchain"
command -v brew >/dev/null    && pass "Homebrew ($(brew --version | head -1))" \
  || fail "Homebrew missing"   "/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
command -v node >/dev/null    && pass "Node ($(node -v))" \
  || fail "Node missing"       "brew install node@20 && brew link --overwrite --force node@20"
command -v npm  >/dev/null    && pass "npm ($(npm -v))"  \
  || fail "npm missing"        "reinstall Node via Homebrew"
command -v git  >/dev/null    && pass "git ($(git --version | awk '{print $3}'))" \
  || fail "git missing"        "xcode-select --install"
command -v xcodebuild >/dev/null && pass "Xcode ($(xcodebuild -version | head -1))" \
  || fail "Xcode missing"      "Install Xcode from the Mac App Store, then: sudo xcodebuild -license accept"
xcode-select -p >/dev/null 2>&1 && pass "Command Line Tools ($(xcode-select -p))" \
  || fail "Xcode CLT missing"  "xcode-select --install"
command -v xcrun >/dev/null   && pass "xcrun available" \
  || fail "xcrun missing"      "sudo xcode-select --switch /Applications/Xcode.app"

echo "▶ Project"
[[ -f "$ROOT/package.json" ]]           && pass "package.json"             || fail "package.json missing" "run from project root"
[[ -d "$ROOT/node_modules" ]]           && pass "node_modules"             || warn "node_modules missing → run: npm install"
[[ -d "$ROOT/dist" ]]                   && pass "dist/ (web build)"        || warn "dist missing → run: npm run build"
[[ -f "$ROOT/capacitor.config.ts" ]]    && pass "capacitor.config.ts"      || fail "capacitor.config.ts missing" "restore project files"
[[ -d "$ROOT/ios/App/App.xcodeproj" ]]  && pass "Xcode project"            || fail "iOS project missing" "run: npx cap add ios"
[[ -d "$ROOT/ios/App/App/public" ]]     && pass "iOS web assets synced"    || warn "iOS assets not synced → run: npx cap sync ios"
[[ -f "$ROOT/ios/App/App/Info.plist" ]] && pass "Info.plist"               || fail "Info.plist missing" "restore ios/App/App/Info.plist"

echo "▶ Signing"
if [[ -f "$ROOT/ios/signing.local.xcconfig" ]]; then
  pass "signing.local.xcconfig present"
elif [[ -n "${DEVELOPMENT_TEAM:-}" && -n "${PROVISIONING_PROFILE_SPECIFIER:-}" ]]; then
  pass "DEVELOPMENT_TEAM + PROVISIONING_PROFILE_SPECIFIER in env (CI mode)"
elif [[ -f "$ROOT/ios/.env.local" ]]; then
  warn "ios/.env.local exists but signing.local.xcconfig not generated → run: bash scripts/setup-ios-signing.sh"
else
  fail "No signing configured" "cp ios/.env.example ios/.env.local && edit values, then: bash scripts/setup-ios-signing.sh"
fi

echo
if (( FAIL == 0 )); then
  printf "\033[32mEnvironment looks good.\033[0m Next: bash scripts/ios-prepare.sh\n"
  exit 0
else
  printf "\033[31m%d problem(s) found — fix them and re-run.\033[0m\n" "$FAIL"
  exit 1
fi
