import { describe, expect, it } from "vitest";
import { BACKWARD_TOLERANCE, TrackHistory } from "./easing.ts";

describe("TrackHistory", () => {
  it("interpolates along the track between updates", () => {
    const h = new TrackHistory();
    h.push({ time: 0, pathId: "a", distance: 100 });
    h.push({ time: 10000, pathId: "a", distance: 200 });
    expect(h.at(5000)).toEqual({ pathId: "a", distance: 150, speed: 10 });
    expect(h.at(2500)!.distance).toBe(125);
  });

  it("holds at the ends instead of guessing", () => {
    const h = new TrackHistory();
    h.push({ time: 1000, pathId: "a", distance: 100 });
    h.push({ time: 2000, pathId: "a", distance: 110 });
    expect(h.at(0)!.distance).toBe(100);
    expect(h.at(9000)).toEqual({ pathId: "a", distance: 110, speed: 0 });
  });

  it("never moves a train backwards on small jitter", () => {
    const h = new TrackHistory();
    h.push({ time: 0, pathId: "a", distance: 500 });
    h.push({ time: 5000, pathId: "a", distance: 500 - BACKWARD_TOLERANCE / 2 });
    expect(h.at(2500)!.distance).toBe(500);
    expect(h.latest!.distance).toBe(500);
  });

  it("jumps rather than glides after a big gap or a path change", () => {
    const h = new TrackHistory();
    h.push({ time: 0, pathId: "a", distance: 100 });
    h.push({ time: 5000, pathId: "a", distance: 5000 });
    expect(h.at(2500)!.distance).toBe(5000);
    h.push({ time: 6000, pathId: "b", distance: 20 });
    expect(h.at(5500)).toEqual({ pathId: "b", distance: 20, speed: 0 });
  });

  it("ignores stale updates and keeps a short history", () => {
    const h = new TrackHistory(3);
    for (let i = 0; i < 6; i++) h.push({ time: i * 1000, pathId: "a", distance: i * 10 });
    h.push({ time: 2000, pathId: "a", distance: 999 });
    expect(h.latest!.distance).toBe(50);
    expect(h.at(0)!.distance).toBe(30);
  });

  it("is smooth: no step larger than the speed allows", () => {
    const h = new TrackHistory();
    h.push({ time: 0, pathId: "a", distance: 0 });
    h.push({ time: 5000, pathId: "a", distance: 50 });
    h.push({ time: 10000, pathId: "a", distance: 110 });
    let prev = 0;
    for (let t = 0; t <= 10000; t += 100) {
      const d = h.at(t)!.distance;
      expect(d - prev).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});
