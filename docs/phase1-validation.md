# Phase 1 Validation Notes

## Automated checks completed

- Workspace build passes: `npm run build`
- Desktop dev boot smoke test passes:
  - Vite server starts on `http://localhost:5173`
  - Electron process launches with preload bridge
- iOS setup checks implemented and surfaced in UI:
  - `xcrun` availability
  - `pymobiledevice3` availability

## Manual iOS device checks to execute on a connected phone

1. Connect and trust iPhone/iPad on Mac.
2. Open app and verify `Connected`, `Authorized`, and `Ready` become true.
3. Run **Set Location** and verify location changes on target testing app.
4. Run **Start Route** and keep it running for at least 10 minutes.
5. Use **Pause**, **Resume**, and **Stop** and verify behavior.
6. Disconnect/reconnect device and verify control resumes after refresh.
7. Open diagnostics panel and confirm actionable logs exist.

## Interface freeze for Android next

The following command contract is now stable and should be reused by Android adapter work:

- `setPoint`
- `startRoute`
- `pause`
- `resume`
- `stop`
