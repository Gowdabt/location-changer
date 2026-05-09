import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GeoPoint, RouteOptions } from "@location-changer/core";

export interface SavedPlace {
  id: string;
  name: string;
  point: GeoPoint;
}

export interface SavedRoute {
  id: string;
  name: string;
  route: RouteOptions;
}

interface StoreShape {
  places: SavedPlace[];
  routes: SavedRoute[];
}

const EMPTY_STORE: StoreShape = { places: [], routes: [] };

export class PresetStore {
  constructor(private readonly baseDir: string) {}

  private get storePath(): string {
    return path.join(this.baseDir, "presets.json");
  }

  async load(): Promise<StoreShape> {
    await mkdir(this.baseDir, { recursive: true });
    try {
      const raw = await readFile(this.storePath, "utf-8");
      return JSON.parse(raw) as StoreShape;
    } catch {
      await this.save(EMPTY_STORE);
      return EMPTY_STORE;
    }
  }

  async save(next: StoreShape): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.storePath, JSON.stringify(next, null, 2), "utf-8");
  }
}
