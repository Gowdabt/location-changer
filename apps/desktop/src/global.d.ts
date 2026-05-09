export {};

declare global {
  interface Window {
    locationApp: {
      setupChecks: (platform?: "ios" | "android") => Promise<
        Array<{ key: string; ok: boolean; message: string; fixHint?: string }>
      >;
      status: (platform?: "ios" | "android") => Promise<{
        connected: boolean;
        authorized: boolean;
        ready: boolean;
        platform: "ios" | "android";
        deviceId?: string;
        message?: string;
      }>;
      runCommand: (command: Record<string, unknown> & { platform?: "ios" | "android" }) => Promise<{ ok: boolean }>;
      loadPresets: () => Promise<{
        places: Array<{ id: string; name: string; point: { lat: number; lng: number } }>;
        routes: Array<{
          id: string;
          name: string;
          route: { points: Array<{ lat: number; lng: number }>; tickMs: number; loop: boolean };
        }>;
      }>;
      savePresets: (payload: unknown) => Promise<{ ok: boolean }>;
      readLogs: () => Promise<string[]>;
    };
  }
}
