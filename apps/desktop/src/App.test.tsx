import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  TileLayer: () => <div />,
  Marker: () => <div />,
  Polyline: () => <div />,
  useMapEvents: () => ({ setView: () => undefined, getZoom: () => 14 }),
}));

const locationAppMock = {
  setupChecks: vi.fn(async () => [{ key: "xcode-tools", ok: true, message: "ok" }]),
  status: vi.fn(async () => ({ connected: true, authorized: true, ready: true, platform: "ios", message: "ready" })),
  environment: vi.fn(async () => ({
    hostPlatform: "mac",
    autoPlatform: "ios",
    detected: {
      ios: { connected: true, authorized: true, ready: true, deviceId: "abc" },
      android: { connected: false, authorized: false, ready: false, deviceId: null },
    },
  })),
  health: vi.fn(async () => ({
    environment: {
      hostPlatform: "mac",
      autoPlatform: "ios",
      detected: {
        ios: { connected: true, authorized: true, ready: true, deviceId: "abc" },
        android: { connected: false, authorized: false, ready: false, deviceId: null },
      },
    },
    checks: { ios: [], android: [] },
    services: { tunneld: true },
  })),
  repairAction: vi.fn(async () => ({ ok: true, message: "ok" })),
  runCommand: vi.fn(async () => ({ ok: true })),
  loadPresets: vi.fn(async () => ({ places: [], routes: [] })),
  savePresets: vi.fn(async () => ({ ok: true })),
  exportPresets: vi.fn(async () => ({ ok: true, path: "/tmp/a.json" })),
  importPresets: vi.fn(async () => ({ ok: false })),
  loadSettings: vi.fn(async () => ({
    platformMode: "auto",
    mapZoom: 14,
    mapCenter: { lat: 12.9716, lng: 77.5946 },
    lastTeleport: { lat: 12.9716, lng: 77.5946 },
    lastRouteDraft: "12.9716,77.5946",
    theme: "dark",
  })),
  saveSettings: vi.fn(async () => ({ ok: true })),
  readLogs: vi.fn(async () => []),
  exportDiagnostics: vi.fn(async () => ({ ok: true, path: "/tmp/d.json" })),
};

describe("App", () => {
  beforeEach(() => {
    (window as unknown as { locationApp: typeof locationAppMock }).locationApp = locationAppMock;
  });

  it("renders health status and map section", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Location Changer")).toBeInTheDocument());
    expect(screen.getByText("Connection Health")).toBeInTheDocument();
    expect(screen.getByText("Map Picker")).toBeInTheDocument();
  });
});
