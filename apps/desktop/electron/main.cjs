const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const {
  runCommand,
  assertNoTunneldFailure,
  isTransientError,
} = require("./runtime.cjs");

const DEFAULT_PLATFORM = "ios";

const state = {
  timer: null,
  stickyTimer: null,
  iosSessionProcess: null,
  iosKeepAliveActive: false,
  iosRestartAttempts: 0,
  iosRestartTimer: null,
  iosMaxRestarts: 8,
  iosBackoffBaseMs: 1000,
  iosBackoffCapMs: 30000,
  route: [],
  cursor: 0,
  loop: false,
  tickMs: 1000,
  paused: false,
  lastPoint: null,
  lastPlatform: null,
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
  const tunnelInfoBefore = await isTunnelRunning();
  if (tunnelInfoBefore.running) {
    const responsive = await isTunnelResponsive();
    if (!responsive) {
      try {
        await restartTunnelNonInteractive();
      } catch {
        // If sudo is not cached, we'll continue and provide actionable error below.
      }
    }
  }
  try {
    return await runCommand("pymobiledevice3", args, {
      timeoutMs: 30000,
      retries: 4,
      retryDelayMs: 1500,
      transientMatcher: isTransientError,
      successGuard: assertNoTunneldFailure,
    });
  } catch (error) {
    const stderr = `${error?.stderr || ""}`;
    const looksLikeTunnelHandshakeTimeout =
      stderr.includes("InvalidServiceError") &&
      (error?.code === 120 || error?.killed === true);
    if (looksLikeTunnelHandshakeTimeout) {
      // Self-heal path: if sudo credentials are cached, restart tunneld and retry once.
      try {
        await restartTunnelNonInteractive();
        return await runCommand("pymobiledevice3", args, {
          timeoutMs: 30000,
          retries: 1,
          retryDelayMs: 1000,
          transientMatcher: isTransientError,
          successGuard: assertNoTunneldFailure,
        });
      } catch {
        // Fall through to user-facing guidance when sudo is not cached or restart fails.
      }
      const tunnelInfo = await isTunnelRunning();
      const tunnelResponsive = tunnelInfo.running ? await isTunnelResponsive() : false;
      const tunnelHint = tunnelInfo.running
        ? tunnelResponsive
          ? "Tunnel is responsive but device service handoff is failing. Reconnect iPhone and retry."
          : "Tunnel process is running but not responding. Restart tunnel and reconnect iPhone."
        : "Tunnel is not running.";
      throw new Error(
        `${tunnelHint} Start it with: sudo python3 -m pymobiledevice3 remote tunneld`,
      );
    }
    throw error;
  }
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

async function getRequiredIosUdid() {
  const udid = await resolveDeviceId();
  if (!udid) {
    throw new Error("No iOS device detected. Reconnect iPhone and trust this computer.");
  }
  return udid;
}

function stopIosSessionProcess() {
  if (state.iosSessionProcess && !state.iosSessionProcess.killed) {
    try {
      state.iosSessionProcess.kill("SIGTERM");
    } catch {
      // no-op
    }
  }
  state.iosSessionProcess = null;
}

function stopIosKeepAlive() {
  state.iosKeepAliveActive = false;
  state.iosRestartAttempts = 0;
  if (state.iosRestartTimer) {
    clearTimeout(state.iosRestartTimer);
    state.iosRestartTimer = null;
  }
}

function startIosKeepAlive() {
  state.iosKeepAliveActive = true;
  state.iosRestartAttempts = 0;
}

function notifyRenderer(channel, payload) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function handleIosProcessExit(code, signal) {
  // Intentional stop — do not restart
  if (!state.iosKeepAliveActive || !state.lastPoint) return;
  if (signal === "SIGTERM") return;

  // Max retries exceeded — give up
  if (state.iosRestartAttempts >= state.iosMaxRestarts) {
    void appendLog("error", "ios-watchdog", "Max restart attempts reached, giving up", {
      attempts: state.iosRestartAttempts,
    });
    notifyRenderer("ios:sessionFailed", {
      message: "Location hold failed after multiple retries. Check device connection.",
    });
    state.iosKeepAliveActive = false;
    return;
  }

  const delay = Math.min(
    state.iosBackoffBaseMs * Math.pow(2, state.iosRestartAttempts),
    state.iosBackoffCapMs,
  );
  state.iosRestartAttempts += 1;

  void appendLog("warn", "ios-watchdog", `Process exited unexpectedly, restarting in ${delay}ms`, {
    code,
    signal,
    attempt: state.iosRestartAttempts,
  });
  notifyRenderer("ios:reconnecting", {
    attempt: state.iosRestartAttempts,
    maxAttempts: state.iosMaxRestarts,
    nextRetryMs: delay,
  });

  state.iosRestartTimer = setTimeout(async () => {
    state.iosRestartTimer = null;
    if (!state.iosKeepAliveActive || !state.lastPoint) return;
    try {
      await spawnIosLocationProcess(state.lastPoint);
      state.iosRestartAttempts = 0;
      void appendLog("info", "ios-watchdog", "Process restarted successfully");
      notifyRenderer("ios:reconnected", {});
    } catch (error) {
      void appendLog("error", "ios-watchdog", `Restart failed: ${error.message || error}`);
      handleIosProcessExit(null, null);
    }
  }, delay);
}

async function spawnIosLocationProcess(point) {
  const udid = await getRequiredIosUdid();
  // Use our custom Python script that re-applies location every 1 second
  // within a single DTX session — iOS 26 resets location if not continuously applied
  const scriptPath = path.join(__dirname, "ios_location_hold.py");
  const child = spawn("python3", [scriptPath, udid, `${point.lat}`, `${point.lng}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrBuffer = "";
  let stdoutBuffer = "";
  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });
  }
  if (child.stdout) {
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
    });
  }

  await new Promise((resolve, reject) => {
    // Wait for the "HOLDING" message which means location is being applied
    const settleTimer = setTimeout(() => {
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      if (stdoutBuffer.includes("HOLDING")) {
        state.iosSessionProcess = child;
        child.once("exit", (exitCode, exitSignal) => {
          if (state.iosSessionProcess === child) {
            state.iosSessionProcess = null;
            handleIosProcessExit(exitCode, exitSignal);
          }
        });
        resolve(undefined);
      } else if (stderrBuffer || stdoutBuffer.includes("ERROR")) {
        reject(new Error(stderrBuffer || stdoutBuffer || "Failed to start location hold"));
      } else {
        // Still waiting — give more time
        state.iosSessionProcess = child;
        child.once("exit", (exitCode, exitSignal) => {
          if (state.iosSessionProcess === child) {
            state.iosSessionProcess = null;
            handleIosProcessExit(exitCode, exitSignal);
          }
        });
        resolve(undefined);
      }
    }, 10000);

    // Check stdout periodically for early HOLDING signal
    const earlyCheck = setInterval(() => {
      if (stdoutBuffer.includes("HOLDING")) {
        clearInterval(earlyCheck);
        clearTimeout(settleTimer);
        child.removeListener("exit", onExit);
        child.removeListener("error", onError);
        state.iosSessionProcess = child;
        child.once("exit", (exitCode, exitSignal) => {
          if (state.iosSessionProcess === child) {
            state.iosSessionProcess = null;
            handleIosProcessExit(exitCode, exitSignal);
          }
        });
        resolve(undefined);
      }
    }, 300);

    const onError = (error) => {
      clearTimeout(settleTimer);
      clearInterval(earlyCheck);
      reject(error);
    };
    const onExit = (code, signal) => {
      clearTimeout(settleTimer);
      clearInterval(earlyCheck);
      const details = stderrBuffer.trim() || stdoutBuffer.trim();
      reject(
        new Error(
          details ||
            `iOS location process exited (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    };
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function startIosSessionProcess(point) {
  stopIosSessionProcess();
  await spawnIosLocationProcess(point);
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
    // Only count physical USB devices, not emulators (emulator-XXXX)
    const physicalLines = lines.filter((line) => !line.startsWith("emulator-"));
    const firstDevice = physicalLines.find((line) => line.endsWith("\tdevice"));
    const unauthorized = physicalLines.find((line) => line.endsWith("\tunauthorized"));
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

async function isTunnelResponsive() {
  try {
    await runCommand("curl", ["-fsS", "http://127.0.0.1:49151/"], { timeoutMs: 2500 });
    return true;
  } catch {
    return false;
  }
}

async function restartTunnelNonInteractive() {
  await runCommand("bash", ["-lc", "sudo -n true"], { timeoutMs: 2500 });
  try {
    await runCommand("pkill", ["-f", "python3 -m pymobiledevice3 remote tunneld"], {
      timeoutMs: 4000,
    });
  } catch {
    // no-op
  }
  await runCommand(
    "bash",
    [
      "-lc",
      "nohup sudo -n python3 -m pymobiledevice3 remote tunneld > /tmp/location-changer-tunneld.log 2>&1 &",
    ],
    { timeoutMs: 5000 },
  );
  await runCommand("bash", ["-lc", "sleep 1.5"], { timeoutMs: 3000 });
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

async function applyIosPoint(point, options = {}) {
  const { silent = false } = options;
  await startIosSessionProcess(point);
  if (!silent) {
    await appendLog("info", "ios-main", "Applied simulated point", point);
  }
}

async function clearIosLocation() {
  stopIosSessionProcess();
  stopIosKeepAlive();
  state.lastPoint = null;
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

function stopStickyTimer() {
  if (state.stickyTimer) {
    clearInterval(state.stickyTimer);
    state.stickyTimer = null;
  }
}

function startStickyTimer(platform) {
  stopStickyTimer();
  if (platform === "ios" || !state.lastPoint) return;
  // Android periodic re-apply
  state.stickyTimer = setInterval(async () => {
    if (!state.lastPoint || state.route.length > 0) return;
    try {
      await applyAndroidPoint(state.lastPoint);
    } catch (error) {
      await appendLog("warn", `${platform}-main`, error.message || "Sticky location re-apply failed");
    }
  }, 3500);
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
  const tunnelResponsive = tunnelInfo.running ? await isTunnelResponsive() : false;
  return {
    environment,
    checks: { ios: iosChecks, android: androidChecks },
    services: {
      tunneld: tunnelInfo.running,
      tunneldResponsive: tunnelResponsive,
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
    try {
      await restartTunnelNonInteractive();
      return { ok: true, message: "Started tunneld" };
    } catch {
      return {
        ok: false,
        message:
          "Could not start tunneld without password prompt. Run ./start.sh once and enter sudo password.",
      };
    }
  }
  if (action === "stop-tunneld") {
    try {
      await runCommand("pkill", ["-f", "python3 -m pymobiledevice3 remote tunneld"], { timeoutMs: 4000 });
    } catch {}
    return { ok: true, message: "Stopped tunneld" };
  }
  if (action === "restart-tunneld") {
    try {
      await restartTunnelNonInteractive();
      return { ok: true, message: "Restarted tunneld" };
    } catch {
      return {
        ok: false,
        message:
          "Could not restart tunneld without password prompt. Run ./start.sh once and enter sudo password.",
      };
    }
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
    state.lastPoint = command.point;
    state.lastPlatform = platform;
    if (platform === "android") {
      await applyAndroidPoint(command.point);
      startStickyTimer(platform);
    } else {
      await applyIosPoint(command.point);
      startIosKeepAlive();
    }
    return { ok: true };
  }
  if (command.kind === "startRoute") {
    stopStickyTimer();
    stopIosKeepAlive();
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
    stopStickyTimer();
    stopIosKeepAlive();
    stopIosSessionProcess();
    state.route = [];
    state.cursor = 0;
    state.paused = false;
    state.lastPoint = null;
    state.lastPlatform = null;
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
ipcMain.handle("app:getRemoteControlStatus", async () => ({ enabled: false, port: 8080, url: null, authToken: "", urlSchemeEnabled: false, wifiEnabled: false }));
ipcMain.handle("app:setRemoteControlEnabled", async () => ({ ok: true }));
ipcMain.handle("app:setWiFiModeEnabled", async () => ({ ok: true }));
ipcMain.handle("app:generateQRCode", async () => "");
ipcMain.handle("app:pairWiFiDevice", async () => ({ ok: false, error: "Not implemented" }));

app.whenReady().then(async () => {
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  stopIosKeepAlive();
  stopIosSessionProcess();
  if (process.platform !== "darwin") app.quit();
});
