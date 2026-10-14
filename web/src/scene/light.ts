/**
 * The light of the scene as two numbers, so day, golden hour, dusk and night
 * blend into each other instead of switching:
 *
 *   night   0 in daylight, 1 at night; windows, platforms and trains glow with it
 *   golden  0 under a high sun, 1 when the sun is low; warms and lowers the sunlight
 */

export interface Light {
  night: number;
  golden: number;
}

export type LightMode = "auto" | "day" | "night";

export const DAY: Light = { night: 0, golden: 0 };
export const NIGHT: Light = { night: 1, golden: 0 };

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The light for a sun elevation in degrees. Golden as the sun drops below about
 * 16 degrees; night from just above the horizon to civil dusk (6 degrees below),
 * the blue hour in between.
 */
export function lightForSun(elevation: number): Light {
  const night = smoothstep(1.5, -6.5, elevation);
  const golden = smoothstep(16, 3, elevation) * (1 - night);
  return { night, golden };
}

export function lightFor(mode: LightMode, sunElevation: number): Light {
  if (mode === "day") return DAY;
  if (mode === "night") return NIGHT;
  return lightForSun(sunElevation);
}

/** Move `from` toward `to` with a time constant of `tau` seconds. */
export function approach(from: Light, to: Light, dt: number, tau = 0.45): Light {
  const k = 1 - Math.exp(-dt / tau);
  return { night: from.night + (to.night - from.night) * k, golden: from.golden + (to.golden - from.golden) * k };
}

export function closeTo(a: Light, b: Light, eps = 0.002): boolean {
  return Math.abs(a.night - b.night) < eps && Math.abs(a.golden - b.golden) < eps;
}

export type RGB = [number, number, number];

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
