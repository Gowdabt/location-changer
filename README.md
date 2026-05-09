# Location Changer (Mac Phase 1 - iOS First)

Local desktop app for iOS/iPadOS developer/testing location simulation, built with an adapter-first architecture so Android and Windows can be added with minimal core rewrites.

## What is implemented

- Electron + React desktop app (`apps/desktop`)
- Core command contracts and simulation engine (`packages/core`)
- iOS adapter package (`packages/adapters/ios`) for teleport/route/stop command handling
- Android adapter placeholder (`packages/adapters/android`) for next stream
- Preset storage package (`packages/storage`)
- Diagnostics logger package (`packages/diagnostics`)
- Desktop setup checks for `xcrun` and `pymobiledevice3`
- Diagnostics panel + persisted logs
- Saved places

## Prerequisites (Mac)

- Node.js 20+
- Xcode command line tools:
  - `xcode-select --install`
- Python 3 + iOS developer tooling:
  - `pip3 install pymobiledevice3`
- iPhone/iPad connected and trusted by the Mac

## Run locally

```bash
cd /Users/hbt/Desktop/location-changer
npm install
npm run dev
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
