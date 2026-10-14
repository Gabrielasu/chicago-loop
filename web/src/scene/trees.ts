/**
 * Trees from OpenStreetMap, drawn as instanced abstract canopies on thin trunks,
 * the way they appear on an architect's model. Sizes are estimated where the
 * data has none; a stable hash varies them a little so rows do not look cloned.
 */

import {
  BoxGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import { toScene } from "../data/frame.ts";
import { type Light, mix } from "./light.ts";

export type TreeRow = [x: number, y: number, height: number, crown: number];

function vary(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return 0.8 + 0.4 * (s - Math.floor(s));
}

export class Trees {
  readonly group = new Object3D();
  private readonly canopy = new MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  private readonly trunk = new MeshStandardMaterial({ roughness: 0.9 });

  constructor(rows: readonly TreeRow[]) {
    this.group.name = "trees";
    const crowns = new InstancedMesh(new IcosahedronGeometry(1, 1), this.canopy, rows.length);
    const trunks = new InstancedMesh(new BoxGeometry(0.3, 1, 0.3), this.trunk, rows.length);
    const m = new Matrix4();
    const q = new Quaternion();
    rows.forEach(([x, y, height, crown], i) => {
      const k = vary(x, y);
      const r = (crown / 2) * k;
      const h = height * k;
      const cz = Math.max(h - r * 0.9, r * 0.8 + 1.8);
      m.compose(new Vector3(...toScene(x, y, cz)), q, new Vector3(r, r * 0.9, r));
      crowns.setMatrixAt(i, m);
      const th = cz - r * 0.5;
      m.compose(new Vector3(...toScene(x, y, th / 2)), q, new Vector3(1, th, 1));
      trunks.setMatrixAt(i, m);
    });
    for (const mesh of [crowns, trunks]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.setLight({ night: 0, golden: 0 });
  }

  /** In the faint mode trees fade with the buildings. */
  setFaint(faint: boolean): void {
    for (const m of [this.canopy, this.trunk]) {
      m.transparent = faint;
      m.opacity = faint ? 0.15 : 1;
      m.depthWrite = !faint;
      m.needsUpdate = true;
    }
    for (const c of this.group.children) c.castShadow = !faint;
  }

  setLight(l: Light): void {
    // Linear RGB, as blender/looks.py.
    const dark = 1 - (1 - l.night) ** 2.5;
    this.canopy.color.setRGB(...mix([0.6, 0.625, 0.565], [0.028, 0.032, 0.03], dark));
    this.trunk.color.setRGB(...mix([0.42, 0.41, 0.39], [0.03, 0.03, 0.03], dark));
  }

}

export async function loadTrees(): Promise<Trees | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}model/trees.json`);
    if (!res.ok) return null;
    return new Trees((await res.json()) as TreeRow[]);
  } catch {
    return null;
  }
}
