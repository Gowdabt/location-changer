import type { GeoPoint, RouteOptions } from "./types.js";

export type LocationCommand =
  | { kind: "setPoint"; point: GeoPoint }
  | { kind: "startRoute"; route: RouteOptions }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "stop" };

export interface IDeviceAdapter {
  getStatus: () => Promise<{
    connected: boolean;
    authorized: boolean;
    ready: boolean;
    platform: "ios" | "android";
    deviceId?: string;
    message?: string;
  }>;
  runSetupChecks: () => Promise<
    Array<{ key: string; ok: boolean; message: string; fixHint?: string }>
  >;
  execute: (command: LocationCommand) => Promise<void>;
}
