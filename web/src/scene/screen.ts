/** Scene points to screen pixels, with an honest "is it in front of the camera" test. */

import { type Camera, Vector3 } from "three";

export interface ScreenPoint {
  x: number;
  y: number;
  /** In front of the camera and within its depth range */
  visible: boolean;
}

const tmp = new Vector3();

export function toScreen(p: Vector3, camera: Camera, width: number, height: number): ScreenPoint {
  // Behind the eye, perspective projection mirrors points back onto the screen; test depth in camera space first.
  tmp.copy(p).applyMatrix4(camera.matrixWorldInverse);
  if (tmp.z >= -0.01) return { x: 0, y: 0, visible: false };
  tmp.copy(p).project(camera);
  return { x: (tmp.x * 0.5 + 0.5) * width, y: (-tmp.y * 0.5 + 0.5) * height, visible: tmp.z < 1 };
}
