const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const {
  runCommand,
  assertNoTunneldFailure,
  isTransientError,
} = require("./runtime.cjs");

const DEFAULT_PLATFORM = "ios";

const state = {
  timer: null,
  route: [],
  cursor: 0,
  loop: false,
  tickMs: 1000,
  paused: false,
};

function getDataPaths() {
  const base = app.getPath("userData");
  return {
    base,
    logFile: path.join(base, "logs", "app.log"),
    presetsFile: path.join(base, "config", "presets.json"),
    settingsFile: path.join(base, "config", "settings.json"),
    diagnosticsDir: path.join(base, "diagnostics"),
  };
}

async function appendLog(level, source, message, context = undefined) {
  const { logFile } = getDataPaths();
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    source,
    message: sanitizeValue(message),
    context: sanitizeValue(context),
  };
  await fs.appendFile(logFile, `${JSON.stringify(payload)}\n`, "utf-8");
}

function sanitizeValue(input) {
  if (input == null) return input;
  if (typeof input === "string") {
    return input.replace(/[A-Fa-f0-9-]{16,}/g, "[masked-id]");
  }
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeValue(item));
  }
  if (typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, sanitizeValue(value)]),
    );
  }
  return input;
}

async function hasCommand(command) {
  try {
    await runCommand("which", [command], { timeoutMs: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function runPymobileDeviceDeveloperCommand(args) {
  return runCommand("pymobiledevice3", args, {
    retries: 1,
    transientMatcher: isTransientError,
    successGuard: assertNoTunneldFailure,
  });
}

async function runIosSetupChecks() {
  const [xcrun, pymobiledevice3] = await Promise.all([hasCommand("xcrun"), hasCommand("pymobiledevice3")]);
  return [
    { key: "xcode-tools", ok: xcrun, message: "xcode command line tools are required", fixHint: "Install Xcode and run: xcode-select --install" },
    { key: "pymobiledevice3", ok: pymobiledevice3, message: "pymobiledevice3 is required for iOS location simulation", fixHint: "Install with: pip3 install pymobiledevice3" },
  ];
}

async function runAndroidSetupChecks() {
  const adb = await hasCommand("adb");
  return [
    { key: "adb", ok: adb, message: "Android platform tools (adb) are required", fixHint: "Install Android platform tools and ensure adb is on PATH" },
    { key: "android-mode", ok: true, message: "Android support is emulator-first in this phase", fixHint: "Use an emulator for reliable geo fix support" },
  ];
}

async function resolveDeviceId() {
  try {
    const { stdout } = await runCommand("pymobiledevice3", ["usbmux", "list"], { timeoutMs: 6000 });
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed[0]?.Identifier || parsed[0]?.UniqueDeviceID || null;
    }
  } catch {
    // no-op
  }
  return null;
}

async function getIosDeviceStatus() {
  const checks = await runIosSetupChecks();
  const deviceId = await resolveDeviceId();
  const ready = checks.every((check) => check.ok) && Boolean(deviceId);
  return { connected: Boolean(deviceId), authorized: Boolean(deviceId), ready, platform: "ios", deviceId: deviceId || undefined, message: ready ? "iOS simulation ready" : "setup or device connection required" };
}

async function resolveAndroidDevice() {
  try {
    const { stdout } = await runCommand("adb", ["devices"], { timeoutMs: 6000 });
    const lines = stdout.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("List of devices"));
    const firstDevice = lines.find((line) => line.endsWith("\tdevice"));
    const unauthorized = lines.find((line) => line.endsWith("\tunauthorized"));
    if (firstDevice) return { deviceId: firstDevice.split("\t")[0], state: "device" };
    if (unauthorized) return { deviceId: unauthorized.split("\t")[0], state: "unauthorized" };
  } catch {
    // no-op
  }
  return { deviceId: null, state: "none" };
}

async function getAndroidDeviceStatus() {
  const checks = await runAndroidSetupChecks();
  const { deviceId, state } = await resolveAndroidDevice();
  const ready = checks.every((check) => check.ok) && state === "device";
  return { connected: state !== "none", authorized: state === "device", ready, platform: "android", deviceId: deviceId || undefined, message: state === "unauthorized" ? "Authorize adb debugging on Android device" : ready ? "Android device ready (emulator-first mode)" : "Connect an Android device or emulator" };
}

function getHostPlatform() {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  return process.platform;
}

async function getEnvironment() {
  const [iosStatus, androidStatus] = await Promise.all([getIosDeviceStatus(), getAndroidDeviceStatus()]);
  return {
    hostPlatform: getHostPlatform(),
    autoPlatform: iosStatus.connected ? "ios" : androidStatus.connected ? "android" : DEFAULT_PLATFORM,
    detected: {
      ios: { connected: iosStatus.connected, authorized: iosStatus.authorized, ready: iosStatus.ready, deviceId: iosStatus.deviceId || null },
      android: { connected: androidStatus.connected, authorized: androidStatus.authorized, ready: androidStatus.ready, deviceId: androidStatus.deviceId || null },
    },
  };
}

async function isTunnelRunning() {
  try {
    const { stdout } = await runCommand(
      "pgrep",
      ["-f", "python3 -m pymobiledevice3 remote tunneld"],
      { timeoutMs: 4000 },
    );
    const pid = stdout.trim().split("\n")[0] || null;
    return { running: true, pid };
  } catch {
    return { running: false, pid: null };
  }
}

async function safeCommandOutput(command, args) {
  try {
    const result = await runCommand(command, args, { timeoutMs: 4000 });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: `${error?.stderr || error?.message || "command failed"}`.trim(),
    };
  }
}

async function applyIosPoint(point) {
  await runPymobileDeviceDeveloperCommand(["developer", "dvt", "simulate-location", "set", `${point.lat}`, `${point.lng}`]);
  await appendLog("info", "ios-main", "Applied simulated point", point);
}

async function clearIosLocation() {
  try {
    await runPymobileDeviceDeveloperCommand(["developer", "dvt", "simulate-location", "clear"]);
  } catch {
    await appendLog("warn", "ios-main", "Could not clear simulated location");
  }
}

async function applyAndroidPoint(point) {
  const { deviceId } = await resolveAndroidDevice();
  if (!deviceId) throw new Error("No Android device is available via adb");
  await runCommand("adb", ["-s", deviceId, "emu", "geo", "fix", `${point.lng}`, `${point.lat}`], { timeoutMs: 8000, retries: 1, transientMatcher: isTransientError });
  await appendLog("info", "android-main", "Applied simulated point", point);
}

function stopRouteTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function startRouteTimer(platform) {
  stopRouteTimer();
  state.timer = setInterval(async () => {
    if (state.paused || state.route.length === 0) return;
    const point = state.route[state.cursor];
    if (!point) return;
    try {
      if (platform === "android") await applyAndroidPoint(point);
      else await applyIosPoint(point);
    } catch (error) {
      state.paused = true;
      await appendLog("error", `${platform}-main`, error.message || "Failed to apply route point");
    }
    const atLast = state.cursor === state.route.length - 1;
    if (atLast && !state.loop) return stopRouteTimer();
    state.cursor = atLast ? 0 : state.cursor + 1;
  }, state.tickMs);
}

async function loadPresets() {
  const { presetsFile } = getDataPaths();
  await fs.mkdir(path.dirname(presetsFile), { recursive: true });
  try {
    return JSON.parse(await fs.readFile(presetsFile, "utf-8"));
  } catch {
    const initial = { places: [], routes: [] };
    await fs.writeFile(presetsFile, JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }
}

async function savePresets(payload) {
  const { presetsFile } = getDataPaths();
  await fs.mkdir(path.dirname(presetsFile), { recursive: true });
  await fs.writeFile(presetsFile, JSON.stringify(payload, null, 2), "utf-8");
  return { ok: true };
}

async function loadSettings() {
  const { settingsFile } = getDataPaths();
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  try {
    return JSON.parse(await fs.readFile(settingsFile, "utf-8"));
  } catch {
    const initial = { platformMode: "auto", mapZoom: 14, mapCenter: { lat: 12.9716, lng: 77.5946 }, lastTeleport: { lat: 12.9716, lng: 77.5946 }, lastRouteDraft: "12.9716,77.5946\n12.9722,77.5980", theme: "dark" };
    await fs.writeFile(settingsFile, JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }
}

async function saveSettings(payload) {
  const { settingsFile } = getDataPaths();
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  await fs.writeFile(settingsFile, JSON.stringify(payload, null, 2), "utf-8");
  return { ok: true };
}

async function getHealth() {
  const [environment, iosChecks, androidChecks, tunnelInfo, xcodePath, xcodeVersion, pmdVersion, adbVersion, iosDevice, androidDevice] = await Promise.all([
    getEnvironment(),
    runIosSetupChecks(),
    runAndroidSetupChecks(),
    isTunnelRunning(),
    safeCommandOutput("xcode-select", ["-p"]),
    safeCommandOutput("xcodebuild", ["-version"]),
    safeCommandOutput("pymobiledevice3", ["--version"]),
    safeCommandOutput("adb", ["--version"]),
    safeCommandOutput("pymobiledevice3", ["usbmux", "list"]),
    safeCommandOutput("adb", ["devices"]),
  ]);
  return {
    environment,
    checks: { ios: iosChecks, android: androidChecks },
    services: {
      tunneld: tunnelInfo.running,
      tunneldPid: tunnelInfo.pid,
      xcodePath: xcodePath.ok ? xcodePath.stdout : xcodePath.stderr,
      xcodeVersion: xcodeVersion.ok ? xcodeVersion.stdout : xcodeVersion.stderr,
      pymobiledevice3Version: pmdVersion.ok ? pmdVersion.stdout : pmdVersion.stderr,
      adbVersion: adbVersion.ok ? adbVersion.stdout : adbVersion.stderr,
      iosRaw: iosDevice.ok ? iosDevice.stdout : iosDevice.stderr,
      androidRaw: androidDevice.ok ? androidDevice.stdout : androidDevice.stderr,
    },
  };
}

async function runRepairAction(action) {
  if (action === "start-tunneld") {
    await runCommand("bash", ["-lc", "nohup sudo python3 -m pymobiledevice3 remote tunneld > /tmp/location-changer-tunneld.log 2>&1 &"], { timeoutMs: 5000 });
    return { ok: true, message: "Requested tunneld start in Terminal" };
  }
  if (action === "stop-tunneld") {
    try {
      await runCommand("pkill", ["-f", "python3 -m pymobiledevice3 remote tunneld"], { timeoutMs: 4000 });
    } catch {}
    return { ok: true, message: "Stopped tunneld" };
  }
  if (action === "restart-tunneld") {
    try {
      await runCommand("pkill", ["-f", "python3 -m pymobiledevice3 remote tunneld"], { timeoutMs: 4000 });
    } catch {}
    await runCommand("bash", ["-lc", "nohup sudo python3 -m pymobiledevice3 remote tunneld > /tmp/location-changer-tunneld.log 2>&1 &"], { timeoutMs: 5000 });
    return { ok: true, message: "Restarted tunneld" };
  }
  if (action === "rerun-checks") {
    return { ok: true, message: "Checks refreshed" };
  }
  return { ok: false, message: `Unsupported action: ${action}` };
}

async function exportPresetsToFile(payload) {
  const window = BrowserWindow.getAllWindows()[0];
  const result = await dialog.showSaveDialog(window, { title: "Export presets", defaultPath: "location-changer-presets.json" });
  if (result.canceled || !result.filePath) return { ok: false };
  await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf-8");
  return { ok: true, path: result.filePath };
}

async function importPresetsFromFile() {
  const window = BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(window, { title: "Import presets", properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
  if (result.canceled || result.filePaths.length === 0) return { ok: false };
  const payload = JSON.parse(await fs.readFile(result.filePaths[0], "utf-8"));
  return { ok: true, payload };
}

async function readLogs() {
  const { logFile } = getDataPaths();
  try {
    return (await fs.readFile(logFile, "utf-8")).trim().split("\n").slice(-300);
  } catch {
    return [];
  }
}

async function exportDiagnosticsBundle() {
  const { diagnosticsDir } = getDataPaths();
  await fs.mkdir(diagnosticsDir, { recursive: true });
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(diagnosticsDir, `bundle-${now}.json`);
  const [environment, settings, logs] = await Promise.all([getEnvironment(), loadSettings(), readLogs()]);
  await fs.writeFile(outPath, JSON.stringify({ createdAt: new Date().toISOString(), environment, settings, logs, appVersion: app.getVersion(), platform: process.platform }, null, 2), "utf-8");
  return { ok: true, path: outPath };
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 740,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  if (process.env.VITE_DEV_SERVER_URL) await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

ipcMain.handle("app:setupChecks", async (_event, platform = DEFAULT_PLATFORM) => (platform === "android" ? runAndroidSetupChecks() : runIosSetupChecks()));
ipcMain.handle("app:status", async (_event, platform = DEFAULT_PLATFORM) => (platform === "android" ? getAndroidDeviceStatus() : getIosDeviceStatus()));
ipcMain.handle("app:environment", async () => getEnvironment());
ipcMain.handle("app:health", async () => getHealth());
ipcMain.handle("app:repairAction", async (_event, action) => runRepairAction(action));
ipcMain.handle("app:loadSettings", async () => loadSettings());
ipcMain.handle("app:saveSettings", async (_event, payload) => saveSettings(payload));
ipcMain.handle("app:runCommand", async (_event, command) => {
  const platform = command.platform || DEFAULT_PLATFORM;
  if (command.kind === "setPoint") {
    if (platform === "android") await applyAndroidPoint(command.point);
    else await applyIosPoint(command.point);
    return { ok: true };
  }
  if (command.kind === "startRoute") {
    state.route = command.route.points || [];
    state.cursor = 0;
    state.loop = Boolean(command.route.loop);
    state.tickMs = Number(command.route.tickMs || 1000);
    state.paused = false;
    startRouteTimer(platform);
    await appendLog("info", `${platform}-main`, "Route simulation started", { points: state.route.length, loop: state.loop, tickMs: state.tickMs });
    return { ok: true };
  }
  if (command.kind === "pause") return (state.paused = true), { ok: true };
  if (command.kind === "resume") return (state.paused = false), { ok: true };
  if (command.kind === "stop") {
    stopRouteTimer();
    state.route = [];
    state.cursor = 0;
    state.paused = false;
    if (platform === "ios") await clearIosLocation();
    await appendLog("info", `${platform}-main`, "Route simulation stopped");
    return { ok: true };
  }
  throw new Error("Unknown command");
});
ipcMain.handle("app:loadPresets", async () => loadPresets());
ipcMain.handle("app:savePresets", async (_event, payload) => savePresets(payload));
ipcMain.handle("app:exportPresets", async (_event, payload) => exportPresetsToFile(payload));
ipcMain.handle("app:importPresets", async () => importPresetsFromFile());
ipcMain.handle("app:readLogs", async () => readLogs());
ipcMain.handle("app:exportDiagnostics", async () => exportDiagnosticsBundle());

app.whenReady().then(async () => {
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
