/**
 * Coordinates.
 *
 * Local: meters from State & Madison, x east, y north, z up (the pipeline and Blender).
 * Scene: three.js and glTF are y-up, so local (x, y, z) is scene (x, z, -y).
 */

import { localFrame, type LocalFrame } from "@chicago-loop/mock";
import { network } from "@chicago-loop/mock/network";

export type Vec3 = [number, number, number];

export function toScene(x: number, y: number, z = 0): Vec3 {
  return [x, z, -y];
}

export function fromScene(sx: number, sy: number, sz: number): Vec3 {
  return [sx, -sz, sy];
}

export const frame: LocalFrame = localFrame(network.origin.lat, network.origin.lon);

/** Compass bearing (0 north, 90 east) to a rotation about the scene's y axis. */
export function bearingToYaw(bearing: number): number {
  return -((bearing - 90) * Math.PI) / 180;
}
