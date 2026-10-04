import type { Restaurant } from "../types/restaurant";

/** Squared distance in degrees, longitude scaled for NYC's latitude; fine for "which is closest" */
const distanceSq = (a: Restaurant, b: Restaurant) =>
  (Number(a.latitude) - Number(b.latitude)) ** 2 + ((Number(a.longitude) - Number(b.longitude)) * 0.76) ** 2;

/**
 * `start`, then `steps` more restaurants from `pool`: the closest to the last one, then the
 * closest to that, and so on (each visited once). Used to keep browsing past Remi's picks.
 */
export function nearestTour(start: Restaurant[], pool: Restaurant[], steps: number): Restaurant[] {
  const visited = new Set(start.map((r) => r.slug));
  const remaining = pool.filter((r) => !visited.has(r.slug) && r.latitude != null && r.longitude != null);
  const path = [...start];
  for (let i = 0; i < steps && remaining.length && path.length; i++) {
    const from = path[path.length - 1];
    let best = 0;
    let bestDistance = Infinity;
    remaining.forEach((r, j) => {
      const d = distanceSq(from, r);
      if (d < bestDistance) [best, bestDistance] = [j, d];
    });
    path.push(remaining.splice(best, 1)[0]);
  }
  return path;
}
