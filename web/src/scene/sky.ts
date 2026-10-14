/**
 * The sky behind the model: a large dome with a vertical gradient. Neutral and
 * pale by day; at golden hour warm near the horizon; at night a deep blue with
 * the orange glow a city throws onto the low sky. The colors blend with the light.
 */

import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from "three";
import { type Light, mix, type RGB } from "./light.ts";

// sRGB: horizon and zenith for each light.
const HORIZON: Record<string, RGB> = {
  day: [0.9, 0.9, 0.89],
  golden: [0.96, 0.84, 0.72],
  dusk: [0.36, 0.34, 0.46],
  night: [0.085, 0.07, 0.075],
};
const ZENITH: Record<string, RGB> = {
  day: [0.84, 0.86, 0.88],
  golden: [0.66, 0.72, 0.82],
  dusk: [0.12, 0.16, 0.3],
  night: [0.018, 0.022, 0.04],
};

function blend(table: Record<string, RGB>, l: Light): RGB {
  const day = mix(table.day!, table.golden!, l.golden);
  return l.night < 0.5 ? mix(day, table.dusk!, l.night * 2) : mix(table.dusk!, table.night!, l.night * 2 - 1);
}

export class Sky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uHorizon: { value: new Color() }, uZenith: { value: new Color() } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        varying vec3 vDir;
        void main() {
          float h = max(vDir.y, 0.0);
          vec3 c = mix(uHorizon, uZenith, pow(h, 0.55));
          // Below the horizon the ground haze: the horizon color, a little darker.
          c = mix(c, uHorizon * 0.8, smoothstep(0.0, -0.25, vDir.y));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 32, 16), this.material);
    this.mesh.name = "sky";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.raycast = () => {};
    // Always centered on the camera, so it reads as infinitely far away.
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      this.mesh.position.copy(camera.position);
      this.mesh.updateMatrixWorld();
    };
  }

  /** The fog takes the horizon color, so far buildings melt into the sky. */
  setLight(l: Light, fogColor: Color): void {
    const horizon = new Color().setRGB(...blend(HORIZON, l), "srgb");
    const zenith = new Color().setRGB(...blend(ZENITH, l), "srgb");
    (this.material.uniforms.uHorizon!.value as Color).copy(horizon);
    (this.material.uniforms.uZenith!.value as Color).copy(zenith);
    fogColor.copy(horizon);
  }
}
