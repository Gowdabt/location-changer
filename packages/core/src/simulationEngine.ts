import type { GeoPoint, RouteOptions, SpeedPreset } from "./types.js";

const PRESET_SPEED: Record<Exclude<SpeedPreset, "custom">, number> = {
  walk: 1.4,
  cycle: 5.5,
  drive: 13.9,
};

export interface RouteTick {
  point: GeoPoint;
  finished: boolean;
}

function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const r = 6371000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export class SimulationEngine {
  private queue: GeoPoint[] = [];
  private loop = false;
  private cursor = 0;
  private paused = false;

  configure(route: RouteOptions): void {
    if (route.points.length < 1) {
      throw new Error("Route requires at least one point");
    }
    const speed =
      route.speedPreset === "custom"
        ? (route.speedMetersPerSecond ?? PRESET_SPEED.walk)
        : PRESET_SPEED[route.speedPreset];
    const stepMeters = speed * (route.tickMs / 1000);
    this.queue = this.interpolate(route.points, Math.max(stepMeters, 1));
    this.loop = route.loop;
    this.cursor = 0;
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  reset(): void {
    this.queue = [];
    this.cursor = 0;
    this.loop = false;
    this.paused = false;
  }

  nextTick(): RouteTick | null {
    if (this.paused || this.queue.length === 0) {
      return null;
    }
    const point = this.queue[this.cursor];
    if (!point) {
      return null;
    }
    if (this.cursor === this.queue.length - 1) {
      if (this.loop) {
        this.cursor = 0;
        return { point, finished: false };
      }
      return { point, finished: true };
    }
    this.cursor += 1;
    return { point, finished: false };
  }

  private interpolate(points: GeoPoint[], stepMeters: number): GeoPoint[] {
    const result: GeoPoint[] = [points[0]];
    for (let i = 0; i < points.length - 1; i += 1) {
      const from = points[i];
      const to = points[i + 1];
      const distance = haversineMeters(from, to);
      const segments = Math.max(Math.floor(distance / stepMeters), 1);
      for (let s = 1; s <= segments; s += 1) {
        const ratio = s / segments;
        result.push({
          lat: from.lat + (to.lat - from.lat) * ratio,
          lng: from.lng + (to.lng - from.lng) * ratio,
        });
      }
    }
    return result;
  }
}
