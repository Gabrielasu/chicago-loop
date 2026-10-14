/**
 * Lit windows at night, drawn in the shader of the building materials.
 *
 * How the Loop looks after dark: office towers light whole floors (cleaning
 * crews, late workers), so light comes in horizontal bands with dark floors in
 * between; a few windows burn on the dark floors; lobbies and storefronts glow
 * at street level. Each facade has one kind of light (warm, neutral or cool
 * white); glass curtain walls glow as continuous bands, masonry shows separate
 * windows. Nothing is stored in the model, so the glTF stays small.
 *
 * The pattern is averaged over each pixel's footprint so it never sparkles,
 * and fades to the wall's average glow once a window is smaller than a pixel.
 */

import { type MeshStandardMaterial, Vector2, type WebGLProgramParametersWithUniforms } from "three";
import { type GroundLightUniforms, LIGHTMAP_GLSL } from "./lightmap.ts";

export interface WindowStyle {
  /** Share of each bay that is wall, not glass (0 to 1) */
  frameU: number;
  /** Share of each floor that is wall */
  frameV: number;
  /** 1 for glass curtain walls: cooler, brighter, continuous */
  glass: number;
}

export const WINDOW_STYLES: Record<string, WindowStyle> = {
  massing_white: { frameU: 0.42, frameV: 0.38, glass: 0 },
  massing_grey: { frameU: 0.3, frameV: 0.3, glass: 0 },
  massing_glass: { frameU: 0.04, frameV: 0.16, glass: 1 },
};

/**
 * bay, floor: window grid in meters. floors: share of floors lit in the evening.
 * strength: emission of a fully lit window. samples: samples x samples per pixel.
 */
export const WINDOW = { bay: 3.0, floor: 3.9, strength: 0.6, samples: 3 };

/**
 * Share of office floors lit at a local hour (0 to 24): busy in the early
 * evening as people leave and crews clean, sparse after midnight, picking up
 * before dawn. Estimated from how downtown towers look through the night.
 */
export function litFloorsAt(hour: number): number {
  const curve: [number, number][] = [
    [0, 0.16], [2, 0.1], [4, 0.1], [5.5, 0.2], [7, 0.32], [9, 0.3], [16, 0.3],
    [18, 0.52], [20, 0.42], [22, 0.28], [24, 0.16],
  ]; // fmt
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < curve.length - 1; i++) {
    const [h0, v0] = curve[i]!;
    const [h1, v1] = curve[i + 1]!;
    if (h >= h0 && h <= h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  return 0.2;
}

const VERTEX_DECL = /* glsl */ `
attribute float _roofz;
varying vec3 vWinPos;
varying vec3 vWinNormal;
varying float vRoof;
`;

const VERTEX_BODY = /* glsl */ `
vWinPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWinNormal = normalize(mat3(modelMatrix) * objectNormal);
vRoof = _roofz;
`;

const FRAGMENT_DECL = /* glsl */ `
varying vec3 vWinPos;
varying vec3 vWinNormal;
varying float vRoof;
uniform float uWindows;
uniform vec2 uWinFrame;
uniform float uWinGlass;
uniform float uWinFloors;
${LIGHTMAP_GLSL}

float winHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float winNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = winHash(vec3(i, 7.0));
  float b = winHash(vec3(i + vec2(1.0, 0.0), 7.0));
  float c = winHash(vec3(i + vec2(0.0, 1.0), 7.0));
  float d = winHash(vec3(i + vec2(1.0, 1.0), 7.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** A 0 to 1 pulse between a and b, averaged over a pixel footprint w. */
float winPulse(float x, float a, float b, float w) {
  return clamp(smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x), 0.0, 1.0);
}

/** One light per facade: warm (homes, older offices), neutral, or cool white (newer offices, glass). */
vec3 facadeColor(float plane) {
  float t = winHash(vec3(plane, 5.0, 9.0)) * (1.0 - 0.55 * uWinGlass) + 0.55 * uWinGlass;
  if (t < 0.42) return vec3(1.0, 0.62, 0.32);
  if (t < 0.78) return vec3(1.0, 0.8, 0.58);
  return vec3(0.8, 0.9, 1.0);
}

/** Expected share of glass lit on a facade where this share of floors is lit. */
float litShare(float floors) {
  return floors * 0.9 * 0.8 + (1.0 - floors) * 0.07 * 0.8;
}

/**
 * Light across one window, t from sill (0) to head (1): brighter toward the
 * ceiling lights, and in about a quarter of windows blinds drawn part way.
 */
float interior(float t, vec3 cell) {
  float light = 0.78 + 0.32 * t;
  float blind = winHash(cell + 23.0);
  if (blind < 0.25 && t > 0.35 + blind * 2.0) light *= 0.35;
  return light;
}

/** How lit a window is (0 to about 1), from the cell it is in: floor bands, stray windows, lobbies. */
float cellLight(vec2 cellId, float plane, float floors) {
  vec3 cell = vec3(cellId, plane);
  // Street level: lobbies and shops, mostly lit and bright.
  if (cellId.y < 1.0) return step(winHash(cell + 3.0), 0.8) * 0.8;
  bool floorLit = winHash(vec3(cellId.y, plane, 11.0)) < floors;
  float lit = step(winHash(cell), floorLit ? 0.9 : 0.07);
  return lit * (0.6 + 0.4 * winHash(cell + 41.0));
}

/** Integral over [0, x] of a periodic pulse that is 1 on [a, b] of every unit. */
float pulseInt(float x, float a, float b) {
  return floor(x) * (b - a) + clamp(fract(x) - a, 0.0, b - a);
}

/** Exact share of [x - w/2, x + w/2] covered by the pulse: a box filter, no aliasing. */
float pulseBox(float x, float w, float a, float b) {
  if (w < 1e-4) return step(a, fract(x)) * step(fract(x), b);
  return (pulseInt(x + w * 0.5, a, b) - pulseInt(x - w * 0.5, a, b)) / w;
}

/**
 * The lit pattern around one point of a wall, in window units (s.x along, s.y
 * floors up), box filtered over an area e (in the same units).
 */
float windowAt(vec2 s, vec2 e, float plane, float floors) {
  float a = uWinFrame.y * 0.65;
  float b = 1.0 - uWinFrame.y * 0.35;
  float glass = pulseBox(s.x, e.x, uWinFrame.x * 0.5, 1.0 - uWinFrame.x * 0.5) * pulseBox(s.y, e.y, a, b);
  vec2 id = floor(s);
  return glass * cellLight(id, plane, floors) * interior(clamp((fract(s.y) - a) / (b - a), 0.0, 1.0), vec3(id, plane));
}

/**
 * Floodlit crowns: towers over 90 m have the top of their walls washed in light
 * at night, brightest at the roof line, as so many Loop towers do.
 */
vec3 crownLight() {
  if (uWindows <= 0.0 || vRoof < 120.0 || abs(normalize(vWinNormal).y) > 0.3) return vec3(0.0);
  float span = clamp(vRoof * 0.09, 9.0, 34.0);
  float t = smoothstep(vRoof - span, vRoof, vWinPos.y);
  float k = winHash(vec3(floor(vRoof), 3.0, 1.0));
  // Most crowns warm white, a few cool, some not lit at all.
  if (k < 0.18) return vec3(0.0);
  vec3 c = k > 0.8 ? vec3(0.8, 0.88, 1.0) : vec3(1.0, 0.86, 0.66);
  return c * t * t * 0.42 * uWindows;
}

vec3 windowLight() {
  vec3 n = normalize(vWinNormal);
  if (uWindows <= 0.0 || abs(n.y) > 0.3) return vec3(0.0);
  // Scene axes are y up; walls run along the horizontal tangent (n.z, -n.x).
  vec2 h = normalize(n.xz);
  float u = vWinPos.x * h.y - vWinPos.z * h.x;
  float plane = floor(dot(vWinPos.xz, h) + 0.5);
  vec2 s = vec2(u / ${WINDOW.bay.toFixed(2)}, vWinPos.y / ${WINDOW.floor.toFixed(2)});
  // Busier and quieter blocks.
  float floors = clamp(uWinFloors * (0.5 + winNoise(vWinPos.xz / 90.0)), 0.03, 0.95);
  vec3 color = facadeColor(plane);
  float bright = 1.0 + 0.35 * uWinGlass;

  vec2 dx = dFdx(s);
  vec2 dy = dFdy(s);
  float footprint = max(length(dx), length(dy));
  float value;
  if (footprint < 0.08) {
    // Up close a window spans a dozen pixels or more: one sample with softened edges.
    vec2 f = fract(s);
    float soft = winPulse(f.x, uWinFrame.x * 0.5, 1.0 - uWinFrame.x * 0.5, length(dx) * 0.75)
               * winPulse(f.y, uWinFrame.y * 0.65, 1.0 - uWinFrame.y * 0.35, length(dy) * 0.75);
    float a = uWinFrame.y * 0.65;
    float b = 1.0 - uWinFrame.y * 0.35;
    // Curtain walls: a mullion every 1.5 m splits each bay.
    float mullion = uWinGlass > 0.5 ? 1.0 - winPulse(fract(s.x * 2.0), 0.0, 0.04, length(dx) * 1.5) : 1.0;
    value = cellLight(floor(s), plane, floors) * soft * mullion
          * interior(clamp((f.y - a) / (b - a), 0.0, 1.0), vec3(floor(s), plane));
  } else {
    // Average the pattern over the pixel's footprint, so small windows never flicker.
    float sum = 0.0;
    const int N = ${WINDOW.samples};
    // Each sample covers its own share of the pixel's footprint on the wall.
    vec2 e = (abs(dx) + abs(dy)) / float(N);
    for (int i = 0; i < N; i++) {
      for (int j = 0; j < N; j++) {
        vec2 o = (vec2(float(i), float(j)) + 0.5) / float(N) - 0.5;
        sum += windowAt(s + dx * o.x + dy * o.y, e, plane, floors);
      }
    }
    value = sum / float(N * N);
  }
  // Smaller than a pixel: the wall's average glow.
  float glassArea = (1.0 - uWinFrame.x) * (1.0 - uWinFrame.y);
  value = mix(value, litShare(floors) * glassArea, smoothstep(0.7, 1.5, footprint));
  return color * value * bright * uWindows;
}
`;

const FRAGMENT_BODY = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += windowLight();
totalEmissiveRadiance += crownLight();
// Streetlight spill on the lower walls, fading over the first two floors.
if (abs(normalize(vWinNormal).y) < 0.3) {
  totalEmissiveRadiance += groundLightAt(vWinPos) * uGroundLight * diffuseColor.rgb * 3.0 * exp(-vWinPos.y / 5.0);
}
`;

export interface WindowMaterial {
  material: MeshStandardMaterial;
  set(intensity: number): void;
  setFloors(share: number): void;
}

/** Patch a building material so it can show lit windows; returns a switch for them. */
export function withWindows(
  material: MeshStandardMaterial,
  style: WindowStyle,
  ground: GroundLightUniforms,
): WindowMaterial {
  const uniforms = {
    ...ground,
    uWindows: { value: 0 },
    uWinFrame: { value: new Vector2(style.frameU, style.frameV) },
    uWinGlass: { value: style.glass },
    uWinFloors: { value: 0.35 },
  };
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_DECL}`)
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_DECL}`)
      .replace("#include <emissivemap_fragment>", FRAGMENT_BODY);
  };
  material.customProgramCacheKey = () => `windows-${style.frameU}-${style.frameV}-${style.glass}`;
  material.needsUpdate = true;
  return {
    material,
    set(intensity: number) {
      uniforms.uWindows.value = intensity;
    },
    setFloors(share: number) {
      uniforms.uWinFloors.value = share;
    },
  };
}
