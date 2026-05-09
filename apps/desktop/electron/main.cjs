const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

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

async function runSetupChecks() {
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

async function getDeviceStatus() {
  const checks = await runSetupChecks();
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

async function applyPoint(point) {
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

async function clearLocation() {
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

function stopRouteTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function startRouteTimer() {
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
      await applyPoint(point);
    } catch (error) {
      await appendLog("error", "ios-main", error.message || "Failed to apply route point");
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

ipcMain.handle("app:setupChecks", async () => runSetupChecks());
ipcMain.handle("app:status", async () => getDeviceStatus());
ipcMain.handle("app:runCommand", async (_event, command) => {
  if (command.kind === "setPoint") {
    await applyPoint(command.point);
    return { ok: true };
  }
  if (command.kind === "startRoute") {
    state.route = command.route.points || [];
    state.cursor = 0;
    state.loop = Boolean(command.route.loop);
    state.tickMs = Number(command.route.tickMs || 1000);
    state.paused = false;
    startRouteTimer();
    await appendLog("info", "ios-main", "Route simulation started", {
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
    await clearLocation();
    await appendLog("info", "ios-main", "Route simulation stopped");
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
