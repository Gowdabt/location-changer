import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  SimulationEngine,
  type DeviceStatus,
  type IDeviceAdapter,
  type LocationCommand,
  type SetupCheck,
} from "@location-changer/core";
import { DiagnosticsLogger } from "@location-changer/diagnostics";

const execFileAsync = promisify(execFile);

interface IOSAdapterOptions {
  logger: DiagnosticsLogger;
  tickMs?: number;
}

export class IOSAdapter implements IDeviceAdapter {
  private engine = new SimulationEngine();
  private timer: NodeJS.Timeout | null = null;
  private tickMs: number;

  constructor(private readonly options: IOSAdapterOptions) {
    this.tickMs = options.tickMs ?? 1000;
  }

  async getStatus(): Promise<DeviceStatus> {
    const checks = await this.runSetupChecks();
    const isReady = checks.every((check) => check.ok);
    const deviceId = await this.resolveDeviceId();
    return {
      connected: Boolean(deviceId),
      authorized: Boolean(deviceId),
      ready: isReady && Boolean(deviceId),
      platform: "ios",
      deviceId: deviceId || undefined,
      message: isReady ? "iOS adapter is ready" : "Setup action is required",
    };
  }

  async runSetupChecks(): Promise<SetupCheck[]> {
    const [pythonCheck, xcodeCheck] = await Promise.all([
      this.hasCommand("pymobiledevice3"),
      this.hasCommand("xcrun"),
    ]);
    return [
      {
        key: "xcode-tools",
        ok: xcodeCheck,
        message: "xcode command line tools are required",
        fixHint: "Install Xcode and run: xcode-select --install",
      },
      {
        key: "pymobiledevice3",
        ok: pythonCheck,
        message: "pymobiledevice3 is needed for iOS developer location simulation",
        fixHint: "Install with: pip3 install pymobiledevice3",
      },
    ];
  }

  async execute(command: LocationCommand): Promise<void> {
    switch (command.kind) {
      case "setPoint":
        await this.applyPoint(command.point.lat, command.point.lng);
        return;
      case "startRoute":
        this.engine.configure({ ...command.route, tickMs: command.route.tickMs || this.tickMs });
        this.startTicker();
        return;
      case "pause":
        this.engine.pause();
        return;
      case "resume":
        this.engine.resume();
        return;
      case "stop":
        this.stopTicker();
        this.engine.reset();
        await this.clearSimulation();
        return;
      default:
        throw new Error("Unsupported command");
    }
  }

  private async hasCommand(command: string): Promise<boolean> {
    try {
      await execFileAsync("which", [command]);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveDeviceId(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("pymobiledevice3", ["usbmux", "list"]);
      const line = stdout
        .split("\n")
        .find((item: string) => item.includes("SerialNumber") || item.includes("UDID"));
      if (!line) {
        return null;
      }
      const match = line.match(/[A-Fa-f0-9-]{8,}/);
      return match?.[0] ?? null;
    } catch {
      return null;
    }
  }

  private startTicker(): void {
    this.stopTicker();
    this.timer = setInterval(async () => {
      const tick = this.engine.nextTick();
      if (!tick) {
        return;
      }
      try {
        await this.applyPoint(tick.point.lat, tick.point.lng);
      } catch (error) {
        await this.options.logger.log({
          timestamp: new Date().toISOString(),
          level: "error",
          source: "ios-adapter",
          message: error instanceof Error ? error.message : "Route tick failed",
        });
      }
      if (tick.finished) {
        this.stopTicker();
      }
    }, this.tickMs);
  }

  private stopTicker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async applyPoint(lat: number, lng: number): Promise<void> {
    await execFileAsync("pymobiledevice3", [
      "developer",
      "dvt",
      "simulate-location",
      "set",
      "--lat",
      `${lat}`,
      "--lon",
      `${lng}`,
    ]);
    await this.options.logger.log({
      timestamp: new Date().toISOString(),
      level: "info",
      source: "ios-adapter",
      message: `Applied location ${lat},${lng}`,
    });
  }

  private async clearSimulation(): Promise<void> {
    try {
      await execFileAsync("pymobiledevice3", [
        "developer",
        "dvt",
        "simulate-location",
        "clear",
      ]);
    } catch {
      await this.options.logger.log({
        timestamp: new Date().toISOString(),
        level: "warn",
        source: "ios-adapter",
        message: "Could not clear simulated location",
      });
    }
  }
}
