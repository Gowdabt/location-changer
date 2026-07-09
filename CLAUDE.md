# Location Changer — Project Context

## Architecture
- Electron desktop app at `apps/desktop/electron/`
- Main process: `main.cjs` (IPC handlers, device management, tunnel lifecycle)
- Runtime utilities: `runtime.cjs` (command execution, error detection, retries)
- iOS location simulation via `pymobiledevice3` + tunneld service
- Android location via `adb emu geo fix`
- Python hold script: `ios_location_hold.py` (keepalive with watchdog)

## Key Patterns
- All iOS commands go through tunnel at `127.0.0.1:49151`
- Tunnel health: `isTunnelRunning()` → `isTunnelResponsive()` → `restartTunnelNonInteractive()`
- Error recovery: `isTransientError()` + `isTunnelConnectionError()` for retry decisions
- Logging: `appendLog(level, tag, message, data)` throughout

## Development Notes
- Run with: `npm start` from `apps/desktop/electron/`
- iOS requires tunneld running with sudo: `sudo python3 -m pymobiledevice3 remote tunneld`
- Test tunnel errors by killing tunneld: `pkill -f tunneld`
