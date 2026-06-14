#!/usr/bin/env bash
# ----------------------------------------------------------------------
#  myFinance — iOS build/run helper. macOS + Xcode ONLY (iOS cannot be
#  built on Windows/Linux). Mirrors build-android.bat in spirit.
#
#  Usage:
#    ./build-ios.sh         # init if needed, then `tauri ios dev` (live reload)
#    ./build-ios.sh build   # produce an .ipa via `tauri ios build`
#
#  Prerequisites (one-time, on the Mac):
#    Node.js, Rust + iOS targets (aarch64-apple-ios, aarch64-apple-ios-sim),
#    Xcode + command-line tools, and an Apple signing identity for device runs.
# ----------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

command -v cargo      >/dev/null 2>&1 || { echo "[ERROR] Rust/cargo not installed."; exit 1; }
command -v npm        >/dev/null 2>&1 || { echo "[ERROR] Node.js/npm not installed."; exit 1; }
command -v xcodebuild >/dev/null 2>&1 || { echo "[ERROR] Xcode not found — iOS builds require macOS + Xcode."; exit 1; }

# --- JS deps ----------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "=== Installing JS deps ==="
  npm install --no-audit --no-fund
fi

# --- Initialise the iOS project on first run --------------------------
if [ ! -d src-tauri/gen/apple ]; then
  echo "=== Initialising iOS project (tauri ios init) ==="
  npm run tauri:ios:init
fi

# --- Ensure local-network / Bonjour Info.plist keys for device sync ---
echo "=== Ensuring device-sync Info.plist keys ==="
node scripts/ensure-ios-plist.mjs

# --- Build or run -----------------------------------------------------
MODE="${1:-dev}"
if [ "$MODE" = "build" ]; then
  echo "=== Building iOS app (tauri ios build) ==="
  npm run tauri -- ios build
else
  echo "=== Running iOS app on simulator/device (tauri ios dev) ==="
  npm run tauri:ios:dev
fi
