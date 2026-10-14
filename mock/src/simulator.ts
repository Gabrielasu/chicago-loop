/**
 * The train simulator.
 *
 * Every trip departs its terminal on a timetable built from the headways in
 * schedule.ts, follows the real track path of its line from the network data,
 * and moves by a run profile: accelerate, cruise under the speed and curve
 * limits, brake, dwell at each station. Given the same seed and clock it always
 * returns the same trains.
 */

import { bearing, pointAt, polyline, type Polyline } from "./geo.ts";
import { buildProfile, type RunProfile } from "./profile.ts";
import { hash, unit } from "./random.ts";
import { DWELL, PHASES, SERVICES, SPEED, runNumber, trainLength, type Leg, type Service } from "./schedule.ts";
import { ctaTimestamp, serviceClock } from "./time.ts";
import {
  LOOP_ROUTES,
  type CtaPositionsResponse,
  type CtaRoute,
  type CtaTrain,
  type LoopRoute,
  type Network,
  type NetworkPattern,
  type XY,
} from "./types.ts";

export interface SimulatorOptions {
  /** Changes delays and small timetable variations. Default 1. */
  seed?: number;
}

export interface TripStop {
  name: string;
  stationId: number;
  stopId: number;
  distance: number;
}

/** A place on the path where the train must keep its distance: a platform or an interlocking. */
export interface Checkpoint {
  /** Platform stop id, or a negative id for a junction */
  id: number;
  /** Seconds after departure when the head gets there */
  time: number;
  /** Minimum seconds between trains there */
  headway: number;
  /** Junctions only: the sampled path through the junction, to tell which moves cross or share track. */
  move?: XY[];
  /** Junctions only: for each sample, seconds after departure when the head reaches it and the tail clears it */
  enter?: number[];
  leave?: number[];
}

export interface Trip {
  route: LoopRoute;
  checkpoints: Checkpoint[];
  index: number;
  legs: Leg[];
  /** Distance along the trip where each leg starts */
  legStarts: number[];
  path: Polyline;
  latlon: XY[];
  stops: TripStop[];
  profile: RunProfile;
}

/** A train in service at a moment, before it is formatted as Train Tracker JSON. */
export interface SimTrain {
  route: LoopRoute;
  run: string;
  trip: Trip;
  leg: Leg;
  /** Meters along the trip path */
  distance: number;
  speed: number;
  position: XY;
  lat: number;
  lon: number;
  heading: number;
  dwelling: boolean;
  next: TripStop;
  /** Seconds until arrival at (or departure from, when dwelling) the next stop */
  secondsToNext: number;
  delayed: boolean;
  departure: number;
}

export interface Simulator {
  readonly trips: Trip[];
  trains(date: Date, routes?: readonly string[]): SimTrain[];
  positions(date: Date, routes?: readonly string[]): CtaPositionsResponse;
}

function findPattern(network: Network, route: LoopRoute, leg: Leg): NetworkPattern {
  const p = network.lines[route].patterns.find((x) => x.from === leg.from && x.to === leg.to);
  if (!p) throw new Error(`No ${route} pattern from ${leg.from} to ${leg.to} in the network data`);
  return p;
}

function buildTrip(network: Network, service: Service, legs: Leg[], index: number): Trip {
  const points: XY[] = [];
  const latlon: XY[] = [];
  const stops: TripStop[] = [];
  const legStarts: number[] = [];
  let offset = 0;
  for (const leg of legs) {
    const p = findPattern(network, service.route, leg);
    legStarts.push(offset);
    const skipFirst = points.length > 0;
    for (let i = skipFirst ? 1 : 0; i < p.points.length; i++) {
      points.push(p.points[i]!);
      latlon.push(p.latlon[i]!);
    }
    for (const s of p.stops) {
      if (s.stationId == null || s.stopId == null) continue;
      const d = offset + s.distance;
      const last = stops[stops.length - 1];
      if (last && last.stopId === s.stopId && Math.abs(last.distance - d) < 40) continue;
      stops.push({ name: s.name, stationId: s.stationId, stopId: s.stopId, distance: d });
    }
    offset += polyline(p.points).length;
  }
  const path = polyline(points);
  // The pattern lengths and the joined path agree to within rounding.
  const scale = path.length / offset;
  for (const s of stops) s.distance *= scale;
  for (let i = 0; i < legStarts.length; i++) legStarts[i] = legStarts[i]! * scale;

  const [x0, y0, x1, y1] = network.bounds;
  const margin = 150;
  const loopStations = new Set(network.stations.filter((s) => s.loop).map((s) => s.id));
  const inModel = (d: number) => {
    const [x, y] = pointAt(path, d).point;
    return x > x0 - margin && x < x1 + margin && y > y0 - margin && y < y1 + margin;
  };
  const profile = buildProfile(
    path,
    stops.map((s) => ({ distance: s.distance, dwell: loopStations.has(s.stationId) ? DWELL.loop : DWELL.other })),
    {
      maxSpeed: (d) => (inModel(d) ? SPEED.loop : SPEED.open),
      accel: SPEED.accel,
      decel: SPEED.decel,
      lateral: SPEED.lateral,
    },
  );
  // Spacing is enforced where it can be seen: platforms inside the model.
  const checkpoints: Checkpoint[] = [];
  stops.forEach((st, i) => {
    if (inModel(st.distance)) checkpoints.push({ id: st.stopId, time: profile.arrivals[i]!, headway: MIN_HEADWAY });
  });
  // Interlockings: every pass through a junction, where routes cross and merge.
  network.junctions.forEach((j, n) => {
    const c = j.location;
    let i = 0;
    while (i < path.points.length - 1) {
      const a = path.points[i]!;
      if (Math.hypot(a[0] - c[0], a[1] - c[1]) > JUNCTION_RADIUS * 3) {
        i++;
        continue;
      }
      // Walk the path through this junction, sampling the move every 2 m.
      const enter = path.cumulative[i]!;
      let exit = enter;
      let k = i;
      while (k < path.points.length && Math.hypot(path.points[k]![0] - c[0], path.points[k]![1] - c[1]) <= JUNCTION_RADIUS * 3) {
        exit = path.cumulative[k]!;
        k++;
      }
      const move: XY[] = [];
      const enterT: number[] = [];
      const leaveT: number[] = [];
      const length = trainLength(service.route);
      for (let d = enter; d <= exit; d += 2) {
        const p = pointAt(path, d).point;
        if (Math.hypot(p[0] - c[0], p[1] - c[1]) <= JUNCTION_RADIUS) {
          move.push(p);
          enterT.push(profile.timeAt(d));
          leaveT.push(profile.timeAt(Math.min(d + length, path.length)));
        }
      }
      if (move.length > 1) {
        checkpoints.push({
          id: -(n + 1),
          time: enterT[0]!,
          headway: JUNCTION_BUFFER,
          move,
          enter: enterT,
          leave: leaveT,
        });
      }
      i = Math.max(k, i + 1);
    }
  });
  return { route: service.route, index, legs, legStarts, path, latlon, stops, profile, checkpoints };
}

/** Departure times, in seconds of the service day, for one trip pattern. */
export function departures(service: Service, tripIndex: number, weekend: boolean, phase?: number): number[] {
  const table = weekend ? service.weekend : service.weekday;
  if (!table) return [];
  const out: number[] = [];
  // Phases interleave the lines on the shared Loop track (see PHASES in schedule.ts).
  const offset = phase ?? PHASES[`${service.route}:${tripIndex}`] ?? 0;
  for (const [h0, h1, minutes] of table) {
    for (let t = h0 * 3600 + offset; t < h1 * 3600; t += minutes * 60) out.push(t);
  }
  return out;
}

function headingOf(path: Polyline, distance: number): number {
  const { segment } = pointAt(path, distance);
  const a = path.points[segment]!;
  const b = path.points[segment + 1] ?? a;
  return Math.round(bearing(a, b)) % 360;
}

/** A trip run on a service day, with its actual start after delays and dispatching. */
export interface Dispatched {
  trip: Trip;
  /** Index of the departure in the timetable */
  k: number;
  /** Timetable departure, seconds of the service day */
  scheduled: number;
  /** Actual departure from the terminal */
  start: number;
}

/**
 * Minimum time between two trains at the same platform, seconds: the first
 * train dwells 30 s, needs about 15 s more to clear the platform, and the
 * signals add a margin.
 */
export const MIN_HEADWAY = 60;

/**
 * Seconds between one train clearing a piece of junction track and the next
 * train reaching it: the interlocking has to see the track clear and set the
 * route.
 */
export const JUNCTION_BUFFER = 20;
const JUNCTION_RADIUS = 45;

/**
 * Where two moves through a junction use the same track or cross: pairs of
 * sample indices, the first and last of each stretch they share. Paths within a
 * meter and a half are the same track; parallel tracks are four meters apart.
 */
export function sharedPoints(a: readonly XY[], b: readonly XY[]): [number, number][] {
  const out: [number, number][] = [];
  let run: [number, number] | null = null;
  let last: [number, number] | null = null;
  for (let i = 0; i < a.length; i++) {
    let hit = -1;
    for (let j = 0; j < b.length; j++) {
      const dx = a[i]![0] - b[j]![0];
      const dy = a[i]![1] - b[j]![1];
      if (dx * dx + dy * dy < 2.25) {
        hit = j;
        break;
      }
    }
    if (hit >= 0) {
      if (!run) run = [i, hit];
      last = [i, hit];
    } else if (run && last) {
      out.push(run);
      if (last[0] !== run[0]) out.push(last);
      run = null;
    }
  }
  if (run && last) {
    out.push(run);
    if (last[0] !== run[0]) out.push(last);
  }
  return out;
}

export function movesConflict(a: readonly XY[], b: readonly XY[]): boolean {
  return sharedPoints(a, b).length > 0;
}

/**
 * The day's runs, spaced like block signals would space them.
 *
 * Every run gets its random delay first. Then, in order of departure, each run
 * is held at its terminal until it reaches every platform in the model at least
 * MIN_HEADWAY after any train already dispatched, and finds each junction
 * track clear. Lines that share track (all
 * five on the Loop, Brown and Purple on the North Side, Green and Pink on Lake,
 * Green and Orange south of the Loop) never run into each other, and trains on
 * a shared stretch keep the same speeds and dwells, so spacing at the platforms
 * holds between them too.
 */
export function dispatch(
  trips: readonly Trip[],
  seed: number,
  dayKey: string,
  weekend: boolean,
  phases?: Record<string, number>,
  /** Optional: seconds of holding caused by each checkpoint id, for tuning. */
  blame?: Map<number, number>,
): Dispatched[] {
  const wanted: { trip: Trip; k: number; scheduled: number; t0: number }[] = [];
  for (const trip of trips) {
    const phase = phases?.[`${trip.route}:${trip.index}`];
    departures(SERVICES[trip.route], trip.index, weekend, phase).forEach((scheduled, k) => {
      const key = `${trip.route}:${trip.index}:${dayKey}:${k}`;
      const jitter = (unit(seed, `${key}:jitter`) - 0.5) * 60;
      const u = unit(seed, `${key}:delay`);
      const delay = u < 0.05 ? 240 + unit(seed, `${key}:late`) * 300 : u * 90;
      wanted.push({ trip, k, scheduled, t0: scheduled + jitter + delay });
    });
  }
  // Signals hand out slots in the order trains reach them: sort by arrival at
  // each run's first checkpoint in the model, not by terminal departure.
  const firstIn = (w: { trip: Trip; t0: number }) =>
    w.t0 + (w.trip.checkpoints.length ? Math.min(...w.trip.checkpoints.map((c) => c.time)) : 0);
  wanted.sort((a, b) => firstIn(a) - firstIn(b));

  // Bookings at each checkpoint, kept sorted by time: the trip start and the checkpoint used.
  interface Booking {
    t: number;
    start: number;
    cp: Checkpoint;
  }
  const booked = new Map<number, Booking[]>();
  const shared = new Map<Checkpoint, Map<Checkpoint, [number, number][]>>();
  const pairs = (a: Checkpoint, b: Checkpoint): [number, number][] => {
    let row = shared.get(a);
    if (!row) shared.set(a, (row = new Map()));
    let v = row.get(b);
    if (!v) row.set(b, (v = sharedPoints(a.move!, b.move!)));
    return v;
  };
  /** The hold needed to clear this checkpoint at trip start `start`, or null if it is clear. */
  const conflict = (c: Checkpoint, start: number): number | null => {
    const list = booked.get(c.id);
    if (!list) return null;
    const t = start + c.time;
    const window = c.move ? 600 : c.headway;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.t <= t - window) lo = mid + 1;
      else hi = mid;
    }
    let need: number | null = null;
    for (let i = lo; i < list.length && list[i]!.t < t + window; i++) {
      const b = list[i]!;
      if (!c.move) {
        need = Math.max(need ?? 0, b.t + c.headway - t);
        continue;
      }
      for (const [ia, ib] of pairs(c, b.cp)) {
        const aIn = start + c.enter![ia]!;
        const aOut = start + c.leave![ia]!;
        const bIn = b.start + b.cp.enter![ib]!;
        const bOut = b.start + b.cp.leave![ib]!;
        if (aIn < bOut + JUNCTION_BUFFER && bIn < aOut + JUNCTION_BUFFER) {
          need = Math.max(need ?? 0, bOut + JUNCTION_BUFFER - aIn);
        }
      }
    }
    return need;
  };

  const out: Dispatched[] = [];
  for (const w of wanted) {
    const { trip } = w;
    let hold = 0;
    for (let guard = 0; guard < 400; guard++) {
      let moved = false;
      for (const c of trip.checkpoints) {
        const need = conflict(c, w.t0 + hold);
        if (need !== null && need > 0) {
          hold += need + 0.5;
          blame?.set(c.id, (blame.get(c.id) ?? 0) + need + 0.5);
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    const start = w.t0 + hold;
    for (const c of trip.checkpoints) {
      const t = start + c.time;
      const list = booked.get(c.id) ?? [];
      let j = list.length;
      while (j > 0 && list[j - 1]!.t > t) j--;
      list.splice(j, 0, { t, start, cp: c });
      booked.set(c.id, list);
    }
    out.push({ trip, k: w.k, scheduled: w.scheduled, start });
  }
  return out;
}

export function createSimulator(network: Network, options: SimulatorOptions = {}): Simulator {
  const seed = options.seed ?? 1;
  const trips: Trip[] = [];
  for (const route of LOOP_ROUTES) {
    const service = SERVICES[route];
    service.trips.forEach((legs, i) => trips.push(buildTrip(network, service, legs, i)));
  }
  const stationNames = new Map(network.stations.map((s) => [s.id, s.name]));

  const days = new Map<string, Dispatched[]>();
  function day(dayKey: string, weekend: boolean): Dispatched[] {
    let list = days.get(dayKey);
    if (!list) {
      list = dispatch(trips, seed, dayKey, weekend);
      days.set(dayKey, list);
      // Keep a few days; tests and scrubbing jump around.
      if (days.size > 4) days.delete(days.keys().next().value!);
    }
    return list;
  }

  function trains(date: Date, routes: readonly string[] = LOOP_ROUTES): SimTrain[] {
    const wanted = new Set(routes.map((r) => r.toLowerCase()));
    const clock = serviceClock(date);
    const out: SimTrain[] = [];
    for (const run of day(clock.dayKey, clock.weekend)) {
      const trip = run.trip;
      if (!wanted.has(trip.route)) continue;
      const elapsed = clock.seconds - run.start;
      if (elapsed < 0 || elapsed > trip.profile.duration) continue;
      const state = trip.profile.at(elapsed);
      const { point, segment, t } = pointAt(trip.path, state.distance);
      const la = trip.latlon[segment]!;
      const lb = trip.latlon[segment + 1] ?? la;
      const lat = la[0] + (lb[0] - la[0]) * t;
      const lon = la[1] + (lb[1] - la[1]) * t;

      let legIndex = 0;
      for (let i = 0; i < trip.legStarts.length; i++) {
        if (state.distance > trip.legStarts[i]! + 1) legIndex = i;
      }
      const dwelling = state.dwellingAt != null;
      let nextIndex = dwelling ? state.dwellingAt! : trip.stops.findIndex((s) => s.distance > state.distance + 0.5);
      if (nextIndex < 0) nextIndex = trip.stops.length - 1;
      const next = trip.stops[nextIndex]!;
      const target = dwelling ? elapsed : trip.profile.arrivals[nextIndex]!;
      out.push({
        route: trip.route,
        run: runNumber(SERVICES[trip.route], trip.index, run.k),
        trip,
        leg: trip.legs[legIndex]!,
        distance: state.distance,
        speed: state.speed,
        position: point,
        lat,
        lon,
        heading: headingOf(trip.path, state.distance),
        dwelling,
        next: { ...next, name: stationNames.get(next.stationId) ?? next.name },
        secondsToNext: Math.max(target - elapsed, 0),
        delayed: run.start - run.scheduled >= 240,
        departure: run.scheduled,
      });
    }
    return out;
  }

  function toCta(train: SimTrain, now: Date): CtaTrain {
    const prdtLag = hash(`${train.route}${train.run}${Math.floor(now.getTime() / 60000)}`) % 25;
    return {
      rn: train.run,
      destSt: train.leg.destSt,
      destNm: train.leg.destNm,
      trDr: train.leg.trDr,
      nextStaId: String(train.next.stationId),
      nextStpId: String(train.next.stopId),
      nextStaNm: train.next.name,
      prdt: ctaTimestamp(new Date(now.getTime() - prdtLag * 1000)),
      arrT: ctaTimestamp(new Date(now.getTime() + Math.round(train.secondsToNext) * 1000)),
      isApp: train.secondsToNext <= 60 ? "1" : "0",
      isDly: train.delayed ? "1" : "0",
      flags: null,
      lat: train.lat.toFixed(5),
      lon: train.lon.toFixed(5),
      heading: String(train.heading),
    };
  }

  function positions(date: Date, routes: readonly string[] = LOOP_ROUTES): CtaPositionsResponse {
    const list = trains(date, routes);
    const route: CtaRoute[] = routes.map((r) => {
      const name = r.toLowerCase();
      const ts = list
        .filter((x) => x.route === name)
        .sort((a, b) => Number(a.run) - Number(b.run))
        .map((x) => toCta(x, date));
      return ts.length ? { "@name": name, train: ts } : { "@name": name };
    });
    return { ctatt: { tmst: ctaTimestamp(date), errCd: "0", errNm: null, route } };
  }

  return { trips, trains, positions };
}
