import { polyline, type XY } from "@chicago-loop/mock";
import { describe, expect, it } from "vitest";
import { angleBetween, makeSnapPath, snap } from "./snapping.ts";

// Two parallel tracks 4 m apart running north-south, one per direction.
const northbound = makeSnapPath("nb", "brn", polyline([[2, -500], [2, 500]]));
const southbound = makeSnapPath("sb", "brn", polyline([[-2, 500], [-2, -500]]));
// A path that turns a corner: east along y = 0, then north along x = 100.
const corner = makeSnapPath("corner", "g", polyline([[-100, 0], [100, 0], [100, 200]]));

describe("snap", () => {
  it("puts a train on the nearest point of the track", () => {
    const s = snap([corner], [30, 7], null)!;
    expect(s.point).toEqual([30, 0]);
    expect(s.offset).toBeCloseTo(7);
    expect(s.distance).toBeCloseTo(130);
  });

  it("picks the track that runs the way the train is heading", () => {
    // Reported between the tracks, slightly nearer the northbound one, but heading south.
    const p: XY = [0.5, 100];
    expect(snap([northbound, southbound], p, 180)!.pathId).toBe("sb");
    expect(snap([northbound, southbound], p, 2)!.pathId).toBe("nb");
    expect(snap([northbound, southbound], p, null)!.pathId).toBe("nb");
  });

  it("measures distance along the path, around corners", () => {
    const s = snap([corner], [104, 50], 0)!;
    expect(s.point).toEqual([100, 50]);
    expect(s.distance).toBeCloseTo(250);
    expect(s.bearing).toBeCloseTo(0);
  });

  it("falls back to the nearest track when no track matches the heading", () => {
    expect(snap([northbound], [1, 0], 180)!.pathId).toBe("nb");
  });

  it("ignores positions far from every track", () => {
    expect(snap([northbound, southbound], [400, 0], 0)).toBeNull();
  });

  it("prefers continuity with the train's last snap", () => {
    // A point at the corner is equally near both legs; the hint keeps it on its path position.
    const s = snap([corner], [100, 0], null, undefined, { pathId: "corner", distance: 200 })!;
    expect(s.distance).toBeCloseTo(200);
  });

  it("compares bearings across north", () => {
    expect(angleBetween(350, 10)).toBe(20);
    expect(angleBetween(90, 270)).toBe(180);
  });
});
