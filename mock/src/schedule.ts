/**
 * Service definitions for the five Loop lines.
 *
 * Paths and stops come from the network data (OpenStreetMap route relations and
 * the CTA stop list). Headways, service hours, speeds, dwell times and run number
 * ranges are not in any open data feed we use; they are estimates patterned on
 * CTA's published weekday timetables and marked as such in docs/cta-api.md.
 */

import type { LoopRoute } from "./types.ts";

/** [start hour, end hour, minutes between trains]. Hours past 24 run after midnight. */
export type Headways = [number, number, number][];

export interface Leg {
  /** Pattern "from" and "to" names as exported from OpenStreetMap */
  from: string;
  to: string;
  /** Train Tracker direction code for this leg */
  trDr: "1" | "5";
  destNm: string;
  /** GTFS stop id of the end of the run */
  destSt: string;
}

export interface Service {
  route: LoopRoute;
  /** Each trip runs these legs in order; Loop lines go out and back around the Loop. */
  trips: Leg[][];
  weekday: Headways;
  /** null: no weekend service */
  weekend: Headways | null;
  /** First run number and how many to cycle through */
  runBase: number;
  runCount: number;
}

// Terminal arrival platforms from the CTA stop list.
const KIMBALL = "30249";
const MIDWAY = "30182";
const CERMAK_54 = "30114";
const LINDEN = "30203";
const HARLEM = "30004";
const ASHLAND_63 = "30057";
const COTTAGE_GROVE = "30139";

export const SERVICES: Record<LoopRoute, Service> = {
  brn: {
    route: "brn",
    trips: [
      [
        { from: "Kimball", to: "Loop", trDr: "5", destNm: "Loop", destSt: KIMBALL },
        { from: "Loop", to: "Kimball", trDr: "1", destNm: "Kimball", destSt: KIMBALL },
      ],
    ],
    weekday: [
      [4, 6, 10],
      [6, 9.5, 4],
      [9.5, 15, 7.5],
      [15, 18.75, 4],
      [18.75, 22, 10],
      [22, 25.5, 15],
    ],
    weekend: [
      [5, 9, 12],
      [9, 21, 8],
      [21, 25.5, 15],
    ],
    runBase: 401,
    runCount: 99,
  },
  g: {
    route: "g",
    trips: [
      [{ from: "Ashland/63rd", to: "Harlem/Lake", trDr: "1", destNm: "Harlem/Lake", destSt: HARLEM }],
      [{ from: "Harlem/Lake", to: "Ashland/63rd", trDr: "5", destNm: "Ashland/63rd", destSt: ASHLAND_63 }],
      [{ from: "Cottage Grove", to: "Harlem/Lake", trDr: "1", destNm: "Harlem/Lake", destSt: HARLEM }],
      [{ from: "Harlem/Lake", to: "Cottage Grove", trDr: "5", destNm: "Cottage Grove", destSt: COTTAGE_GROVE }],
    ],
    // Per branch and direction; trains on the shared trunk come twice as often.
    weekday: [
      [4, 6, 24],
      [6, 9, 14],
      [9, 15, 20],
      [15, 18.5, 14],
      [18.5, 22, 24],
      [22, 25, 30],
    ],
    weekend: [
      [5, 22, 24],
      [22, 25, 30],
    ],
    runBase: 1,
    runCount: 99,
  },
  org: {
    route: "org",
    trips: [
      [
        { from: "Midway", to: "Loop", trDr: "1", destNm: "Loop", destSt: MIDWAY },
        { from: "Loop", to: "Midway", trDr: "5", destNm: "Midway", destSt: MIDWAY },
      ],
    ],
    weekday: [
      [3.5, 6, 10],
      [6, 9, 5],
      [9, 15, 8],
      [15, 18.5, 5],
      [18.5, 22, 10],
      [22, 25, 15],
    ],
    weekend: [
      [4, 9, 12],
      [9, 21, 9],
      [21, 25, 15],
    ],
    runBase: 701,
    runCount: 99,
  },
  p: {
    // Purple Line Express runs to the Loop on weekday rush hours only.
    route: "p",
    trips: [
      [
        { from: "Linden", to: "Loop", trDr: "5", destNm: "Loop", destSt: LINDEN },
        { from: "Loop", to: "Linden", trDr: "1", destNm: "Linden", destSt: LINDEN },
      ],
    ],
    weekday: [
      [5.25, 9.25, 8],
      [14.25, 18.25, 8],
    ],
    weekend: null,
    runBase: 501,
    runCount: 60,
  },
  pink: {
    route: "pink",
    trips: [
      [
        { from: "54th/Cermak", to: "Loop", trDr: "1", destNm: "Loop", destSt: CERMAK_54 },
        { from: "Loop", to: "54th/Cermak", trDr: "5", destNm: "54th/Cermak", destSt: CERMAK_54 },
      ],
    ],
    weekday: [
      [4, 6, 12],
      [6, 9, 7],
      [9, 15, 10],
      [15, 18.5, 7],
      [18.5, 22, 12],
      [22, 25, 15],
    ],
    weekend: [
      [5, 22, 12],
      [22, 25, 15],
    ],
    runBase: 301,
    runCount: 99,
  },
};

/** Green Line runs are numbered 0xx toward Harlem and 6xx toward the south side. */
export function runNumber(service: Service, tripIndex: number, departureIndex: number): string {
  if (service.route === "g") {
    const toHarlem = tripIndex % 2 === 0;
    const base = toHarlem ? 1 : 601;
    const n = base + ((departureIndex * 2 + (tripIndex >> 1) + 37 * tripIndex) % 98);
    return String(n).padStart(3, "0");
  }
  const n = service.runBase + ((departureIndex * 37 + tripIndex * 11) % service.runCount);
  return String(n).padStart(3, "0");
}

// Speeds and dwell times (estimates). CTA trains can reach 55 mph but slow
// zones and close stop spacing keep most running nearer 35 mph; the Loop
// structure is slower, and the curves at the corners and at Tower 18 slower still.
// With these values Kimball to Washington/Wells takes about 33 minutes and
// Midway to Harold Washington Library about 26: believable, not timetable exact.
export const SPEED = {
  open: 15.6, // 35 mph
  loop: 11.2, // 25 mph on the Loop and its approaches
  accel: 0.9, // m/s2, about 2 mph per second
  decel: 1.0,
  lateral: 0.5, // m/s2 in curves: about 9 mph on the tight Loop corners
};

export const DWELL = {
  loop: 30,
  other: 25,
};
