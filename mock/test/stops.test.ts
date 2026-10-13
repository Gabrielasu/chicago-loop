import { describe, expect, it } from "vitest";
import { DWELL } from "../src/schedule.ts";
import { sim } from "./helpers.ts";

const loopIds = {
  "Washington/Wells": 40730,
  Quincy: 40040,
  "LaSalle/Van Buren": 40160,
  "Harold Washington Library": 40850,
  "Adams/Wabash": 40680,
  "Washington/Wabash": 41700,
  "Clark/Lake": 40380,
};
const LOOP = new Set(Object.values(loopIds));
const loopOrder = (route: string) =>
  sim.trips.find((t) => t.route === route)!.stops.filter((s) => LOOP.has(s.stationId)).map((s) => s.stationId);

describe("trains stop at stations", () => {
  it("stand still for the dwell time at every stop", () => {
    for (const trip of sim.trips) {
      trip.stops.forEach((stop, i) => {
        const arrive = trip.profile.arrivals[i]!;
        const leave = trip.profile.departures[i]!;
        expect(leave - arrive).toBeGreaterThanOrEqual((LOOP.has(stop.stationId) ? DWELL.loop : DWELL.other) - 1e-6);
        const mid = trip.profile.at((arrive + leave) / 2);
        expect(mid.speed).toBe(0);
        expect(mid.dwellingAt).toBe(i);
        expect(Math.abs(mid.distance - stop.distance)).toBeLessThan(5);
      });
    }
  });

  it("pass through State/Lake while it is closed", () => {
    for (const trip of sim.trips) expect(trip.stops.some((s) => s.stationId === 40260)).toBe(false);
  });

  it("go around the Loop the right way", () => {
    const counterclockwise = [40730, 40040, 40160, 40850, 40680, 41700, 40380];
    const clockwise = [40850, 40160, 40040, 40730, 40380, 41700, 40680];
    // Brown: Outer Loop, counterclockwise from Washington/Wells.
    expect(loopOrder("brn")).toEqual(counterclockwise);
    // Orange: Inner Loop, clockwise from Harold Washington Library.
    expect(loopOrder("org")).toEqual(clockwise);
    // Pink and Purple: Inner Loop, clockwise from Clark/Lake.
    const fromClarkLake = [40380, 41700, 40680, 40850, 40160, 40040, 40730];
    expect(loopOrder("pink")).toEqual(fromClarkLake);
    expect(loopOrder("p")).toEqual(fromClarkLake);
  });

  it("dwell longest at Loop stations", () => {
    expect(DWELL.loop).toBeGreaterThan(DWELL.other);
  });
});
