import { describe, expect, it } from "vitest";
import { approach, closeTo, DAY, lightFor, lightForSun, NIGHT } from "./light.ts";

describe("light", () => {
  it("is plain day under a high sun and night after civil dusk", () => {
    expect(lightForSun(40)).toEqual({ night: 0, golden: 0 });
    expect(lightForSun(-10)).toEqual({ night: 1, golden: 0 });
  });

  it("turns golden as the sun gets low, then blue as it sets", () => {
    const low = lightForSun(6);
    expect(low.golden).toBeGreaterThan(0.6);
    expect(low.night).toBe(0);
    const dusk = lightForSun(-3);
    expect(dusk.night).toBeGreaterThan(0.3);
    expect(dusk.night).toBeLessThan(0.8);
  });

  it("changes smoothly with the sun", () => {
    let prev = lightForSun(30);
    for (let e = 30; e >= -10; e -= 0.25) {
      const l = lightForSun(e);
      expect(Math.abs(l.night - prev.night)).toBeLessThan(0.06);
      expect(Math.abs(l.golden - prev.golden)).toBeLessThan(0.06);
      prev = l;
    }
  });

  it("lets a chosen mode override the sun", () => {
    expect(lightFor("day", -20)).toEqual(DAY);
    expect(lightFor("night", 40)).toEqual(NIGHT);
    expect(lightFor("auto", 40)).toEqual(DAY);
  });

  it("eases toward a new light and arrives", () => {
    let l = DAY;
    for (let i = 0; i < 60 * 3; i++) l = approach(l, NIGHT, 1 / 60);
    expect(closeTo(l, NIGHT, 0.01)).toBe(true);
    const halfway = approach(DAY, NIGHT, 0.3);
    expect(halfway.night).toBeGreaterThan(0.3);
    expect(halfway.night).toBeLessThan(0.7);
  });
});

import { litFloorsAt } from "./windows.ts";

describe("litFloorsAt", () => {
  it("is busiest in the early evening and quietest before dawn", () => {
    expect(litFloorsAt(18)).toBeGreaterThan(litFloorsAt(22));
    expect(litFloorsAt(22)).toBeGreaterThan(litFloorsAt(3));
    expect(litFloorsAt(3)).toBeLessThan(0.15);
  });

  it("wraps around midnight", () => {
    expect(litFloorsAt(24)).toBeCloseTo(litFloorsAt(0));
    expect(litFloorsAt(-1)).toBeCloseTo(litFloorsAt(23));
  });
});
