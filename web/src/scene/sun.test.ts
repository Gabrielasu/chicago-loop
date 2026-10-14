import { describe, expect, it } from "vitest";
import { isNight, sunPosition } from "./sun.ts";

const LOOP = [41.882, -87.628] as const;
const at = (iso: string) => sunPosition(new Date(iso), ...LOOP);

describe("sunPosition", () => {
  // Reference values from the NOAA solar calculator for Chicago.
  it("is due south and about 40 degrees up at solar noon in mid October", () => {
    const s = at("2026-10-13T12:39:00-05:00");
    expect(s.azimuth).toBeGreaterThan(176);
    expect(s.azimuth).toBeLessThan(184);
    expect(s.elevation).toBeGreaterThan(38);
    expect(s.elevation).toBeLessThan(41);
  });

  it("is near the horizon in the west-south-west at sunset", () => {
    const s = at("2026-10-13T18:12:00-05:00");
    expect(Math.abs(s.elevation)).toBeLessThan(1.5);
    expect(s.azimuth).toBeGreaterThan(250);
    expect(s.azimuth).toBeLessThan(262);
  });

  it("is high in the summer and low in the winter", () => {
    expect(at("2026-06-21T13:00:00-05:00").elevation).toBeGreaterThan(70);
    expect(at("2026-12-21T12:00:00-06:00").elevation).toBeLessThan(26);
  });

  it("knows night from day", () => {
    expect(isNight(at("2026-10-13T22:00:00-05:00"))).toBe(true);
    expect(isNight(at("2026-10-13T08:15:00-05:00"))).toBe(false);
  });
});
