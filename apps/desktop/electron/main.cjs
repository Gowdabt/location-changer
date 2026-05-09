const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const DEFAULT_PLATFORM = "ios";

const state = {
  timer: null,
  route: [],
  cursor: 0,
  loop: false,
  tickMs: 1000,
  paused: false,
};

async function hasCommand(command) {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

function getDataPaths() {
  const base = app.getPath("userData");
  return {
    base,
    logFile: path.join(base, "logs", "app.log"),
    presetsFile: path.join(base, "config", "presets.json"),
  };
}

async function appendLog(level, source, message, context = undefined) {
  const { logFile } = getDataPaths();
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    context,
  };
  await fs.appendFile(logFile, `${JSON.stringify(payload)}\n`, "utf-8");
}

async function runIosSetupChecks() {
  const [xcrun, pymobiledevice3] = await Promise.all([
    hasCommand("xcrun"),
    hasCommand("pymobiledevice3"),
  ]);
  return [
    {
      key: "xcode-tools",
      ok: xcrun,
      message: "xcode command line tools are required",
      fixHint: "Install Xcode and run: xcode-select --install",
    },
    {
      key: "pymobiledevice3",
      ok: pymobiledevice3,
      message: "pymobiledevice3 is required for iOS location simulation",
      fixHint: "Install with: pip3 install pymobiledevice3",
    },
  ];
}

async function runAndroidSetupChecks() {
  const adb = await hasCommand("adb");
  return [
    {
      key: "adb",
      ok: adb,
      message: "Android platform tools (adb) are required",
      fixHint: "Install Android platform tools and ensure adb is on PATH",
    },
    {
      key: "android-mode",
      ok: true,
      message: "Android support is emulator-first in this phase",
      fixHint: "Use an emulator for reliable geo fix support",
    },
  ];
}

async function resolveDeviceId() {
  try {
    const { stdout } = await execFileAsync("pymobiledevice3", ["usbmux", "list"]);
    const line = stdout
      .split("\n")
      .find((item) => item.includes("SerialNumber") || item.includes("UDID"));
    if (!line) {
      return null;
    }
    const match = line.match(/[A-Fa-f0-9-]{8,}/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

async function getIosDeviceStatus() {
  const checks = await runIosSetupChecks();
  const deviceId = await resolveDeviceId();
  const ready = checks.every((check) => check.ok) && Boolean(deviceId);
  return {
    connected: Boolean(deviceId),
    authorized: Boolean(deviceId),
    ready,
    platform: "ios",
    deviceId: deviceId || undefined,
    message: ready ? "iOS simulation ready" : "setup or device connection required",
  };
}

async function resolveAndroidDevice() {
  try {
    const { stdout } = await execFileAsync("adb", ["devices"]);
    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("List of devices"));
    const firstDevice = lines.find((line) => line.endsWith("\tdevice"));
    const unauthorized = lines.find((line) => line.endsWith("\tunauthorized"));
    if (firstDevice) {
      return { deviceId: firstDevice.split("\t")[0], state: "device" };
    }
    if (unauthorized) {
      return { deviceId: unauthorized.split("\t")[0], state: "unauthorized" };
    }
    return { deviceId: null, state: "none" };
  } catch {
    return { deviceId: null, state: "none" };
  }
}

async function getAndroidDeviceStatus() {
  const checks = await runAndroidSetupChecks();
  const { deviceId, state } = await resolveAndroidDevice();
  const ready = checks.every((check) => check.ok) && state === "device";
  return {
    connected: state !== "none",
    authorized: state === "device",
    ready,
    platform: "android",
    deviceId: deviceId || undefined,
    message:
      state === "unauthorized"
        ? "Authorize adb debugging on Android device"
        : ready
          ? "Android device ready (emulator-first mode)"
          : "Connect an Android device or emulator",
  };
}

function getHostPlatform() {
  if (process.platform === "darwin") {
    return "mac";
  }
  if (process.platform === "win32") {
    return "windows";
  }
  if (process.platform === "linux") {
    return "linux";
  }
  return process.platform;
}

async function getEnvironment() {
  const [iosStatus, androidStatus] = await Promise.all([
    getIosDeviceStatus(),
    getAndroidDeviceStatus(),
  ]);
  const autoPlatform = iosStatus.connected ? "ios" : androidStatus.connected ? "android" : DEFAULT_PLATFORM;
  return {
    hostPlatform: getHostPlatform(),
    autoPlatform,
    detected: {
      ios: {
        connected: iosStatus.connected,
        authorized: iosStatus.authorized,
        ready: iosStatus.ready,
        deviceId: iosStatus.deviceId || null,
      },
      android: {
        connected: androidStatus.connected,
        authorized: androidStatus.authorized,
        ready: androidStatus.ready,
        deviceId: androidStatus.deviceId || null,
      },
    },
  };
}

async function applyIosPoint(point) {
  await execFileAsync("pymobiledevice3", [
    "developer",
    "dvt",
    "simulate-location",
    "set",
    "--lat",
    `${point.lat}`,
    "--lon",
    `${point.lng}`,
  ]);
  await appendLog("info", "ios-main", "Applied simulated point", point);
}

async function clearIosLocation() {
  try {
    await execFileAsync("pymobiledevice3", [
      "developer",
      "dvt",
      "simulate-location",
      "clear",
    ]);
  } catch {
    await appendLog("warn", "ios-main", "Could not clear simulated location");
  }
}

async function applyAndroidPoint(point) {
  const { deviceId } = await resolveAndroidDevice();
  if (!deviceId) {
    throw new Error("No Android device is available via adb");
  }
  try {
    await execFileAsync("adb", [
      "-s",
      deviceId,
      "emu",
      "geo",
      "fix",
      `${point.lng}`,
      `${point.lat}`,
    ]);
  } catch {
    throw new Error(
      "Android geo fix failed. This phase supports emulator-style geo simulation via adb emu geo fix.",
    );
  }
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
    if (state.paused || state.route.length === 0) {
      return;
    }
    const point = state.route[state.cursor];
    if (!point) {
      return;
    }
    try {
      if (platform === "android") {
        await applyAndroidPoint(point);
      } else {
        await applyIosPoint(point);
      }
    } catch (error) {
      await appendLog(
        "error",
        `${platform}-main`,
        error.message || "Failed to apply route point",
      );
    }
    const atLast = state.cursor === state.route.length - 1;
    if (atLast && !state.loop) {
      stopRouteTimer();
      return;
    }
    state.cursor = atLast ? 0 : state.cursor + 1;
  }, state.tickMs);
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("app:setupChecks", async (_event, platform = DEFAULT_PLATFORM) => {
  return platform === "android" ? runAndroidSetupChecks() : runIosSetupChecks();
});
ipcMain.handle("app:status", async (_event, platform = DEFAULT_PLATFORM) => {
  return platform === "android" ? getAndroidDeviceStatus() : getIosDeviceStatus();
});
ipcMain.handle("app:environment", async () => getEnvironment());
ipcMain.handle("app:runCommand", async (_event, command) => {
  const platform = command.platform || DEFAULT_PLATFORM;
  if (command.kind === "setPoint") {
    if (platform === "android") {
      await applyAndroidPoint(command.point);
    } else {
      await applyIosPoint(command.point);
    }
    return { ok: true };
  }
  if (command.kind === "startRoute") {
    state.route = command.route.points || [];
    state.cursor = 0;
    state.loop = Boolean(command.route.loop);
    state.tickMs = Number(command.route.tickMs || 1000);
    state.paused = false;
    startRouteTimer(platform);
    await appendLog("info", `${platform}-main`, "Route simulation started", {
      points: state.route.length,
      loop: state.loop,
      tickMs: state.tickMs,
    });
    return { ok: true };
  }
  if (command.kind === "pause") {
    state.paused = true;
    return { ok: true };
  }
  if (command.kind === "resume") {
    state.paused = false;
    return { ok: true };
  }
  if (command.kind === "stop") {
    stopRouteTimer();
    state.route = [];
    state.cursor = 0;
    state.paused = false;
    if (platform === "ios") {
      await clearIosLocation();
    }
    await appendLog("info", `${platform}-main`, "Route simulation stopped");
    return { ok: true };
  }
  throw new Error("Unknown command");
});

ipcMain.handle("app:loadPresets", async () => {
  const { presetsFile } = getDataPaths();
  await fs.mkdir(path.dirname(presetsFile), { recursive: true });
  try {
    const raw = await fs.readFile(presetsFile, "utf-8");
    return JSON.parse(raw);
  } catch {
    const initial = { places: [], routes: [] };
    await fs.writeFile(presetsFile, JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }
});

ipcMain.handle("app:savePresets", async (_event, payload) => {
  const { presetsFile } = getDataPaths();
  await fs.mkdir(path.dirname(presetsFile), { recursive: true });
  await fs.writeFile(presetsFile, JSON.stringify(payload, null, 2), "utf-8");
  return { ok: true };
});

ipcMain.handle("app:readLogs", async () => {
  const { logFile } = getDataPaths();
  try {
    const raw = await fs.readFile(logFile, "utf-8");
    return raw.trim().split("\n").slice(-200);
  } catch {
    return [];
  }
});

app.whenReady().then(async () => {
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
