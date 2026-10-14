import { describe, expect, it } from "vitest";
import { localFrame } from "../src/geo.ts";
import { dispatch, MIN_HEADWAY } from "../src/simulator.ts";
import { chicago, network, sim } from "./helpers.ts";

const frame = localFrame(network.origin.lat, network.origin.lon);
const [x0, y0, x1, y1] = network.bounds;
const inModel = (x: number, y: number) => x > x0 && x < x1 && y > y0 && y < y1;
/** Longest consist: 8 cars of 14.63 m with couplers. */
const TRAIN = 8 * 14.63 + 7 * 0.75;

function angle(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

describe("trains keep their distance", () => {
  // Spacing is enforced where it can be seen: inside the model.
  it.each(["2026-10-13", "2026-10-17"])("never puts two trains on the same track within a train length, all day %s", (day) => {
    let pairs = 0;
    const start = chicago("05:00", day).getTime();
    for (let s = 0; s < 20 * 3600; s += 20) {
      const list = sim
        .trains(new Date(start + s * 1000))
        .map((t) => {
          const [x, y] = frame.toLocal(t.lat, t.lon);
          return { t, x, y };
        })
        .filter((p) => inModel(p.x, p.y));
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d > TRAIN + 10 || angle(a.t.heading, b.t.heading) > 25) continue;
          // Offset across a's direction of travel: parallel tracks are about 4 m apart.
          const h = (a.t.heading * Math.PI) / 180;
          const across = Math.abs(dx * Math.cos(h) - dy * Math.sin(h));
          if (across < 2) {
            pairs++;
            throw new Error(
              `${a.t.route} ${a.t.run} and ${b.t.route} ${b.t.run} ${d.toFixed(0)} m apart at ${new Date(start + s * 1000).toISOString()}`,
            );
          }
        }
      }
    }
    expect(pairs).toBe(0);
  }, 60000);

  it("books every platform in the model at least MIN_HEADWAY apart", () => {
    const runs = dispatch(sim.trips, 1, "2026-10-13", false);
    const at = new Map<number, number[]>();
    for (const r of runs) {
      for (const c of r.trip.checkpoints) {
        if (c.id < 0) continue;
        const list = at.get(c.id) ?? [];
        list.push(r.start + c.time);
        at.set(c.id, list);
      }
    }
    expect(at.size).toBeGreaterThan(14);
    for (const times of at.values()) {
      times.sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(MIN_HEADWAY);
    }
  });

  it("never sends a train earlier than its timetable allows", () => {
    for (const r of dispatch(sim.trips, 1, "2026-10-13", false)) expect(r.start).toBeGreaterThan(r.scheduled - 31);
  });
});
