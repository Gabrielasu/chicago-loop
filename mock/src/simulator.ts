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
import { DWELL, SERVICES, SPEED, runNumber, type Leg, type Service } from "./schedule.ts";
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

export interface Trip {
  route: LoopRoute;
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
  return { route: service.route, index, legs, legStarts, path, latlon, stops, profile };
}

/** Departure times, in seconds of the service day, for one trip pattern. */
export function departures(service: Service, tripIndex: number, weekend: boolean): number[] {
  const table = weekend ? service.weekend : service.weekday;
  if (!table) return [];
  const out: number[] = [];
  // Green branches share the trunk: offset the second branch by half a headway.
  const stagger = service.route === "g" ? (tripIndex >> 1) * 0.5 : 0;
  for (const [h0, h1, minutes] of table) {
    for (let t = h0 * 3600 + stagger * minutes * 60; t < h1 * 3600; t += minutes * 60) out.push(t);
  }
  return out;
}

function headingOf(path: Polyline, distance: number): number {
  const { segment } = pointAt(path, distance);
  const a = path.points[segment]!;
  const b = path.points[segment + 1] ?? a;
  return Math.round(bearing(a, b)) % 360;
}

export function createSimulator(network: Network, options: SimulatorOptions = {}): Simulator {
  const seed = options.seed ?? 1;
  const trips: Trip[] = [];
  for (const route of LOOP_ROUTES) {
    const service = SERVICES[route];
    service.trips.forEach((legs, i) => trips.push(buildTrip(network, service, legs, i)));
  }
  const stationNames = new Map(network.stations.map((s) => [s.id, s.name]));

  function trains(date: Date, routes: readonly string[] = LOOP_ROUTES): SimTrain[] {
    const wanted = new Set(routes.map((r) => r.toLowerCase()));
    const clock = serviceClock(date);
    const out: SimTrain[] = [];
    for (const trip of trips) {
      if (!wanted.has(trip.route)) continue;
      const service = SERVICES[trip.route];
      const deps = departures(service, trip.index, clock.weekend);
      deps.forEach((scheduled, k) => {
        const key = `${trip.route}:${trip.index}:${clock.dayKey}:${k}`;
        const jitter = (unit(seed, `${key}:jitter`) - 0.5) * 60;
        const u = unit(seed, `${key}:delay`);
        const delay = u < 0.05 ? 240 + unit(seed, `${key}:late`) * 300 : u * 90;
        const elapsed = clock.seconds - (scheduled + jitter + delay);
        if (elapsed < 0 || elapsed > trip.profile.duration) return;
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
        let nextIndex = dwelling
          ? state.dwellingAt!
          : trip.stops.findIndex((s) => s.distance > state.distance + 0.5);
        if (nextIndex < 0) nextIndex = trip.stops.length - 1;
        const next = trip.stops[nextIndex]!;
        const target = dwelling ? elapsed : trip.profile.arrivals[nextIndex]!;
        out.push({
          route: trip.route,
          run: runNumber(service, trip.index, k),
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
          delayed: delay >= 240,
          departure: scheduled,
        });
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
