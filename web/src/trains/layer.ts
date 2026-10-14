/**
 * Trains drawn as instanced cars. One instanced mesh per line for the bodies in
 * its CTA color, and shared instanced meshes for glass, running gear and the
 * head and tail lights. Every car sits on its own two trucks on the track, so
 * trains bend through the Loop's corners and Tower 18.
 */

import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  type Raycaster,
  Vector3,
} from "three";
import type { Polyline } from "@chicago-loop/mock";
import { type Light, lerp, mix } from "../scene/light.ts";
import { LINE_COLORS, MATERIALS } from "../scene/palette.ts";
import { CAR, CONSIST, carGeometries, carPoses } from "./car.ts";

export { CAR, CONSIST, carPoses } from "./car.ts";

const MAX_TRAINS = 70;
const MAX_CARS = MAX_TRAINS * 8;

export interface DisplayTrain {
  key: string;
  route: string;
  pathId: string;
  distance: number;
}

export class TrainLayer {
  readonly group = new Group();
  private readonly bodies = new Map<string, InstancedMesh>();
  private readonly glass: InstancedMesh;
  private readonly gear: InstancedMesh;
  private readonly lights: InstancedMesh;
  private readonly glassMaterial = new MeshStandardMaterial({ roughness: 0.12, metalness: 0.2 });
  private readonly gearMaterial = new MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.7, metalness: 0.4 });
  private readonly lightMaterial = new MeshBasicMaterial({ toneMapped: false });
  private readonly owners = new Map<InstancedMesh, string[]>();
  private readonly bodyMaterials = new Map<string, MeshStandardMaterial>();
  private night = 0;

  constructor(
    private readonly paths: Map<string, Polyline>,
    private readonly trackZ: number,
    /** Cars outside these local bounds [x0, y0, x1, y1] are not drawn: the model ends there. */
    private readonly bounds: [number, number, number, number],
  ) {
    this.group.name = "trains";
    const geo = carGeometries();
    for (const [route, hex] of Object.entries(LINE_COLORS)) {
      const mat = new MeshStandardMaterial({ color: new Color(hex), roughness: 0.38, metalness: 0.15 });
      this.bodyMaterials.set(route, mat);
      const mesh = this.instanced(geo.body, mat, MAX_TRAINS * (CONSIST[route] ?? 8), `trains_${route}`);
      this.bodies.set(route, mesh);
      this.owners.set(mesh, []);
    }
    this.glass = this.instanced(geo.glass, this.glassMaterial, MAX_CARS, "trains_glass");
    this.gear = this.instanced(geo.gear, this.gearMaterial, MAX_CARS, "trains_gear");
    // Two lamps at each end of a train: white at the head, red at the tail.
    const lamp = new BoxGeometry(0.06, 0.22, 0.32);
    this.lights = this.instanced(lamp, this.lightMaterial, MAX_TRAINS * 4, "trains_lights");
    this.lights.castShadow = false;
    this.lights.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_TRAINS * 4 * 3), 3);
    this.setLight({ night: 0, golden: 0 });
  }

  private instanced(geometry: BoxGeometry | InstancedMesh["geometry"], material: InstancedMesh["material"], count: number, name: string) {
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  setLight(l: Light): void {
    this.night = l.night;
    const w = MATERIALS.train_window!;
    this.glassMaterial.color.setRGB(...mix(w.day, w.night, l.night));
    if (w.glow) {
      this.glassMaterial.emissive.setRGB(...w.glow[0]);
      this.glassMaterial.emissiveIntensity = w.glow[1] * l.night;
    }
    for (const mat of this.bodyMaterials.values()) {
      mat.emissive.copy(mat.color);
      mat.emissiveIntensity = 0.55 * l.night;
    }
  }


  /**
   * Place every car. Seen from far away, cars are drawn wider and taller (never
   * longer, so they stay on their track) so trains read from above.
   */
  update(trains: readonly DisplayTrain[], eye?: Vector3): void {
    const m = new Matrix4();
    const lampM = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const pos = new Vector3();
    const scale = new Vector3(1, 1, 1);
    const n = this.night;
    const head = new Color(lerp(1.6, 3.2, n), lerp(1.5, 3.0, n), lerp(1.3, 2.6, n));
    const tail = new Color(lerp(0.9, 2.6, n), 0.05, 0.04);
    const counts = new Map<string, number>();
    for (const mesh of this.bodies.values()) this.owners.set(mesh, []);
    let shared = 0;
    let lamps = 0;
    const [x0, y0, x1, y1] = this.bounds;
    for (const t of trains) {
      const line = this.paths.get(t.pathId);
      const mesh = this.bodies.get(t.route);
      if (!line || !mesh) continue;
      const owners = this.owners.get(mesh)!;
      const poses = carPoses(line, t.distance, CONSIST[t.route] ?? 6, this.trackZ);
      poses.forEach((pose, k) => {
        const [lx, ly] = pose.local;
        if (lx < x0 || lx > x1 || ly < y0 || ly > y1) return;
        const i = counts.get(t.route) ?? 0;
        if (i >= mesh.instanceMatrix.count || shared >= MAX_CARS) return;
        q.setFromAxisAngle(up, pose.yaw);
        pos.set(...pose.position);
        const far = eye ? Math.min(Math.max(eye.distanceTo(pos) / 350, 1), 3.2) : 1;
        scale.set(1, far, far);
        m.compose(pos, q, scale);
        mesh.setMatrixAt(i, m);
        owners[i] = t.key;
        counts.set(t.route, i + 1);
        this.glass.setMatrixAt(shared, m);
        this.gear.setMatrixAt(shared, m);
        shared++;
        // Lamps on the leading face of the first car and the trailing face of the last.
        const ends: [number, Color][] = [];
        if (k === 0) ends.push([1, head]);
        if (k === poses.length - 1) ends.push([-1, tail]);
        for (const [dir, color] of ends) {
          for (const side of [-0.95, 0.95]) {
            if (lamps >= this.lights.instanceMatrix.count) break;
            const offset = new Vector3(dir * (CAR.length / 2 + 0.04), CAR.floor + 0.55, side).applyQuaternion(q);
            lampM.compose(pos.clone().add(offset.multiply(new Vector3(1, scale.y, scale.z))), q, scale);
            this.lights.setMatrixAt(lamps, lampM);
            this.lights.setColorAt(lamps, color);
            lamps++;
          }
        }
      });
    }
    for (const [route, mesh] of this.bodies) {
      mesh.count = counts.get(route) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const mesh of [this.glass, this.gear]) {
      mesh.count = shared;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.lights.count = lamps;
    this.lights.instanceMatrix.needsUpdate = true;
    if (this.lights.instanceColor) this.lights.instanceColor.needsUpdate = true;
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
