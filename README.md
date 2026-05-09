# Location Changer (Mac Phase 1 - iOS First)

Local desktop app for iOS/iPadOS and Android developer/testing location simulation, built with an adapter-first architecture so Windows can be added with minimal core rewrites.

## What is implemented

- Electron + React desktop app (`apps/desktop`)
- Core command contracts and simulation engine (`packages/core`)
- iOS adapter package (`packages/adapters/ios`) for teleport/route/stop command handling
- Android adapter package (`packages/adapters/android`) with emulator-first adb geo support
- Preset storage package (`packages/storage`)
- Diagnostics logger package (`packages/diagnostics`)
- Desktop setup checks for `xcrun` and `pymobiledevice3`
- Diagnostics panel + persisted logs
- Saved places

## Prerequisites (Mac)

- Node.js 20+
- Full Xcode installed in `/Applications/Xcode.app`
- Xcode developer directory set correctly:
  - `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
  - verify with `xcode-select -p`
- Xcode license accepted:
  - `sudo xcodebuild -license accept`
- Python 3 + iOS developer tooling:
  - `pip3 install pymobiledevice3`
- iPhone/iPad connected and trusted by the Mac
- Android platform tools:
  - `adb` available on PATH
- Android emulator (recommended for geo fix support in this phase)

## Startup scripts (auto checks)

- `./start.sh` and double-click `start.command` now perform startup checks:
  - install npm dependencies when missing
  - verify Xcode path (`xcode-select -p`) and switch to full Xcode if available
  - verify `xcrun`
  - install `pymobiledevice3` via `pip3` if missing
  - install `adb` via Homebrew if missing (`brew install android-platform-tools`)
- If a dependency cannot be auto-installed (for example Xcode missing), the script prints the exact command to run.

## Run locally

```bash
cd /Users/hbt/HarshithGowda/Apps/location-changer
./start.sh
```

## Build all workspaces

```bash
npm run build
```

## Phase 1 iOS sign-off checklist

- [ ] Device shows connected/authorized/ready
- [ ] Teleport updates location to supplied point
- [ ] Route runs at least 10 minutes
- [ ] Stop halts updates and clears simulation
- [ ] Reconnect behavior works without restarting app
- [ ] Logs contain actionable error messages

## Monorepo layout

- `apps/desktop` Electron app and UI
- `packages/core` contracts + simulation engine
- `packages/adapters/ios` iOS adapter
- `packages/adapters/android` Android placeholder adapter
- `packages/storage` preset persistence
- `packages/diagnostics` structured logging
