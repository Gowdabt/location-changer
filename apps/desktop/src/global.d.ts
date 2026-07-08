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
      environment: () => Promise<{
        hostPlatform: string;
        autoPlatform: "ios" | "android";
        detected: {
          ios: { connected: boolean; authorized: boolean; ready: boolean; deviceId: string | null };
          android: { connected: boolean; authorized: boolean; ready: boolean; deviceId: string | null };
        };
      }>;
      health: () => Promise<{
        environment: {
          hostPlatform: string;
          autoPlatform: "ios" | "android";
          detected: {
            ios: { connected: boolean; authorized: boolean; ready: boolean; deviceId: string | null };
            android: { connected: boolean; authorized: boolean; ready: boolean; deviceId: string | null };
          };
        };
        checks: {
          ios: Array<{ key: string; ok: boolean; message: string; fixHint?: string }>;
          android: Array<{ key: string; ok: boolean; message: string; fixHint?: string }>;
        };
        services: { tunneld: boolean };
      }>;
      repairAction: (action: string) => Promise<{ ok: boolean; message: string }>;
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
      exportPresets: (payload: unknown) => Promise<{ ok: boolean; path?: string }>;
      importPresets: () => Promise<{ ok: boolean; payload?: unknown }>;
      loadSettings: () => Promise<unknown>;
      saveSettings: (payload: unknown) => Promise<{ ok: boolean }>;
      readLogs: () => Promise<string[]>;
      exportDiagnostics: () => Promise<{ ok: boolean; path?: string }>;
      getRemoteControlStatus: () => Promise<{
        enabled: boolean;
        port: number;
        url: string | null;
        authToken: string;
        urlSchemeEnabled: boolean;
        wifiEnabled: boolean;
      }>;
      setRemoteControlEnabled: (enabled: boolean) => Promise<{ ok: boolean }>;
      setWiFiModeEnabled: (enabled: boolean) => Promise<{ ok: boolean }>;
      generateQRCode: (url: string) => Promise<string>;
      pairWiFiDevice: () => Promise<{ ok: boolean; error?: string }>;
      onEvent: (channel: string, callback: (payload: Record<string, unknown>) => void) => () => void;
    };
  }
}
