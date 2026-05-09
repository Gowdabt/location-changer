import { useEffect, useMemo, useState } from "react";
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
type GeoPoint = { lat: number; lng: number };
type Presets = {
  places: Array<{ id: string; name: string; point: GeoPoint }>;
  routes: Array<{ id: string; name: string; route: { points: GeoPoint[]; tickMs: number; loop: boolean } }>;
};

const initialPresets: Presets = { places: [], routes: [] };

function App() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [checks, setChecks] = useState<SetupCheck[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [presets, setPresets] = useState<Presets>(initialPresets);
  const [name, setName] = useState("Home");
  const [lat, setLat] = useState("12.9716");
  const [lng, setLng] = useState("77.5946");
  const [routeText, setRouteText] = useState("12.9716,77.5946\n12.9722,77.5980");
  const [tickMs, setTickMs] = useState(1000);
  const [loopRoute, setLoopRoute] = useState(true);

  const parsedPoint = useMemo(() => ({ lat: Number(lat), lng: Number(lng) }), [lat, lng]);

  const refresh = async () => {
    const [statusValue, checksValue, logsValue, presetsValue] = await Promise.all([
      window.locationApp.status(),
      window.locationApp.setupChecks(),
      window.locationApp.readLogs(),
      window.locationApp.loadPresets(),
    ]);
    setStatus(statusValue);
    setChecks(checksValue);
    setLogs(logsValue);
    setPresets(presetsValue);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const runTeleport = async () => {
    await window.locationApp.runCommand({ kind: "setPoint", point: parsedPoint });
    await refresh();
  };

  const runRoute = async () => {
    const points = routeText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [latValue, lngValue] = line.split(",").map((item) => Number(item.trim()));
        return { lat: latValue, lng: lngValue };
      });
    await window.locationApp.runCommand({
      kind: "startRoute",
      route: { points, tickMs, loop: loopRoute, speedPreset: "walk" },
    });
    await refresh();
  };

  const savePlace = async () => {
    const next = {
      ...presets,
      places: [...presets.places, { id: crypto.randomUUID(), name, point: parsedPoint }],
    };
    await window.locationApp.savePresets(next);
    setPresets(next);
  };

  return (
    <main className="layout">
      <header className="header">
        <h1>Location Changer (Mac Phase 1 - iOS First)</h1>
        <button onClick={() => void refresh()}>Refresh</button>
      </header>

      <section className="card">
        <h2>Device Status</h2>
        <p>{status?.message ?? "Loading..."}</p>
        <div className="pillRow">
          <span className={`pill ${status?.connected ? "ok" : "bad"}`}>Connected: {String(status?.connected)}</span>
          <span className={`pill ${status?.authorized ? "ok" : "bad"}`}>Authorized: {String(status?.authorized)}</span>
          <span className={`pill ${status?.ready ? "ok" : "bad"}`}>Ready: {String(status?.ready)}</span>
        </div>
        <ul>
          {checks.map((check) => (
            <li key={check.key}>
              <strong>{check.ok ? "OK" : "Fix"}:</strong> {check.message}
              {check.fixHint ? ` (${check.fixHint})` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className="card grid">
        <div>
          <h2>Teleport</h2>
          <label>Latitude<input value={lat} onChange={(e) => setLat(e.target.value)} /></label>
          <label>Longitude<input value={lng} onChange={(e) => setLng(e.target.value)} /></label>
          <button onClick={() => void runTeleport()}>Set Location</button>
          <div className="inline">
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <button onClick={() => void savePlace()}>Save Place</button>
          </div>
          <ul>
            {presets.places.map((place) => (
              <li key={place.id}>
                <button
                  onClick={() => {
                    setLat(`${place.point.lat}`);
                    setLng(`${place.point.lng}`);
                  }}
                >
                  {place.name}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2>Route Mode</h2>
          <textarea value={routeText} onChange={(e) => setRouteText(e.target.value)} />
          <label>Tick ms<input type="number" value={tickMs} onChange={(e) => setTickMs(Number(e.target.value))} /></label>
          <label className="checkbox">
            <input type="checkbox" checked={loopRoute} onChange={(e) => setLoopRoute(e.target.checked)} />
            Loop route
          </label>
          <div className="actions">
            <button onClick={() => void runRoute()}>Start Route</button>
            <button onClick={() => void window.locationApp.runCommand({ kind: "pause" })}>Pause</button>
            <button onClick={() => void window.locationApp.runCommand({ kind: "resume" })}>Resume</button>
            <button onClick={() => void window.locationApp.runCommand({ kind: "stop" })}>Stop</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Diagnostics</h2>
        <pre>{logs.join("\n") || "No logs yet"}</pre>
      </section>
    </main>
  );
}

export default App;
