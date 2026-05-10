import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

type SetupCheck = { key: string; ok: boolean; message: string; fixHint?: string };
type DeviceStatus = {
  connected: boolean;
  authorized: boolean;
  ready: boolean;
  platform: "ios" | "android";
  deviceId?: string;
  message?: string;
};
type EnvironmentInfo = {
  hostPlatform: string;
  autoPlatform: "ios" | "android";
  detected: {
    ios: { connected: boolean; authorized: boolean; ready: boolean; deviceId: string | null };
    android: { connected: boolean; authorized: boolean; ready: boolean; deviceId: string | null };
  };
};
type GeoPoint = { lat: number; lng: number };
type Presets = {
  places: Array<{ id: string; name: string; point: GeoPoint }>;
  routes: Array<{ id: string; name: string; route: { points: GeoPoint[]; tickMs: number; loop: boolean } }>;
};
type Health = {
  environment: EnvironmentInfo;
  checks: { ios: SetupCheck[]; android: SetupCheck[] };
  services: Record<string, string | boolean | null>;
};
type Toast = { id: string; level: "success" | "error" | "info"; text: string };
type Settings = {
  platformMode: "auto" | "ios" | "android";
  mapZoom: number;
  mapCenter: GeoPoint;
  lastTeleport: GeoPoint;
  lastRouteDraft: string;
  theme: "dark" | "light" | "system";
  compactMode: boolean;
  onboardingDone: boolean;
};

const initialPresets: Presets = { places: [], routes: [] };
const DEFAULT_POINT: GeoPoint = { lat: 12.9716, lng: 77.5946 };

function MapClickSync({
  point,
  onPick,
}: {
  point: GeoPoint;
  onPick: (point: GeoPoint, addToRoute: boolean) => void;
}) {
  const map = useMapEvents({
    click(event) {
      onPick(
        { lat: event.latlng.lat, lng: event.latlng.lng },
        Boolean((event.originalEvent as MouseEvent).shiftKey),
      );
    },
  });

  useEffect(() => {
    map.setView([point.lat, point.lng], map.getZoom(), { animate: true });
  }, [map, point]);

  return null;
}

function App() {
  const [platformMode, setPlatformMode] = useState<"auto" | "ios" | "android">("auto");
  const [activePlatform, setActivePlatform] = useState<"ios" | "android">("ios");
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [checks, setChecks] = useState<SetupCheck[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [logFilter, setLogFilter] = useState<"all" | "info" | "warn" | "error">("all");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [presets, setPresets] = useState<Presets>(initialPresets);
  const [name, setName] = useState("Home");
  const [routeName, setRouteName] = useState("Daily Route");
  const [lat, setLat] = useState("12.9716");
  const [lng, setLng] = useState("77.5946");
  const [routeText, setRouteText] = useState("12.9716,77.5946\n12.9722,77.5980");
  const [routePoints, setRoutePoints] = useState<GeoPoint[]>([
    { lat: 12.9716, lng: 77.5946 },
    { lat: 12.9722, lng: 77.5980 },
  ]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [tickMs, setTickMs] = useState(1000);
  const [loopRoute, setLoopRoute] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [compactMode, setCompactMode] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [permissionPlatform, setPermissionPlatform] = useState<"ios" | "android">("ios");
  const [speedPreset, setSpeedPreset] = useState<"walk" | "cycle" | "drive" | "custom">("walk");
  const [customSpeed, setCustomSpeed] = useState(1.4);
  const [jitterEnabled, setJitterEnabled] = useState(false);
  const [mapZoom, setMapZoom] = useState(14);
  const [mapCenter, setMapCenter] = useState<GeoPoint>(DEFAULT_POINT);
  const [lastSetLocationInfo, setLastSetLocationInfo] = useState<string>("");
  const saveTimer = useRef<number | null>(null);

  const parsedPoint = useMemo(() => {
    const next = { lat: Number(lat), lng: Number(lng) };
    return Number.isNaN(next.lat) || Number.isNaN(next.lng) ? DEFAULT_POINT : next;
  }, [lat, lng]);

  const pushToast = (level: Toast["level"], text: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, level, text }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), 3200);
  };

  const refresh = async () => {
    const env = await window.locationApp.environment();
    const targetPlatform = platformMode === "auto" ? env.autoPlatform : platformMode;
    const [statusValue, checksValue, logsValue, presetsValue, healthValue] = await Promise.all([
      window.locationApp.status(targetPlatform),
      window.locationApp.setupChecks(targetPlatform),
      window.locationApp.readLogs(),
      window.locationApp.loadPresets(),
      window.locationApp.health(),
    ]);
    setEnvironment(env);
    setHealth(healthValue as unknown as Health);
    setActivePlatform(targetPlatform);
    setStatus(statusValue);
    setChecks(checksValue);
    setLogs(logsValue);
    setPresets(presetsValue);
  };

  useEffect(() => {
    void refresh();
  }, [platformMode]);

  useEffect(() => {
    void (async () => {
      const saved = (await window.locationApp.loadSettings()) as Settings;
      setPlatformMode(saved.platformMode);
      setMapZoom(saved.mapZoom);
      setMapCenter(saved.mapCenter);
      setTheme(saved.theme);
      setCompactMode(saved.compactMode ?? false);
      setLat(`${saved.lastTeleport.lat}`);
      setLng(`${saved.lastTeleport.lng}`);
      setRouteText(saved.lastRouteDraft);
      setShowOnboarding(!saved.onboardingDone);
      const parsed = saved.lastRouteDraft
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [a, b] = line.split(",").map((item) => Number(item.trim()));
          return { lat: a, lng: b };
        });
      if (parsed.length > 0) setRoutePoints(parsed);
    })();
  }, []);

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void window.locationApp.saveSettings({
        platformMode,
        mapZoom,
        mapCenter,
        lastTeleport: parsedPoint,
        lastRouteDraft: routeText,
        theme,
        compactMode,
        onboardingDone: !showOnboarding,
      });
    }, 350);
  }, [platformMode, mapZoom, mapCenter, parsedPoint, routeText, theme, compactMode, showOnboarding]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const executeSimpleCommand = async (kind: "pause" | "resume" | "stop") => {
    try {
      await window.locationApp.runCommand({ platform: activePlatform, kind });
      pushToast("info", `${kind} command sent`);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "command failed");
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void runTeleport();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void runRoute();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        void executeSimpleCommand("stop");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const runTeleport = async () => {
    try {
      await window.locationApp.runCommand({ platform: activePlatform, kind: "setPoint", point: parsedPoint });
      const now = new Date().toLocaleTimeString();
      const coords = `${parsedPoint.lat.toFixed(6)}, ${parsedPoint.lng.toFixed(6)}`;
      setLastSetLocationInfo(`Location set to ${coords} at ${now}`);
      pushToast("success", `Location set: ${coords}`);
      await refresh();
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to apply location");
    }
  };

  const runRoute = async () => {
    try {
      const speed =
        speedPreset === "walk" ? 1.4 : speedPreset === "cycle" ? 5.5 : speedPreset === "drive" ? 13.9 : customSpeed;
      const points = jitterEnabled
        ? routePoints.map((point, idx) =>
            idx === 0 || idx === routePoints.length - 1
              ? point
              : {
                  lat: point.lat + (Math.random() - 0.5) * 0.00008,
                  lng: point.lng + (Math.random() - 0.5) * 0.00008,
                },
          )
        : routePoints;
      await window.locationApp.runCommand({
        platform: activePlatform,
        kind: "startRoute",
        route: { points, tickMs, loop: loopRoute, speedPreset, speedMetersPerSecond: speed },
      });
      pushToast("success", "Route started");
      await refresh();
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Failed to start route");
    }
  };

  const savePlace = async () => {
    const next = { ...presets, places: [...presets.places, { id: crypto.randomUUID(), name, point: parsedPoint }] };
    await window.locationApp.savePresets(next);
    setPresets(next);
    pushToast("success", "Saved place");
  };

  const deletePlace = async (id: string) => {
    const next = { ...presets, places: presets.places.filter((place) => place.id !== id) };
    await window.locationApp.savePresets(next);
    setPresets(next);
    pushToast("info", "Deleted place");
  };

  const saveRoute = async () => {
    const next = {
      ...presets,
      routes: [...presets.routes, { id: crypto.randomUUID(), name: routeName, route: { points: routePoints, tickMs, loop: loopRoute } }],
    };
    await window.locationApp.savePresets(next);
    setPresets(next);
    pushToast("success", "Saved route");
  };

  const renameRoute = async (id: string, nextName: string) => {
    const next = { ...presets, routes: presets.routes.map((route) => (route.id === id ? { ...route, name: nextName } : route)) };
    await window.locationApp.savePresets(next);
    setPresets(next);
  };

  const loadRoute = (id: string) => {
    const selected = presets.routes.find((route) => route.id === id);
    if (!selected) return;
    setRoutePoints(selected.route.points);
    setTickMs(selected.route.tickMs);
    setLoopRoute(selected.route.loop);
    setRouteText(selected.route.points.map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`).join("\n"));
    pushToast("info", "Route loaded");
  };

  const deleteRoute = async (id: string) => {
    const next = { ...presets, routes: presets.routes.filter((route) => route.id !== id) };
    await window.locationApp.savePresets(next);
    setPresets(next);
    pushToast("info", "Deleted route");
  };

  const exportPresets = async () => {
    const result = await window.locationApp.exportPresets(presets);
    if (result.ok) pushToast("success", "Presets exported");
  };

  const importPresets = async () => {
    const result = await window.locationApp.importPresets();
    if (result.ok && result.payload) {
      const payload = result.payload as Presets;
      await window.locationApp.savePresets(payload);
      setPresets(payload);
      pushToast("success", "Presets imported");
    }
  };

  const runRepairAction = async (action: string) => {
    const result = await window.locationApp.repairAction(action);
    pushToast(result.ok ? "success" : "error", result.message);
    await refresh();
  };

  const exportDiagnostics = async () => {
    const result = await window.locationApp.exportDiagnostics();
    if (result.ok) pushToast("success", `Diagnostics exported: ${result.path ?? ""}`);
  };

  const selectMapPoint = (point: GeoPoint) => {
    setLat(point.lat.toFixed(6));
    setLng(point.lng.toFixed(6));
    setMapCenter(point);
  };

  const addRoutePoint = (point: GeoPoint) => {
    const next = [...routePoints, point];
    setRoutePoints(next);
    setRouteText(next.map((item) => `${item.lat.toFixed(6)},${item.lng.toFixed(6)}`).join("\n"));
  };

  const removeRoutePoint = (index: number) => {
    const next = routePoints.filter((_item, idx) => idx !== index);
    setRoutePoints(next);
    setRouteText(next.map((item) => `${item.lat.toFixed(6)},${item.lng.toFixed(6)}`).join("\n"));
  };

  const moveRoutePoint = (from: number, to: number) => {
    const next = [...routePoints];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setRoutePoints(next);
    setRouteText(next.map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`).join("\n"));
  };

  const routeDistanceKm = useMemo(() => {
    const toRad = (value: number) => (value * Math.PI) / 180;
    let total = 0;
    for (let i = 0; i < routePoints.length - 1; i += 1) {
      const a = routePoints[i];
      const b = routePoints[i + 1];
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const x =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      total += 6371 * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
    }
    return total;
  }, [routePoints]);

  const estimatedMinutes = useMemo(() => {
    const speed =
      speedPreset === "walk" ? 1.4 : speedPreset === "cycle" ? 5.5 : speedPreset === "drive" ? 13.9 : customSpeed;
    return ((routeDistanceKm * 1000) / Math.max(0.1, speed)) / 60;
  }, [routeDistanceKm, speedPreset, customSpeed]);

  const filteredLogs = logs.filter((line) => (logFilter === "all" ? true : line.includes(`"level":"${logFilter}"`)));
  const timeline = filteredLogs
    .map((line) => {
      try {
        return JSON.parse(line) as {
          timestamp: string;
          level: "info" | "warn" | "error";
          source: string;
          message: string;
          context?: Record<string, unknown>;
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse() as Array<{
    timestamp: string;
    level: "info" | "warn" | "error";
    source: string;
    message: string;
    context?: Record<string, unknown>;
  }>;

  return (
    <main className={`layout ${compactMode ? "compact" : ""}`}>
      <section className="guardrail">Testing/simulation use only. Respect app policies and local laws.</section>
      {showOnboarding ? (
        <section className="onboarding">
          <h3>Quick setup</h3>
          <ol>
            <li>Connect device and trust computer.</li>
            <li>Use map click for teleport, Shift+click for route points.</li>
            <li>Shortcuts: Ctrl/Cmd+Enter set, Ctrl/Cmd+R start route, Esc stop.</li>
          </ol>
          <button onClick={() => setShowOnboarding(false)}>Got it</button>
        </section>
      ) : null}

      <div className="toastWrap">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.level}`}>
            {toast.text}
          </div>
        ))}
      </div>

      <header className="header">
        <div>
          <h1>Location Changer</h1>
          <p className="subtle">Visual location simulator for iOS and Android testing</p>
        </div>
        <div className="headerControls">
          <select className="controlSelect" value={platformMode} onChange={(event) => setPlatformMode(event.target.value as "auto" | "ios" | "android")}>
            <option value="auto">Auto Detect Device</option>
            <option value="ios">iOS / iPadOS</option>
            <option value="android">Android</option>
          </select>
          <button className="refreshBtn" onClick={() => void refresh()}>
            Refresh
          </button>
          <button onClick={() => setCompactMode((prev) => !prev)}>
            {compactMode ? "Normal" : "Compact"}
          </button>
          <select className="themeSelect" value={theme} onChange={(event) => setTheme(event.target.value as Settings["theme"])}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </div>
      </header>

      <section className="card">
        <h2>Device Status</h2>
        <p>
          Host: <strong>{environment?.hostPlatform ?? "unknown"}</strong> | Active platform: <strong>{activePlatform}</strong>
        </p>
        <p>
          Detected iOS: {String(environment?.detected.ios.connected ?? false)} | Detected Android: {String(environment?.detected.android.connected ?? false)}
        </p>
        <p>{status?.message ?? "Loading..."}</p>
        <div className="pillRow">
          <span className={`pill ${status?.connected ? "ok" : "bad"}`}>Connected: {String(status?.connected)}</span>
          <span className={`pill ${status?.authorized ? "ok" : "bad"}`}>Authorized: {String(status?.authorized)}</span>
          <span className={`pill ${status?.ready ? "ok" : "bad"}`}>Ready: {String(status?.ready)}</span>
        </div>
        <ul>
          {checks.map((check) => (
            <li key={check.key}>
              <strong>{check.ok ? "OK" : "Fix"}:</strong> {check.ok ? `${check.key} available` : check.message}
              {!check.ok && check.fixHint ? ` (${check.fixHint})` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Connection Health</h2>
        <div className="pillRow">
          <span className={`pill ${Boolean(health?.services.tunneld) ? "ok" : "bad"}`}>
            tunneld: {String(health?.services.tunneld)}
          </span>
        </div>
        <div className="actions">
          <button onClick={() => void runRepairAction("start-tunneld")}>Start tunnel</button>
          <button onClick={() => void runRepairAction("stop-tunneld")}>Stop tunnel</button>
          <button onClick={() => void runRepairAction("restart-tunneld")}>Restart tunnel</button>
          <button onClick={() => void runRepairAction("rerun-checks")}>Rerun checks</button>
          <button onClick={() => void refresh()}>Rescan</button>
        </div>
        <details>
          <summary>Tooling dashboard</summary>
          <pre>{JSON.stringify(health?.services ?? {}, null, 2)}</pre>
        </details>
      </section>

      <section className="card mapCard">
        <div className="mapHeader">
          <h2>Map Picker</h2>
          <span>Click for teleport. Shift+click to add route points.</span>
        </div>
        <div className="mapWrap">
          <MapContainer center={[mapCenter.lat, mapCenter.lng]} zoom={mapZoom} scrollWheelZoom className="map">
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={[parsedPoint.lat, parsedPoint.lng]} />
            {routePoints.length > 1 ? <Polyline positions={routePoints.map((point) => [point.lat, point.lng])} /> : null}
            <MapClickSync
              point={parsedPoint}
              onPick={(point, addToRoute) => {
                if (addToRoute) addRoutePoint(point);
                else selectMapPoint(point);
              }}
            />
          </MapContainer>
        </div>
      </section>

      <section className="card grid twoCol">
        <div>
          <h2>Teleport</h2>
          <label>
            Latitude
            <input value={lat} onChange={(event) => setLat(event.target.value)} />
          </label>
          <label>
            Longitude
            <input value={lng} onChange={(event) => setLng(event.target.value)} />
          </label>
          <button onClick={() => void runTeleport()}>Set Location</button>
          {lastSetLocationInfo ? <p className="subtle">{lastSetLocationInfo}</p> : null}
          <div className="inline">
            <input value={name} onChange={(event) => setName(event.target.value)} />
            <button onClick={() => void savePlace()}>Save Place</button>
            <button onClick={() => void exportPresets()}>Export Presets</button>
            <button onClick={() => void importPresets()}>Import Presets</button>
          </div>
          <ul className="chipList">
            {presets.places.map((place) => (
              <li key={place.id} className="chipItem">
                <button className="chipSelect" onClick={() => { setLat(`${place.point.lat}`); setLng(`${place.point.lng}`); }}>{place.name}</button>
                <button className="chipDelete" onClick={() => void deletePlace(place.id)}>Delete</button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2>Route Mode</h2>
          <textarea value={routeText} onChange={(event) => setRouteText(event.target.value)} />
          <div className="inline">
            <input value={routeName} onChange={(event) => setRouteName(event.target.value)} />
            <button onClick={() => void saveRoute()}>Save Route</button>
          </div>
          <label>
            Tick ms
            <input type="number" value={tickMs} onChange={(event) => setTickMs(Number(event.target.value))} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={loopRoute} onChange={(event) => setLoopRoute(event.target.checked)} />
            Loop route
          </label>
          <div className="inline">
            <label>
              Speed
              <select value={speedPreset} onChange={(event) => setSpeedPreset(event.target.value as "walk" | "cycle" | "drive" | "custom")}>
                <option value="walk">Walk</option>
                <option value="cycle">Cycle</option>
                <option value="drive">Drive</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {speedPreset === "custom" ? (
              <label>
                m/s
                <input type="number" step="0.1" value={customSpeed} onChange={(event) => setCustomSpeed(Number(event.target.value))} />
              </label>
            ) : null}
            <label className="checkbox">
              <input type="checkbox" checked={jitterEnabled} onChange={(event) => setJitterEnabled(event.target.checked)} />
              Jitter smoothing
            </label>
          </div>
          <div className="actions">
            <button onClick={() => void runRoute()}>Start Route</button>
            <button onClick={() => void executeSimpleCommand("pause")}>Pause</button>
            <button onClick={() => void executeSimpleCommand("resume")}>Resume</button>
            <button onClick={() => void executeSimpleCommand("stop")}>Stop</button>
            <button onClick={() => { setRoutePoints([]); setRouteText(""); }}>Clear Route</button>
          </div>
          <p className="subtle">Route points: {routePoints.length} | Distance: {routeDistanceKm.toFixed(2)} km | Estimated: {estimatedMinutes.toFixed(1)} min</p>
          <ul className="chipList">
            {routePoints.map((point, index) => (
              <li
                key={`${point.lat}-${point.lng}-${index}`}
                className="chipItem"
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIndex == null || dragIndex === index) return;
                  moveRoutePoint(dragIndex, index);
                  setDragIndex(null);
                }}
              >
                <span className="chipSelect">{index + 1}. {point.lat.toFixed(4)}, {point.lng.toFixed(4)}</span>
                <button className="chipDelete" onClick={() => void removeRoutePoint(index)}>Remove</button>
              </li>
            ))}
          </ul>
          <ul className="chipList">
            {presets.routes.map((route) => (
              <li key={route.id} className="chipItem">
                <input className="chipSelect" value={route.name} onChange={(event) => void renameRoute(route.id, event.target.value)} />
                <button className="chipSelect" onClick={() => loadRoute(route.id)}>Load</button>
                <button className="chipDelete" onClick={() => void deleteRoute(route.id)}>Delete</button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card">
        <h2>Diagnostics Timeline</h2>
        <div className="inline">
          <select value={logFilter} onChange={(event) => setLogFilter(event.target.value as typeof logFilter)}>
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
          <button onClick={() => void exportDiagnostics()}>Export Diagnostics Bundle</button>
        </div>
        <div className="timeline">
          {timeline.length === 0 ? <p>No logs yet</p> : timeline.map((item, idx) => (
            <article key={`${item.timestamp}-${idx}`} className={`timelineItem ${item.level}`}>
              <div className="inline">
                <strong>{item.level.toUpperCase()}</strong>
                <span>{new Date(item.timestamp).toLocaleString()}</span>
                <span>{item.source}</span>
              </div>
              <div>{item.message}</div>
              {item.context ? <pre>{JSON.stringify(item.context, null, 2)}</pre> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Permissions by platform</h2>
        <select value={permissionPlatform} onChange={(event) => setPermissionPlatform(event.target.value as "ios" | "android")}>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
        </select>
        {permissionPlatform === "ios" ? (
          <ul>
            <li>Requires Xcode, pymobiledevice3, and tunnel service.</li>
            <li>Device must be trusted and in Developer Mode.</li>
            <li>Simulation applies for testing workflows only.</li>
          </ul>
        ) : (
          <ul>
            <li>Requires adb and USB debugging authorization.</li>
            <li>Emulator geo-fix mode is supported by default.</li>
            <li>Mock-location behavior may differ across device vendors.</li>
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
