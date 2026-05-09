export type SimulationMode = "teleport" | "route" | "joystick";

export type SpeedPreset = "walk" | "cycle" | "drive" | "custom";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface RouteOptions {
  points: GeoPoint[];
  speedPreset: SpeedPreset;
  speedMetersPerSecond?: number;
  loop: boolean;
  tickMs: number;
}

export interface DeviceStatus {
  connected: boolean;
  authorized: boolean;
  ready: boolean;
  deviceId?: string;
  platform: "ios" | "android";
  message?: string;
}

export interface SetupCheck {
  key: string;
  ok: boolean;
  message: string;
  fixHint?: string;
}

export interface DiagnosticEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  context?: Record<string, string | number | boolean>;
}
