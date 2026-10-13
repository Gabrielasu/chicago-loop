/** Load build/loop.glb and give its materials the day or night look. */

import { Color, type Material, type Mesh, MeshStandardMaterial, type Object3D } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MATERIALS, type Theme } from "../scene/palette.ts";

export interface LoadedModel {
  root: Object3D;
  materials: Map<string, MeshStandardMaterial>;
}

const BASE = import.meta.env.BASE_URL;

// Ground and flat surfaces take shadows but never cast them.
const NO_CAST = new Set(["ground", "street_surface", "parks", "street_marks", "river_water", "bridges"]);

export async function loadModel(onProgress?: (fraction: number) => void): Promise<LoadedModel> {
  const draco = new DRACOLoader().setDecoderPath(`${BASE}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await loader.loadAsync(`${BASE}model/loop.glb`, (e) => {
    if (e.total) onProgress?.(e.loaded / e.total);
  });
  draco.dispose();

  const materials = new Map<string, MeshStandardMaterial>();
  gltf.scene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const name = mesh.name || mesh.parent?.name || "";
    mesh.castShadow = !NO_CAST.has(name) && !NO_CAST.has(mesh.parent?.name ?? "");
    mesh.receiveShadow = true;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const replaced = list.map((m: Material) => {
      const existing = materials.get(m.name);
      if (existing) return existing;
      const std = m instanceof MeshStandardMaterial ? m : new MeshStandardMaterial({ name: m.name });
      materials.set(m.name, std);
      return std;
    });
    mesh.material = Array.isArray(mesh.material) ? replaced : replaced[0]!;
  });
  return { root: gltf.scene, materials };
}

export function applyTheme(model: LoadedModel, theme: Theme): void {
  for (const [name, mat] of model.materials) {
    const look = MATERIALS[name];
    if (!look) continue;
    const c = theme === "day" ? look.day : look.night;
    mat.color.setRGB(c[0], c[1], c[2]);
    mat.roughness = look.roughness;
    mat.metalness = look.metalness;
    if (theme === "night" && look.glow) {
      mat.emissive = new Color(...look.glow[0]);
      mat.emissiveIntensity = look.glow[1];
    } else {
      mat.emissive.setRGB(0, 0, 0);
      mat.emissiveIntensity = 0;
    }
    mat.needsUpdate = true;
  }
  // Line signs keep their CTA colors; at night they glow a little.
  for (const [name, mat] of model.materials) {
    if (!name.startsWith("line_")) continue;
    mat.emissive = theme === "night" ? mat.color.clone() : new Color(0, 0, 0);
    mat.emissiveIntensity = theme === "night" ? 1.2 : 0;
  }
}
