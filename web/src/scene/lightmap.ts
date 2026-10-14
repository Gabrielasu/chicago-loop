/**
 * Night light on the ground: drawn once into a canvas from the real streets,
 * stations and L tracks, then sampled by the ground and the lower walls of the
 * buildings at night.
 *
 * What it draws, after how the Loop looks from above at night:
 * - a pool under every streetlight, about every 30 m along each side of the
 *   street (Chicago converted to warm white LED streetlights from 2017 on),
 *   brighter on the big streets;
 * - a soft wash along each street, the light that bounces between the pools;
 * - the lit corridor under the L, where the structure's own lamps light the
 *   street, and bright pools at the stations.
 */

import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  type MeshStandardMaterial,
  SRGBColorSpace,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from "three";
import type { NetworkStation, NetworkTrack } from "@chicago-loop/mock";

export type StreetRow = [highway: string, width: number, flat: number[]];

/** How much light a street class gets (0 to 1). */
const CLASS_LIGHT: Record<string, number> = {
  motorway: 0.55,
  trunk: 1,
  primary: 1,
  secondary: 0.85,
  tertiary: 0.7,
  unclassified: 0.5,
  residential: 0.5,
  pedestrian: 0.55,
};

const LAMP_SPACING = 30;
const SIZE = 2048;

export interface LightMap {
  texture: CanvasTexture;
  /** Local bounds the texture covers: [x0, y0, x1, y1] */
  bounds: [number, number, number, number];
}

export function drawLightMap(
  streets: readonly StreetRow[],
  tracks: readonly NetworkTrack[],
  stations: readonly NetworkStation[],
  bounds: [number, number, number, number],
): LightMap {
  const [x0, y0, x1, y1] = bounds;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const sx = SIZE / (x1 - x0);
  const sy = SIZE / (y1 - y0);
  const px = (x: number) => (x - x0) * sx;
  const py = (y: number) => (y1 - y) * sy;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const pool = (x: number, y: number, radius: number, alpha: number, rgb = "255, 214, 160") => {
    const r = radius * sx;
    const g = ctx.createRadialGradient(px(x), py(y), 0, px(x), py(y), r);
    g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    g.addColorStop(0.35, `rgba(${rgb}, ${alpha * 0.55})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(px(x) - r, py(y) - r, 2 * r, 2 * r);
  };

  for (const [cls, width, flat] of streets) {
    const k = CLASS_LIGHT[cls] ?? 0.5;
    const pts: [number, number][] = [];
    for (let i = 0; i < flat.length; i += 2) pts.push([flat[i]! / 10, flat[i + 1]! / 10]);
    if (pts.length < 2) continue;
    // The wash along the street.
    ctx.strokeStyle = `rgba(255, 205, 150, ${0.09 * k})`;
    ctx.lineWidth = Math.max(width * sx, 2);
    ctx.beginPath();
    ctx.moveTo(px(pts[0]![0]), py(pts[0]![1]));
    for (const [x, y] of pts.slice(1)) ctx.lineTo(px(x), py(y));
    ctx.stroke();
    // Lamps on both sides, staggered, about every 30 m.
    let carry = 0;
    let side = 1;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[i + 1]!;
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.01) continue;
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      const off = Math.max(width / 2 - 0.8, 1.5);
      for (let d = carry; d < len; d += LAMP_SPACING / 2) {
        const t = d / len;
        pool(ax + (bx - ax) * t + nx * off * side, ay + (by - ay) * t + ny * off * side, 13, 0.42 * k);
        side = -side;
      }
      carry = (((carry - len) % (LAMP_SPACING / 2)) + LAMP_SPACING / 2) % (LAMP_SPACING / 2);
    }
  }

  // Under the L: a continuous band of light from the structure's lamps.
  ctx.strokeStyle = "rgba(255, 220, 175, 0.22)";
  ctx.lineWidth = 9 * sx;
  for (const t of tracks) {
    ctx.beginPath();
    ctx.moveTo(px(t.points[0]![0]), py(t.points[0]![1]));
    for (const [x, y] of t.points.slice(1)) ctx.lineTo(px(x), py(y));
    ctx.stroke();
  }
  // Stations: bright and a little whiter.
  for (const s of stations) {
    if (s.status !== "open") continue;
    pool(s.location[0], s.location[1], 70, 0.5, "255, 232, 200");
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 8;
  return { texture, bounds };
}

export async function loadStreets(): Promise<StreetRow[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}model/streets.json`);
    return res.ok ? ((await res.json()) as StreetRow[]) : [];
  } catch {
    return [];
  }
}

/** GLSL: sample the light map at a scene position. Needs uniforms uLightMap, uLightBounds. */
export const LIGHTMAP_GLSL = /* glsl */ `
uniform sampler2D uLightMap;
uniform vec4 uLightBounds;
uniform float uGroundLight;
vec3 groundLightAt(vec3 worldPos) {
  // Scene x is local x, scene z is local -y.
  vec2 uv = vec2((worldPos.x - uLightBounds.x) / (uLightBounds.z - uLightBounds.x),
                 (-worldPos.z - uLightBounds.y) / (uLightBounds.w - uLightBounds.y));
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  return texture2D(uLightMap, uv).rgb;
}
`;

export interface GroundLightUniforms {
  uLightMap: { value: CanvasTexture | null };
  uLightBounds: { value: Vector4 };
  uGroundLight: { value: number };
}

export function groundLightUniforms(map: LightMap | null): GroundLightUniforms {
  const [x0, y0, x1, y1] = map?.bounds ?? [0, 0, 1, 1];
  return {
    uLightMap: { value: map?.texture ?? null },
    uLightBounds: { value: new Vector4(x0, y0, x1, y1) },
    uGroundLight: { value: 0 },
  };
}

/** Let a ground material (street, sidewalk, park) glow with the light map at night. */
export function withGroundLight(material: MeshStandardMaterial, uniforms: GroundLightUniforms): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGlPos;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGlPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vGlPos;\n${LIGHTMAP_GLSL}`)
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += groundLightAt(vGlPos) * uGroundLight * diffuseColor.rgb * 3.5;",
      );
  };
  material.customProgramCacheKey = () => "ground-light";
  material.needsUpdate = true;
}
