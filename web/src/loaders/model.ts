/** Load build/loop.glb and give its materials the day or night look. */

import {
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import { acceleratedRaycast, computeBoundsTree } from "three-mesh-bvh";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { type Light, lerp, mix } from "../scene/light.ts";
import { MATERIALS } from "../scene/palette.ts";
import { type GroundLightUniforms, withGroundLight } from "../scene/lightmap.ts";
import { WINDOW, WINDOW_STYLES, type WindowMaterial, withWindows } from "../scene/windows.ts";

export interface LoadedModel {
  root: Object3D;
  materials: Map<string, MeshStandardMaterial>;
  windows: WindowMaterial[];
  /** Building meshes, for the faint mode */
  buildings: Mesh[];
  /** Fine edges on the building volumes, as on an architect's model */
  edges: LineSegments[];
  edgeMaterial: LineBasicMaterial;
}

// Bounding volume hierarchies make raycasts against the city cheap enough to
// run every frame (picking, walking, keeping trains in sight).
Mesh.prototype.raycast = acceleratedRaycast;

const BUILDING_MATERIALS = new Set(["massing_white", "massing_grey", "massing_glass"]);

const BASE = import.meta.env.BASE_URL;

// Ground and flat surfaces take shadows but never cast them.
const NO_CAST = new Set(["ground", "blocks", "green", "parks", "street_marks", "river_water", "bridges"]);

const GROUND_MATERIALS = ["ground", "street", "park", "marking", "bridge", "platform"];

export async function loadModel(
  ground: GroundLightUniforms,
  onProgress?: (fraction: number) => void,
): Promise<LoadedModel> {
  const draco = new DRACOLoader().setDecoderPath(`${BASE}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await loader.loadAsync(`${BASE}model/loop.glb`, (e) => {
    if (e.total) onProgress?.(e.loaded / e.total);
  });
  draco.dispose();

  const materials = new Map<string, MeshStandardMaterial>();
  const buildings: Mesh[] = [];
  gltf.scene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.boundsTree = computeBoundsTree.call(mesh.geometry);
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
    if (replaced.some((m) => BUILDING_MATERIALS.has(m.name))) buildings.push(mesh);
  });
  const windows: WindowMaterial[] = [];
  for (const [name, style] of Object.entries(WINDOW_STYLES)) {
    const mat = materials.get(name);
    if (mat) windows.push(withWindows(mat, style, ground));
  }
  // Edges where faces meet at more than 25 degrees: the corners and roof lines of every volume.
  const edgeMaterial = new LineBasicMaterial({ color: 0x1c1c1c, transparent: true, opacity: 0.22, depthWrite: false });
  const edges: LineSegments[] = [];
  for (const mesh of buildings) {
    const lines = new LineSegments(new EdgesGeometry(mesh.geometry, 25), edgeMaterial);
    lines.name = `${mesh.name}_edges`;
    lines.raycast = () => {};
    mesh.add(lines);
    edges.push(lines);
  }
  for (const name of GROUND_MATERIALS) {
    const m = materials.get(name);
    if (m) withGroundLight(m, ground);
  }
  // Thin overlays (parks, planted areas, center lines) sit centimeters above the
  // ground, and the edge lines lie on the building faces: far away the depth
  // buffer cannot tell them apart and they shimmer. Pull overlays forward and
  // push building faces back so the order is always the same.
  for (const name of ["park", "marking"]) {
    const m = materials.get(name);
    if (m) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  }
  for (const name of BUILDING_MATERIALS) {
    const m = materials.get(name);
    if (m) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
  }
  return { root: gltf.scene, materials, windows, buildings, edges, edgeMaterial };
}

/** Edge lines: dark and fine by day, a faint warm trace at night, stronger when the buildings are faint. */
export function styleEdges(model: LoadedModel, l: Light, faint: boolean): void {
  const m = model.edgeMaterial;
  m.color.setRGB(...mix([0.08, 0.08, 0.08], [0.55, 0.5, 0.42], l.night));
  m.opacity = faint ? lerp(0.32, 0.28, l.night) : lerp(0.38, 0.1, l.night);
}

/**
 * Blend every material between its day and night look. Windows come on through
 * golden hour and dusk; platforms, signs and lamps glow with the night.
 * Only numbers change here, so it is cheap to call every frame during a change.
 */
export function applyLight(model: LoadedModel, l: Light): void {
  // Lit windows only read once the sun is down: they come on through the blue hour.
  const t = Math.min(Math.max((l.night - 0.12) / 0.5, 0), 1);
  const windowsOn = t * t * (3 - 2 * t);
  // Surfaces darken ahead of the light, so at dusk the city reads as dark volumes with lit windows.
  const dark = 1 - (1 - l.night) ** 2.5;
  for (const w of model.windows) w.set(WINDOW.strength * windowsOn);
  for (const [name, mat] of model.materials) {
    if (name.startsWith("line_")) {
      // Line signs keep their CTA colors; at night they glow a little.
      mat.emissive.copy(mat.color);
      mat.emissiveIntensity = 1.2 * l.night;
      continue;
    }
    const look = MATERIALS[name];
    if (!look) continue;
    mat.color.setRGB(...mix(look.day, look.night, dark));
    mat.roughness = look.roughness;
    mat.metalness = look.metalness;
    if (look.glow) {
      mat.emissive.setRGB(...look.glow[0]);
      mat.emissiveIntensity = look.glow[1] * l.night;
    } else {
      mat.emissiveIntensity = 0;
    }
  }
}

/** Faint buildings: the volumes turn to a pale, see-through massing so the L and its trains read. */
export function setBuildingsFaint(model: LoadedModel, faint: boolean): void {
  for (const name of BUILDING_MATERIALS) {
    const mat = model.materials.get(name);
    if (!mat) continue;
    mat.transparent = faint;
    mat.opacity = faint ? 0.07 : 1;
    mat.depthWrite = !faint;
    mat.needsUpdate = true;
  }
  for (const mesh of model.buildings) {
    mesh.castShadow = !faint;
    mesh.renderOrder = faint ? 2 : 0;
  }
}
