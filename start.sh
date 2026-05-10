#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
USE_EXTERNAL_TUNNEL="${USE_EXTERNAL_TUNNEL:-1}"

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

ensure_tunneld() {
  if [ "$USE_EXTERNAL_TUNNEL" = "1" ]; then
    echo "External tunnel mode enabled (USE_EXTERNAL_TUNNEL=1)."
    if pgrep -f "python3 -m pymobiledevice3 remote tunneld" >/dev/null 2>&1 && \
      curl -fsS "http://127.0.0.1:49151/" >/dev/null 2>&1; then
      echo "External tunneld is running and responsive."
      return
    fi
    echo "External tunnel not ready."
    echo "Run this in another terminal and keep it open:"
    echo "  sudo python3 -m pymobiledevice3 remote tunneld"
    exit 1
  fi

  if pgrep -f "python3 -m pymobiledevice3 remote tunneld" >/dev/null 2>&1; then
    if curl -fsS "http://127.0.0.1:49151/" >/dev/null 2>&1; then
      echo "pymobiledevice3 tunneld is already running and responsive."
      return
    fi
    echo "tunneld process is present but unhealthy; restarting..."
    pkill -f "python3 -m pymobiledevice3 remote tunneld" >/dev/null 2>&1 || true
  fi

  echo "Authenticating sudo for tunneld startup..."
  sudo -v

  echo "Starting pymobiledevice3 tunneld in background..."
  mkdir -p .logs
  sudo -n nohup python3 -m pymobiledevice3 remote tunneld > .logs/tunneld.log 2>&1 &
  sleep 2

  if pgrep -f "python3 -m pymobiledevice3 remote tunneld" >/dev/null 2>&1; then
    if curl -fsS "http://127.0.0.1:49151/" >/dev/null 2>&1; then
      echo "tunneld started successfully."
    else
      echo "tunneld process started but health check failed. Check logs at .logs/tunneld.log"
      exit 1
    fi
  else
    echo "Failed to start tunneld. Check logs at .logs/tunneld.log"
    exit 1
  fi
}

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

ensure_xcode
ensure_pymobiledevice3
ensure_adb
ensure_tunneld

echo "Starting Location Changer app..."
if [ "$USE_EXTERNAL_TUNNEL" = "1" ]; then
  echo "Tip: running with external tunnel mode."
  echo "Set USE_EXTERNAL_TUNNEL=0 to allow this script to manage tunneld."
fi
npm run dev
