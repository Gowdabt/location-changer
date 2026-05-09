#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

ensure_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1
}

ensure_xcode() {
  local desired="/Applications/Xcode.app/Contents/Developer"
  local active=""
  if ensure_command xcode-select; then
    active="$(xcode-select -p 2>/dev/null || true)"
  fi

  if [ "$active" != "$desired" ]; then
    if [ -d "$desired" ]; then
      echo "Switching developer directory to full Xcode..."
      sudo xcode-select -s "$desired"
    else
      echo "Xcode not found at $desired"
      echo "Install Xcode from App Store, then run:"
      echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
      exit 1
    fi
  fi

  if ! ensure_command xcrun; then
    echo "xcrun is missing. Run: xcode-select --install"
    exit 1
  fi
}

ensure_pymobiledevice3() {
  if ! ensure_command pip3; then
    echo "pip3 is required but not found. Install Python3 first."
    exit 1
  fi
  if ! ensure_command pymobiledevice3; then
    echo "Installing pymobiledevice3..."
    pip3 install pymobiledevice3
  fi
}

ensure_adb() {
  if ensure_command adb; then
    return
  fi
  if ensure_command brew; then
    echo "Installing Android platform tools (adb) via Homebrew..."
    brew install android-platform-tools
  else
    echo "adb not found and Homebrew unavailable."
    echo "Install Homebrew or Android platform tools manually."
  fi
}

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

ensure_xcode
ensure_pymobiledevice3
ensure_adb

echo "Starting Location Changer app..."
npm run dev
