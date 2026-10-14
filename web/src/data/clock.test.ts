import { describe, expect, it } from "vitest";
import { pollIntervalFor, SimClock } from "./clock.ts";

describe("SimClock", () => {
  it("runs from its start at the chosen speed and keeps time when the speed changes", () => {
    let real = 1000;
    const clock = new SimClock(50_000, 1, () => real);
    real += 2000;
    expect(clock.now().getTime()).toBe(52_000);
    clock.setSpeed(10);
    expect(clock.now().getTime()).toBe(52_000);
    real += 1000;
    expect(clock.now().getTime()).toBe(62_000);
  });

  it("polls faster when the clock runs faster", () => {
    expect(pollIntervalFor(1)).toBe(5000);
    expect(pollIntervalFor(10)).toBe(500);
    expect(pollIntervalFor(60)).toBe(250);
  });
});
