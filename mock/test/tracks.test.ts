import { describe, expect, it } from "vitest";
import { localFrame, polyline, project } from "../src/geo.ts";
import { chicago, network, sim } from "./helpers.ts";

const frame = localFrame(network.origin.lat, network.origin.lon);
const tracks = network.tracks.map((t) => ({ ...t, line: polyline(t.points) }));
const [x0, y0, x1, y1] = network.bounds;
const inModel = ([x, y]: [number, number]) => x > x0 + 20 && x < x1 - 20 && y > y0 + 20 && y < y1 - 20;

describe("trains stay on their tracks", () => {
  const times = ["06:40", "08:15", "12:30", "17:20", "23:10"].map((t) => chicago(t));

  it("reported lat/lon lies on the trip path", () => {
    // The browser converts lat/lon with a local tangent plane; it matches the
    // pipeline's projection to centimeters in the model and drifts slowly far out.
    for (const time of times) {
      for (const train of sim.trains(time)) {
        const p = frame.toLocal(train.lat, train.lon);
        const r = Math.hypot(p[0], p[1]);
        const limit = r < 3000 ? 0.5 : r * 0.004;
        expect(project(train.trip.path, p).offset).toBeLessThan(limit);
      }
    }
  });

  it("inside the model, every train sits on a mapped track that its line uses", () => {
    let checked = 0;
    for (const time of times) {
      for (const train of sim.trains(time)) {
        const p = frame.toLocal(train.lat, train.lon);
        if (!inModel(p)) continue;
        const own = tracks.filter((t) => t.lines.includes(train.route));
        const best = Math.min(...own.map((t) => project(t.line, p).offset));
        expect(best).toBeLessThan(1.5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("joins the two legs of a Loop trip without a gap", () => {
    for (const code of ["brn", "org", "p", "pink"] as const) {
      const [a, b] = network.lines[code].patterns.slice().sort((x, y) => (x.to === "Loop" ? -1 : y.to === "Loop" ? 1 : 0));
      const end = a!.points[a!.points.length - 1]!;
      const start = b!.points[0]!;
      expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeLessThan(1);
    }
  });
});
