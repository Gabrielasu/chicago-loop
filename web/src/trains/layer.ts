/**
 * Trains drawn as instanced cars: one instanced mesh per line in its CTA color,
 * plus one for the window bands. Each car sits on the track at its own distance
 * behind the head of the train, turned to the track, so trains bend through the
 * Loop's corners and Tower 18.
 */

import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  type Raycaster,
  Vector3,
} from "three";
import { pointAt, type Polyline } from "@chicago-loop/mock";
import { bearingToYaw, toScene } from "../data/frame.ts";
import { LINE_COLORS, MATERIALS, type Theme } from "../scene/palette.ts";

export const CAR = { length: 14.63, width: 2.84, height: 3.15, gap: 0.6, floor: 0.55 };
/** Cars per train. Estimated typical consists. */
export const CONSIST: Record<string, number> = { brn: 8, g: 6, org: 8, p: 8, pink: 6 };
const MAX_TRAINS = 60;

export interface DisplayTrain {
  key: string;
  route: string;
  pathId: string;
  distance: number;
}

export interface CarPose {
  position: [number, number, number];
  yaw: number;
}

/** Poses of the cars of a train whose head is at `head` meters along `line`. */
export function carPoses(line: Polyline, head: number, cars: number, trackZ: number): CarPose[] {
  const out: CarPose[] = [];
  for (let k = 0; k < cars; k++) {
    const center = head - CAR.length / 2 - k * (CAR.length + CAR.gap);
    const d = Math.min(Math.max(center, 0), line.length);
    const a = pointAt(line, Math.max(d - CAR.length * 0.4, 0)).point;
    const b = pointAt(line, Math.min(d + CAR.length * 0.4, line.length)).point;
    const mid = pointAt(line, d).point;
    const bearing = ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360;
    out.push({ position: toScene(mid[0], mid[1], trackZ + CAR.floor + CAR.height / 2), yaw: bearingToYaw(bearing) });
  }
  return out;
}

export class TrainLayer {
  readonly group = new Group();
  private readonly bodies = new Map<string, InstancedMesh>();
  private readonly windows: InstancedMesh;
  private readonly windowMaterial: MeshStandardMaterial;
  private readonly owners = new Map<InstancedMesh, string[]>();
  private readonly bodyMaterials = new Map<string, MeshStandardMaterial>();

  constructor(
    private readonly paths: Map<string, Polyline>,
    private readonly trackZ: number,
    /** Cars outside these local bounds [x0, y0, x1, y1] are not drawn: the model ends there. */
    private readonly bounds: [number, number, number, number],
  ) {
    this.group.name = "trains";
    const body = new BoxGeometry(CAR.length, CAR.height, CAR.width);
    const band = new BoxGeometry(CAR.length - 1.2, 0.95, CAR.width + 0.04);
    band.translate(0, 0.4, 0);
    for (const [route, hex] of Object.entries(LINE_COLORS)) {
      const mat = new MeshStandardMaterial({ color: new Color(hex), roughness: 0.42, metalness: 0 });
      this.bodyMaterials.set(route, mat);
      const mesh = new InstancedMesh(body, mat, MAX_TRAINS * (CONSIST[route] ?? 8));
      mesh.name = `trains_${route}`;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.bodies.set(route, mesh);
      this.owners.set(mesh, []);
      this.group.add(mesh);
    }
    this.windowMaterial = new MeshStandardMaterial({ roughness: 0.15 });
    this.windows = new InstancedMesh(band, this.windowMaterial, MAX_TRAINS * 8 * 5);
    this.windows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.windows.count = 0;
    this.windows.frustumCulled = false;
    this.group.add(this.windows);
    this.setTheme("day");
  }

  setTheme(theme: Theme): void {
    const w = MATERIALS.train_window!;
    const c = theme === "day" ? w.day : w.night;
    this.windowMaterial.color.setRGB(c[0], c[1], c[2]);
    if (theme === "night" && w.glow) {
      this.windowMaterial.emissive.setRGB(...w.glow[0]);
      this.windowMaterial.emissiveIntensity = w.glow[1];
    } else {
      this.windowMaterial.emissiveIntensity = 0;
    }
    for (const mat of this.bodyMaterials.values()) {
      mat.emissive = theme === "night" ? mat.color.clone() : new Color(0, 0, 0);
      mat.emissiveIntensity = theme === "night" ? 0.9 : 0;
    }
  }

  update(trains: readonly DisplayTrain[]): void {
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    const counts = new Map<string, number>();
    for (const mesh of this.bodies.values()) this.owners.set(mesh, []);
    let w = 0;
    for (const t of trains) {
      const line = this.paths.get(t.pathId);
      const mesh = this.bodies.get(t.route);
      if (!line || !mesh) continue;
      const owners = this.owners.get(mesh)!;
      const [x0, y0, x1, y1] = this.bounds;
      for (const pose of carPoses(line, t.distance, CONSIST[t.route] ?? 6, this.trackZ)) {
        const [px, , pz] = pose.position;
        if (px < x0 || px > x1 || -pz < y0 || -pz > y1) continue;
        const i = counts.get(t.route) ?? 0;
        if (i >= mesh.instanceMatrix.count) break;
        q.setFromAxisAngle(up, pose.yaw);
        m.compose(new Vector3(...pose.position), q, one);
        mesh.setMatrixAt(i, m);
        owners[i] = t.key;
        counts.set(t.route, i + 1);
        if (w < this.windows.instanceMatrix.count) this.windows.setMatrixAt(w++, m);
      }
    }
    for (const [route, mesh] of this.bodies) {
      mesh.count = counts.get(route) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.windows.count = w;
    this.windows.instanceMatrix.needsUpdate = true;
  }

  /** The key of the train under the ray, if any. */
  pick(raycaster: Raycaster): string | null {
    const hits = raycaster.intersectObjects([...this.bodies.values()], false);
    for (const h of hits) {
      if (h.instanceId == null) continue;
      const key = this.owners.get(h.object as InstancedMesh)?.[h.instanceId];
      if (key) return key;
    }
    return null;
  }
}
