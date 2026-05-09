import type { DeviceStatus, IDeviceAdapter, LocationCommand, SetupCheck } from "@location-changer/core";

export class AndroidAdapterPlaceholder implements IDeviceAdapter {
  async getStatus(): Promise<DeviceStatus> {
    return {
      connected: false,
      authorized: false,
      ready: false,
      platform: "android",
      message: "Android adapter will be enabled after iOS sign-off",
    };
  }

  async runSetupChecks(): Promise<SetupCheck[]> {
    return [
      {
        key: "android-disabled",
        ok: false,
        message: "Android adapter is not yet active in this phase",
        fixHint: "Complete iOS validation gates and then enable Android adapter workstream.",
      },
    ];
  }

  async execute(_command: LocationCommand): Promise<void> {
    throw new Error("Android adapter is a phase-1 placeholder");
  }
}
