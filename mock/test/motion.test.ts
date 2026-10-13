import { describe, expect, it } from "vitest";
import { SPEED } from "../src/schedule.ts";
import { chicago, sim } from "./helpers.ts";

describe("trains advance over time", () => {
  it("never move backwards and keep moving", () => {
    const start = chicago("08:00").getTime();
    const seen = new Map<string, number[]>();
    for (let s = 0; s <= 30 * 60; s += 10) {
      for (const t of sim.trains(new Date(start + s * 1000))) {
        const key = `${t.route}:${t.trip.index}:${t.departure}`;
        (seen.get(key) ?? seen.set(key, []).get(key)!).push(t.distance);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
    for (const distances of seen.values()) {
      for (let i = 1; i < distances.length; i++) expect(distances[i]!).toBeGreaterThanOrEqual(distances[i - 1]!);
      if (distances.length > 30) expect(distances[distances.length - 1]! - distances[0]!).toBeGreaterThan(1000);
    }
  });

  it("stay under the speed caps", () => {
    for (const t of sim.trains(chicago("17:30"))) expect(t.speed).toBeLessThanOrEqual(SPEED.open + 0.01);
  });

  it("are deterministic for a seed and differ between seeds", async () => {
    const { createSimulator } = await import("../src/simulator.ts");
    const { network } = await import("./helpers.ts");
    const now = chicago("12:30");
    const a = JSON.stringify(sim.positions(now));
    const b = JSON.stringify(createSimulator(network, { seed: 1 }).positions(now));
    const c = JSON.stringify(createSimulator(network, { seed: 2 }).positions(now));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("timetable", () => {
  const count = (time: Date, route: string) => sim.trains(time, [route]).length;

  it("runs more trains in the rush than late at night", () => {
    expect(count(chicago("08:15"), "brn")).toBeGreaterThan(count(chicago("23:30"), "brn"));
  });

  it("runs the Purple Line Express on weekday rush hours only", () => {
    expect(count(chicago("08:15"), "p")).toBeGreaterThan(0);
    expect(count(chicago("12:30"), "p")).toBe(0);
    expect(count(chicago("08:15", "2026-10-17"), "p")).toBe(0);
  });

  it("keeps late night trains on the previous service day", () => {
    expect(count(chicago("00:45", "2026-10-14"), "brn")).toBeGreaterThan(0);
    expect(count(chicago("03:30", "2026-10-14"), "brn")).toBe(0);
  });
});
