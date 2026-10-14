/**
 * Snap a reported train position to the track.
 *
 * Train Tracker gives a line, a lat/lon and a heading. We place the train on the
 * nearest point of one of that line's directed paths (the route it runs, in the
 * direction it runs), so a southbound Brown train lands on the southbound track,
 * not on the parallel northbound one a few meters away.
 */

import type { Polyline, XY } from "@chicago-loop/mock";

export interface SnapPath {
  id: string;
  route: string;
  line: Polyline;
  /** Compass bearing of each segment */
  bearings: number[];
}

export interface Snap {
  pathId: string;
  distance: number;
  offset: number;
  point: XY;
  bearing: number;
}

export interface SnapOptions {
  /** Ignore paths further than this from the reported position, meters */
  maxOffset: number;
  /** Largest difference between reported heading and track direction, degrees */
  maxAngle: number;
}

export const DEFAULT_SNAP: SnapOptions = { maxOffset: 75, maxAngle: 70 };

export function makeSnapPath(id: string, route: string, line: Polyline): SnapPath {
  const bearings: number[] = [];
  for (let i = 0; i < line.points.length - 1; i++) {
    const a = line.points[i]!;
    const b = line.points[i + 1]!;
    bearings.push(((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360);
  }
  return { id, route, line, bearings };
}

export function angleBetween(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Best snap of p onto the given paths. With a heading, only track running within
 * maxAngle of it counts; if nothing qualifies the heading is ignored. A hint (the
 * train's last snap) breaks ties toward continuity.
 */
export function snap(
  paths: readonly SnapPath[],
  p: XY,
  heading: number | null,
  options: SnapOptions = DEFAULT_SNAP,
  hint?: { pathId: string; distance: number },
): Snap | null {
  let best: (Snap & { score: number }) | null = null;
  let fallback: (Snap & { score: number }) | null = null;
  for (const path of paths) {
    const pts = path.line.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0), 1);
      const q: XY = [a[0] + dx * t, a[1] + dy * t];
      const offset = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (offset > options.maxOffset) continue;
      const distance = path.line.cumulative[i]! + Math.sqrt(len2) * t;
      const bearing = path.bearings[i]!;
      let score = offset;
      if (hint && hint.pathId === path.id) score -= 2 + Math.max(0, 1 - Math.abs(distance - hint.distance) / 500);
      const candidate = { pathId: path.id, distance, offset, point: q, bearing, score };
      if (heading == null || angleBetween(bearing, heading) <= options.maxAngle) {
        if (!best || score < best.score) best = candidate;
      } else if (!fallback || score < fallback.score) {
        fallback = candidate;
      }
    }
  }
  const chosen = best ?? fallback;
  if (!chosen) return null;
  const { score: _score, ...result } = chosen;
  return result;
}
