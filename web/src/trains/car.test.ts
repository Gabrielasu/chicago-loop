import { polyline } from "@chicago-loop/mock";
import { describe, expect, it } from "vitest";
import { fromScene } from "../data/frame.ts";
import { CAR, carGeometries, carPoses, trainLength } from "./car.ts";

describe("carPoses", () => {
  it("lines cars up behind the head on straight track", () => {
    const line = polyline([[0, 0], [500, 0]]);
    const poses = carPoses(line, 300, 4, 6.4);
    expect(poses).toHaveLength(4);
    poses.forEach((p, k) => {
      const [x, y, z] = fromScene(...p.position);
      expect(x).toBeCloseTo(300 - CAR.length / 2 - k * (CAR.length + CAR.gap));
      expect(y).toBeCloseTo(0);
      expect(z).toBeCloseTo(6.4);
      expect(p.yaw).toBeCloseTo(0); // heading east
    });
  });

  it("rests each body on its two trucks around a corner", () => {
    // East along y = 0, then north along x = 100.
    const line = polyline([[0, 0], [100, 0], [100, 100]]);
    const [car] = carPoses(line, 100 + CAR.length / 2, 1, 0);
    const [x, y] = car!.local;
    // Trucks at 100 - 5.2 (on the east leg) and 100 + 5.2 (on the north leg):
    // the body center sits inside the corner, on the chord between them.
    expect(x).toBeCloseTo(100 - CAR.trucks / 4, 1);
    expect(y).toBeCloseTo(CAR.trucks / 4, 1);
    // Pointing north-east, halfway through the turn.
    expect(car!.yaw).toBeCloseTo(Math.PI / 4, 2);
  });

  it("keeps cars on the path at its start", () => {
    const line = polyline([[0, 0], [50, 0]]);
    for (const p of carPoses(line, 20, 6, 0)) expect(p.local[0]).toBeGreaterThanOrEqual(0);
  });

  it("gives train lengths per line", () => {
    expect(trainLength("brn")).toBeCloseTo(8 * CAR.length + 7 * CAR.gap);
    expect(trainLength("pink")).toBeLessThan(trainLength("org"));
  });

  it("builds car geometry within the car's envelope", () => {
    const { body } = carGeometries();
    body.computeBoundingBox();
    const b = body.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(CAR.length, 1);
    expect(b.max.z - b.min.z).toBeCloseTo(CAR.width + 0.12, 1);
    // The bevel adds a few centimeters at the roof crown.
    expect(b.max.y).toBeGreaterThan(CAR.floor + CAR.body - 0.01);
    expect(b.max.y).toBeLessThan(CAR.floor + CAR.body + 0.1);
  });
});
