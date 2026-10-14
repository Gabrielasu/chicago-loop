/**
 * Material colors for the day and night model, in linear RGB.
 * Mirrors blender/looks.py so the viewer matches the renders.
 */

export type Theme = "day" | "night";
type RGB = [number, number, number];

export interface MaterialLook {
  day: RGB;
  night: RGB;
  roughness: number;
  metalness: number;
  /** Night emission: color and intensity */
  glow?: [RGB, number];
}

export const MATERIALS: Record<string, MaterialLook> = {
  ground: {
    day: [0.62, 0.615, 0.6],
    night: [0.03, 0.031, 0.034],
    roughness: 0.95,
    metalness: 0,
    glow: [[1.0, 0.8, 0.6], 0.006],
  },
  street: {
    day: [0.55, 0.55, 0.545],
    night: [0.02, 0.021, 0.024],
    roughness: 0.9,
    metalness: 0,
    glow: [[1.0, 0.78, 0.55], 0.022],
  },
  marking: {
    day: [0.74, 0.74, 0.73],
    night: [0.045, 0.046, 0.05],
    roughness: 0.9,
    metalness: 0,
    glow: [[1.0, 0.85, 0.65], 0.09],
  },
  park: { day: [0.52, 0.535, 0.5], night: [0.026, 0.028, 0.029], roughness: 0.95, metalness: 0 },
  water: { day: [0.27, 0.31, 0.33], night: [0.008, 0.01, 0.013], roughness: 0.12, metalness: 0 },
  bridge: { day: [0.5, 0.5, 0.49], night: [0.03, 0.03, 0.033], roughness: 0.85, metalness: 0 },
  massing_white: { day: [0.8, 0.785, 0.75], night: [0.05, 0.05, 0.054], roughness: 0.88, metalness: 0 },
  massing_grey: { day: [0.64, 0.64, 0.635], night: [0.04, 0.04, 0.044], roughness: 0.88, metalness: 0 },
  massing_glass: { day: [0.38, 0.42, 0.44], night: [0.025, 0.028, 0.032], roughness: 0.15, metalness: 0.55 },
  steel: { day: [0.016, 0.016, 0.018], night: [0.012, 0.012, 0.014], roughness: 0.55, metalness: 0.35 },
  rail: { day: [0.22, 0.22, 0.22], night: [0.1, 0.1, 0.1], roughness: 0.35, metalness: 1 },
  platform: {
    day: [0.58, 0.58, 0.565],
    night: [0.07, 0.065, 0.06],
    roughness: 0.9,
    metalness: 0,
    glow: [[1.0, 0.84, 0.66], 0.45],
  },
  platform_edge: {
    day: [0.9, 0.9, 0.88],
    night: [0.3, 0.28, 0.25],
    roughness: 0.8,
    metalness: 0,
    glow: [[1.0, 0.88, 0.7], 0.8],
  },
  platform_light: {
    day: [0.02, 0.02, 0.022],
    night: [0.02, 0.02, 0.02],
    roughness: 0.6,
    metalness: 0,
    glow: [[1.0, 0.8, 0.58], 1.1],
  },
  train_window: {
    day: [0.035, 0.038, 0.042],
    night: [0.05, 0.05, 0.05],
    roughness: 0.15,
    metalness: 0,
    glow: [[1.0, 0.93, 0.82], 1.4],
  },
};

/** CTA line colors (sRGB hex), exact. */
export const LINE_COLORS: Record<string, string> = {
  brn: "#62361B",
  g: "#009B3A",
  org: "#F9461C",
  p: "#522398",
  pink: "#E27EA6",
};

export const LINE_NAMES: Record<string, string> = {
  brn: "Brown",
  g: "Green",
  org: "Orange",
  p: "Purple",
  pink: "Pink",
};

/** Backdrop behind the model, sRGB. */
export const BACKGROUND: Record<Theme, string> = { day: "#e3e3e1", night: "#121316" };
