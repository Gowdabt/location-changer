import type { IDeviceAdapter, LocationCommand } from "./contracts.js";

export class CommandBus {
  constructor(private readonly adapter: IDeviceAdapter) {}

  async dispatch(command: LocationCommand): Promise<void> {
    await this.adapter.execute(command);
  }
}
