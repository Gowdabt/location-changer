import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
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

const initialPresets: Presets = { places: [], routes: [] };
const DEFAULT_POINT: GeoPoint = { lat: 12.9716, lng: 77.5946 };

function MapClickSync({
  point,
  onPick,
}: {
  point: GeoPoint;
  onPick: (point: GeoPoint) => void;
}) {
  const map = useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
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

  const parsedPoint = useMemo(() => {
    const next = { lat: Number(lat), lng: Number(lng) };
    if (Number.isNaN(next.lat) || Number.isNaN(next.lng)) {
      return DEFAULT_POINT;
    }
    return next;
  }, [lat, lng]);

  const refresh = async () => {
    const env = await window.locationApp.environment();
    const targetPlatform = platformMode === "auto" ? env.autoPlatform : platformMode;
    const [statusValue, checksValue, logsValue, presetsValue] = await Promise.all([
      window.locationApp.status(targetPlatform),
      window.locationApp.setupChecks(targetPlatform),
      window.locationApp.readLogs(),
      window.locationApp.loadPresets(),
    ]);
    setEnvironment(env);
    setActivePlatform(targetPlatform);
    setStatus(statusValue);
    setChecks(checksValue);
    setLogs(logsValue);
    setPresets(presetsValue);
  };

  useEffect(() => {
    void refresh();
  }, [platformMode]);

  const runTeleport = async () => {
    await window.locationApp.runCommand({ platform: activePlatform, kind: "setPoint", point: parsedPoint });
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
      platform: activePlatform,
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

  const deletePlace = async (id: string) => {
    const next = {
      ...presets,
      places: presets.places.filter((place) => place.id !== id),
    };
    await window.locationApp.savePresets(next);
    setPresets(next);
  };

  const selectMapPoint = (point: GeoPoint) => {
    setLat(point.lat.toFixed(6));
    setLng(point.lng.toFixed(6));
  };

  return (
    <main className="layout">
      <header className="header">
        <div>
          <h1>Location Changer</h1>
          <p className="subtle">Visual location simulator for iOS and Android testing</p>
        </div>
        <div className="inline">
          <select
            value={platformMode}
            onChange={(e) => setPlatformMode(e.target.value as "auto" | "ios" | "android")}
          >
            <option value="auto">Auto Detect Device</option>
            <option value="ios">iOS / iPadOS</option>
            <option value="android">Android</option>
          </select>
          <button onClick={() => void refresh()}>Refresh</button>
        </div>
      </header>

      <section className="card">
        <h2>Device Status</h2>
        <p>
          Host: <strong>{environment?.hostPlatform ?? "unknown"}</strong> | Active platform:{" "}
          <strong>{activePlatform}</strong>
        </p>
        <p>
          Detected iOS: {String(environment?.detected.ios.connected ?? false)} | Detected Android:{" "}
          {String(environment?.detected.android.connected ?? false)}
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

      <section className="card mapCard">
        <div className="mapHeader">
          <h2>Map Picker</h2>
          <span>Click map to set Latitude/Longitude</span>
        </div>
        <div className="mapWrap">
          <MapContainer center={[parsedPoint.lat, parsedPoint.lng]} zoom={14} scrollWheelZoom className="map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[parsedPoint.lat, parsedPoint.lng]} />
            <MapClickSync point={parsedPoint} onPick={selectMapPoint} />
          </MapContainer>
        </div>
      </section>

      <section className="card grid twoCol">
        <div>
          <h2>Teleport</h2>
          <label>
            Latitude
            <input value={lat} onChange={(e) => setLat(e.target.value)} />
          </label>
          <label>
            Longitude
            <input value={lng} onChange={(e) => setLng(e.target.value)} />
          </label>
          <button onClick={() => void runTeleport()}>Set Location</button>
          <div className="inline">
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <button onClick={() => void savePlace()}>Save Place</button>
          </div>
          <ul className="chipList">
            {presets.places.map((place) => (
              <li key={place.id} className="chipItem">
                <button
                  className="chipSelect"
                  onClick={() => {
                    setLat(`${place.point.lat}`);
                    setLng(`${place.point.lng}`);
                  }}
                >
                  {place.name}
                </button>
                <button className="chipDelete" onClick={() => void deletePlace(place.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2>Route Mode</h2>
          <textarea value={routeText} onChange={(e) => setRouteText(e.target.value)} />
          <label>
            Tick ms
            <input type="number" value={tickMs} onChange={(e) => setTickMs(Number(e.target.value))} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={loopRoute} onChange={(e) => setLoopRoute(e.target.checked)} />
            Loop route
          </label>
          <div className="actions">
            <button onClick={() => void runRoute()}>Start Route</button>
            <button
              onClick={() =>
                void window.locationApp.runCommand({ platform: activePlatform, kind: "pause" })
              }
            >
              Pause
            </button>
            <button
              onClick={() =>
                void window.locationApp.runCommand({ platform: activePlatform, kind: "resume" })
              }
            >
              Resume
            </button>
            <button
              onClick={() =>
                void window.locationApp.runCommand({ platform: activePlatform, kind: "stop" })
              }
            >
              Stop
            </button>
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
