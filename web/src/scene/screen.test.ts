import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { toScreen } from "./screen.ts";

const camera = new PerspectiveCamera(60, 2, 0.1, 1000);
camera.position.set(0, 0, 0);
camera.lookAt(0, 0, -1);
camera.updateMatrixWorld();

describe("toScreen", () => {
  it("puts a point straight ahead in the middle of the screen", () => {
    const s = toScreen(new Vector3(0, 0, -10), camera, 200, 100);
    expect(s.visible).toBe(true);
    expect(s.x).toBeCloseTo(100);
    expect(s.y).toBeCloseTo(50);
  });

  it("reports points behind the camera as not visible", () => {
    expect(toScreen(new Vector3(0.5, 0, 10), camera, 200, 100).visible).toBe(false);
  });

  it("reports points beyond the far plane as not visible", () => {
    expect(toScreen(new Vector3(0, 0, -5000), camera, 200, 100).visible).toBe(false);
  });
});
