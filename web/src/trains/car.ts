/**
 * Geometry of a CTA rapid transit car, and where each car of a train sits.
 *
 * Dimensions follow the 5000-series: 48 ft (14.63 m) long, 9 ft 4 in (2.84 m)
 * wide, trucks about 10.4 m apart. The body has vertical sides and a shallow
 * curved roof, with a dark window band, roof equipment and running gear.
 */

import { BoxGeometry, type BufferGeometry, CylinderGeometry, ExtrudeGeometry, Shape } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CAR_GAP, CAR_LENGTH, CONSIST as LINE_CONSIST, pointAt, type Polyline, trainLength as lineTrainLength } from "@chicago-loop/mock";
import { bearingToYaw, toScene } from "../data/frame.ts";

export const CAR = {
  length: CAR_LENGTH,
  width: 2.84,
  /** Floor of the car body above the top of rail */
  floor: 0.95,
  /** Body height from its floor line to the roof crown */
  body: 2.75,
  /** Gap between coupled cars */
  gap: CAR_GAP,
  /** Distance between truck centers */
  trucks: 10.4,
};

/** Cars per train, shared with the mock. */
export const CONSIST: Record<string, number> = LINE_CONSIST;

export function trainLength(route: string): number {
  return route in LINE_CONSIST ? lineTrainLength(route as keyof typeof LINE_CONSIST) : 6 * CAR.length + 5 * CAR.gap;
}

/**
 * Car geometries in car space: x forward, y up from the top of rail, z to the
 * left. The origin is the car center at rail height.
 */
export function carGeometries(): { body: BufferGeometry; glass: BufferGeometry; gear: BufferGeometry } {
  const w = CAR.width / 2;
  const side = 2.25; // height of the vertical sides above the floor
  const crown = CAR.body;
  const section = new Shape();
  section.moveTo(-w, 0);
  section.lineTo(w, 0);
  section.lineTo(w, side);
  section.quadraticCurveTo(w * 0.9, crown, 0, crown);
  section.quadraticCurveTo(-w * 0.9, crown, -w, side);
  section.lineTo(-w, 0);
  const body = new ExtrudeGeometry(section, {
    depth: CAR.length - 0.5,
    bevelEnabled: true,
    bevelThickness: 0.25,
    bevelSize: 0.06,
    bevelSegments: 2,
    curveSegments: 6,
  });
  // Extruded along +z, centered: rotate so the length runs along x.
  body.translate(0, 0, -(CAR.length - 0.5) / 2);
  body.rotateY(Math.PI / 2);
  body.translate(0, CAR.floor, 0);
  body.computeVertexNormals();

  // Window band on both sides and the end windows, slightly proud of the body.
  const parts: BufferGeometry[] = [];
  const band = new BoxGeometry(CAR.length - 2.2, 0.92, CAR.width + 0.03);
  band.translate(0, CAR.floor + 1.3, 0);
  parts.push(band);
  for (const end of [-1, 1]) {
    const endWin = new BoxGeometry(0.04, 0.85, CAR.width - 0.9);
    endWin.translate(end * (CAR.length / 2 + 0.01), CAR.floor + 1.38, 0);
    parts.push(endWin);
  }
  // Door seams read as thin dark strips on each side: two door pairs per side.
  for (const x of [-3.4, 3.4]) {
    const door = new BoxGeometry(1.3, 1.95, CAR.width + 0.035);
    door.translate(x, CAR.floor + 1.03, 0);
    parts.push(door);
  }
  const glass = mergeGeometries(parts.map((g) => g.toNonIndexed()));

  // Running gear: two trucks with wheels, roof equipment, coupler.
  const gear: BufferGeometry[] = [];
  for (const end of [-1, 1]) {
    const x = (end * CAR.trucks) / 2;
    const frame = new BoxGeometry(2.6, 0.45, CAR.width - 0.6);
    frame.translate(x, 0.55, 0);
    gear.push(frame);
    for (const dx of [-0.95, 0.95]) {
      for (const dz of [-0.72, 0.72]) {
        const wheel = new CylinderGeometry(0.42, 0.42, 0.14, 12);
        wheel.rotateX(Math.PI / 2);
        wheel.translate(x + dx, 0.42, dz);
        gear.push(wheel);
      }
    }
    const coupler = new BoxGeometry(0.5, 0.25, 0.3);
    coupler.translate(end * (CAR.length / 2 + 0.2), 0.75, 0);
    gear.push(coupler);
  }
  const skirt = new BoxGeometry(CAR.length - 6.5, 0.38, CAR.width - 0.5);
  skirt.translate(0, CAR.floor - 0.18, 0);
  gear.push(skirt);
  for (const x of [-3.8, 3.8]) {
    const ac = new BoxGeometry(2.4, 0.32, 1.6);
    ac.translate(x, CAR.floor + CAR.body + 0.1, 0);
    gear.push(ac);
  }
  return {
    body: body.index ? body.toNonIndexed() : body,
    glass,
    gear: mergeGeometries(gear.map((g) => g.toNonIndexed())),
  };
}

export interface CarPose {
  /** Scene position of the car center at rail height */
  position: [number, number, number];
  /** Rotation about the scene's y axis */
  yaw: number;
  /** Local meters of the car center, for clipping */
  local: [number, number];
}

/**
 * Where each car of a train sits when its head is `head` meters along `line`.
 *
 * Like a real car, each body rests on two trucks on the track: the body center
 * is the midpoint between them and it points from the rear truck to the front
 * one. On curves the body cuts the chord, as it should.
 */
export function carPoses(line: Polyline, head: number, cars: number, trackZ: number): CarPose[] {
  const out: CarPose[] = [];
  const clamp = (d: number) => Math.min(Math.max(d, 0), line.length);
  for (let k = 0; k < cars; k++) {
    const center = head - CAR.length / 2 - k * (CAR.length + CAR.gap);
    const f = pointAt(line, clamp(center + CAR.trucks / 2)).point;
    const r = pointAt(line, clamp(center - CAR.trucks / 2)).point;
    const x = (f[0] + r[0]) / 2;
    const y = (f[1] + r[1]) / 2;
    const bearing = ((Math.atan2(f[0] - r[0], f[1] - r[1]) * 180) / Math.PI + 360) % 360;
    out.push({ position: toScene(x, y, trackZ), yaw: bearingToYaw(bearing), local: [x, y] });
  }
  return out;
}
