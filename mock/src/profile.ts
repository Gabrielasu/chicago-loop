/**
 * Run profiles: how far along its path a train is, t seconds after it departs.
 *
 * Speeds are limited by a per-distance cap and by curvature, trains accelerate
 * and brake at fixed rates, stop at every station on the path and dwell there.
 * Everything is computed once per trip pattern; lookups are a binary search.
 */

import { pointAt, type Polyline, bearing } from "./geo.ts";

export interface ProfileOptions {
  /** Speed cap in m/s at a distance along the path. */
  maxSpeed: (distance: number) => number;
  /** m/s2 */
  accel: number;
  /** m/s2 */
  decel: number;
  /** Lateral acceleration allowed in curves, m/s2 */
  lateral: number;
  /** Sample spacing, meters */
  step?: number;
}

export interface ProfileStop {
  distance: number;
  dwell: number;
}

export interface ProfileState {
  distance: number;
  speed: number;
  /** Index into the stops array when dwelling at a stop */
  dwellingAt: number | null;
}

export interface RunProfile {
  length: number;
  /** Seconds from departure to arrival at the end of the path */
  duration: number;
  /** Arrival time at each stop, seconds after departure */
  arrivals: number[];
  /** Departure time from each stop */
  departures: number[];
  at(time: number): ProfileState;
  /** Seconds after departure when the head reaches a distance (arrival, before any dwell there). */
  timeAt(distance: number): number;
}

export function curvatureLimit(line: Polyline, distance: number, lateral: number, window = 8): number {
  const a = pointAt(line, Math.max(distance - window, 0)).point;
  const b = pointAt(line, distance).point;
  const c = pointAt(line, Math.min(distance + window, line.length)).point;
  if ((a[0] === b[0] && a[1] === b[1]) || (b[0] === c[0] && b[1] === c[1])) return Infinity;
  let turn = Math.abs(bearing(b, c) - bearing(a, b));
  if (turn > 180) turn = 360 - turn;
  const kappa = (turn * Math.PI) / 180 / (2 * window);
  return kappa > 1e-6 ? Math.sqrt(lateral / kappa) : Infinity;
}

export function buildProfile(line: Polyline, stops: ProfileStop[], opts: ProfileOptions): RunProfile {
  const length = line.length;
  const n = Math.max(Math.ceil(length / (opts.step ?? 4)) + 1, 2);
  const ds = length / (n - 1);
  const dist = new Float64Array(n);
  const vlim = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = i * ds;
    dist[i] = d;
    vlim[i] = Math.min(opts.maxSpeed(d), curvatureLimit(line, d, opts.lateral));
  }
  const stopSample = stops.map((s) => Math.min(Math.max(Math.round(s.distance / ds), 0), n - 1));
  for (const k of stopSample) vlim[k] = 0;
  vlim[0] = 0;
  vlim[n - 1] = 0;

  const v = new Float64Array(n);
  for (let i = 1; i < n; i++) v[i] = Math.min(vlim[i]!, Math.sqrt(v[i - 1]! ** 2 + 2 * opts.accel * ds));
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i]!, Math.sqrt(v[i + 1]! ** 2 + 2 * opts.decel * ds));

  const dwellAt = new Float64Array(n);
  const stopAtSample = new Map<number, number>();
  stopSample.forEach((k, idx) => {
    dwellAt[k] = Math.max(dwellAt[k]!, stops[idx]!.dwell);
    if (!stopAtSample.has(k)) stopAtSample.set(k, idx);
  });

  // arrive[i]: time the train reaches sample i; depart[i]: time it leaves it.
  const arrive = new Float64Array(n);
  const depart = new Float64Array(n);
  depart[0] = dwellAt[0]!;
  for (let i = 1; i < n; i++) {
    const avg = (v[i - 1]! + v[i]!) / 2;
    arrive[i] = depart[i - 1]! + ds / Math.max(avg, 0.05);
    depart[i] = arrive[i]! + dwellAt[i]!;
  }

  const arrivals = stopSample.map((k) => arrive[k]!);
  const departures = stopSample.map((k) => depart[k]!);

  function at(time: number): ProfileState {
    if (time <= 0) return { distance: 0, speed: 0, dwellingAt: stopAtSample.get(0) ?? null };
    if (time >= arrive[n - 1]!) return { distance: length, speed: 0, dwellingAt: stopAtSample.get(n - 1) ?? null };
    // last sample whose arrival time is <= time
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arrive[mid]! <= time) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    if (time < depart[i]!) return { distance: dist[i]!, speed: 0, dwellingAt: stopAtSample.get(i) ?? null };
    if (i >= n - 1) return { distance: length, speed: 0, dwellingAt: null };
    const dt = arrive[i + 1]! - depart[i]!;
    const tau = time - depart[i]!;
    const v0 = v[i]!;
    const v1 = v[i + 1]!;
    const acc = dt > 0 ? (v1 - v0) / dt : 0;
    const d = Math.min(v0 * tau + 0.5 * acc * tau * tau, ds);
    return { distance: dist[i]! + d, speed: v0 + acc * tau, dwellingAt: null };
  }

  function timeAt(distance: number): number {
    const i = Math.min(Math.max(Math.floor(distance / ds), 0), n - 1);
    if (i >= n - 1) return arrive[n - 1]!;
    const f = (distance - dist[i]!) / ds;
    return depart[i]! + (arrive[i + 1]! - depart[i]!) * Math.min(Math.max(f, 0), 1);
  }

  return { length, duration: arrive[n - 1]!, arrivals, departures, at, timeAt };
}
