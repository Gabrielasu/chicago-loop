/** Polyline helpers in local meters. */

import type { XY } from "./types.ts";

export interface Polyline {
  points: XY[];
  /** Cumulative distance at each point */
  cumulative: number[];
  length: number;
}

export function polyline(points: XY[]): Polyline {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
}

/** Index of the segment that contains distance d (binary search). */
export function segmentAt(line: Polyline, d: number): number {
  const c = line.cumulative;
  let lo = 0;
  let hi = c.length - 2;
  if (hi < 0) return 0;
  if (d <= 0) return 0;
  if (d >= line.length) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c[mid]! <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Point at distance d, the fraction along its segment, and the segment index. */
export function pointAt(line: Polyline, d: number): { point: XY; segment: number; t: number } {
  const i = segmentAt(line, d);
  const a = line.points[i]!;
  const b = line.points[i + 1] ?? a;
  const len = line.cumulative[i + 1]! - line.cumulative[i]!;
  const t = len > 0 ? Math.min(Math.max((d - line.cumulative[i]!) / len, 0), 1) : 0;
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], segment: i, t };
}

/** Compass bearing from a to b, degrees in [0, 360). */
export function bearing(a: XY, b: XY): number {
  const deg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Closest point on a polyline to p: distance along it and the offset from it. */
export function project(line: Polyline, p: XY): { distance: number; offset: number; point: XY } {
  let best = { distance: 0, offset: Infinity, point: line.points[0] ?? ([0, 0] as XY) };
  for (let i = 0; i < line.points.length - 1; i++) {
    const a = line.points[i]!;
    const b = line.points[i + 1]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0), 1) : 0;
    const q: XY = [a[0] + dx * t, a[1] + dy * t];
    const off = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (off < best.offset) {
      best = { distance: line.cumulative[i]! + Math.sqrt(len2) * t, offset: off, point: q };
    }
  }
  return best;
}

/**
 * Local meters to and from WGS84 around an origin.
 *
 * The pipeline uses a transverse Mercator centred on the origin. Within a few
 * kilometers a local tangent plane with the WGS84 radii of curvature matches it
 * to a few millimeters, and it needs no projection library in the browser.
 */
export interface LocalFrame {
  toLocal(lat: number, lon: number): XY;
  toLatLon(x: number, y: number): XY;
}

export function localFrame(lat0: number, lon0: number): LocalFrame {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const phi = (lat0 * Math.PI) / 180;
  const s = Math.sin(phi);
  const w = Math.sqrt(1 - e2 * s * s);
  const meridional = (a * (1 - e2)) / (w * w * w);
  const normal = a / w;
  const mPerDegLat = (meridional * Math.PI) / 180;
  const mPerDegLon = (normal * Math.cos(phi) * Math.PI) / 180;
  return {
    toLocal: (lat, lon) => [(lon - lon0) * mPerDegLon, (lat - lat0) * mPerDegLat],
    toLatLon: (x, y) => [lat0 + y / mPerDegLat, lon0 + x / mPerDegLon],
  };
}
