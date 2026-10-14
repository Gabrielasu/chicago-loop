/**
 * The Chicago River as a mirror: a planar reflection of the city on the water,
 * with slow ripples and, at night, the long vertical streaks that lit windows
 * and bridge lamps leave on moving water. Reflection is stronger at grazing
 * angles (Fresnel), so from above the river stays dark and from the riverbank
 * it shows the towers.
 *
 * Only on the high quality path: it renders the scene a second time at half
 * resolution, and only while the river is on screen.
 */

import { Color, type Mesh, type Object3D, Vector2 } from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { type Light, lerp, mix } from "./light.ts";

const WaterShader = {
  name: "RiverShader",
  uniforms: {
    color: { value: null as Color | null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uStrength: { value: 0.4 },
    uStreak: { value: 0 },
    uTime: { value: 0 },
    uTexel: { value: new Vector2(1 / 1024, 1 / 1024) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform float uStreak;
    uniform float uTime;
    uniform vec2 uTexel;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec3 p = vWorld;
      // Slow ripples: a few crossing waves; fade with distance so far water stays calm.
      float dist = length(cameraPosition - p);
      float k = 1.0 / (1.0 + dist / 400.0);
      // Several small waves at unrelated angles and speeds: no visible pattern repeats.
      vec2 ripple = vec2(0.0);
      ripple += vec2(sin(dot(p.xz, vec2(0.83, 0.21)) + uTime * 1.3), cos(dot(p.xz, vec2(0.17, 0.91)) - uTime * 1.1));
      ripple += vec2(sin(dot(p.xz, vec2(-1.37, 0.62)) - uTime * 1.7), cos(dot(p.xz, vec2(1.11, 1.43)) + uTime * 1.5)) * 0.6;
      ripple += vec2(sin(dot(p.xz, vec2(2.9, -1.7)) + uTime * 2.3), cos(dot(p.xz, vec2(-2.1, 3.3)) - uTime * 2.1)) * 0.35;
      ripple *= 0.0011 * k;
      vec2 uv = vUv.xy / vUv.w + ripple;
      vec3 refl = texture2D(tDiffuse, uv).rgb;
      // Night: lights on moving water stretch into vertical streaks below their source.
      if (uStreak > 0.0) {
        vec3 streak = vec3(0.0);
        float wsum = 0.0;
        for (int i = 1; i <= 6; i++) {
          float w = 1.0 / float(i);
          streak += texture2D(tDiffuse, uv + vec2(0.0, float(i) * uTexel.y * 7.0)).rgb * w;
          streak += texture2D(tDiffuse, uv - vec2(0.0, float(i) * uTexel.y * 7.0)).rgb * w;
          wsum += 2.0 * w;
        }
        refl = mix(refl, max(refl, streak / wsum * 1.4), uStreak);
      }
      vec3 v = normalize(cameraPosition - p);
      float fresnel = mix(0.18, 1.0, pow(1.0 - clamp(v.y, 0.0, 1.0), 3.0));
      vec3 c = mix(color, refl, fresnel * uStrength);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export class River {
  private readonly reflector: Reflector;
  private readonly uniforms: typeof WaterShader.uniforms;

  private strength = 0.4;
  private reflecting = true;

  private constructor(reflector: Reflector) {
    this.reflector = reflector;
    this.uniforms = (reflector.material as unknown as { uniforms: typeof WaterShader.uniforms }).uniforms;
    // Seen from high above the water reflects little; skip the second render of the city then.
    const render = reflector.onBeforeRender.bind(reflector);
    reflector.onBeforeRender = (...args) => {
      if (this.reflecting) render(...args);
    };
  }

  /** Replace the flat water mesh of the model with a reflecting one. Null if there is no water. */
  static fromModel(root: Object3D, pixelWidth: number, pixelHeight: number): River | null {
    let water: Mesh | null = null;
    root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && (m.name === "river_water" || m.parent?.name === "river_water")) water = m;
    });
    if (!water) return null;
    const flat = water as Mesh;
    flat.updateWorldMatrix(true, false);
    const geometry = flat.geometry.clone().applyMatrix4(flat.matrixWorld);
    geometry.computeBoundingBox();
    const level = geometry.boundingBox!.max.y;
    // The reflector's plane is its local z = 0, facing +z: lay the river into that plane.
    geometry.translate(0, -level, 0);
    geometry.rotateX(Math.PI / 2);
    const reflector = new Reflector(geometry, {
      textureWidth: Math.round(pixelWidth / 2),
      textureHeight: Math.round(pixelHeight / 2),
      clipBias: 0.003,
      multisample: 0,
      shader: WaterShader,
    });
    reflector.name = "river_reflection";
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.y = level;
    reflector.receiveShadow = false;
    flat.visible = false;
    flat.parent!.add(reflector);
    const river = new River(reflector);
    river.uniforms.uTexel.value.set(2 / pixelWidth, 2 / pixelHeight);
    return river;
  }

  setLight(l: Light): void {
    // Deep green-grey river by day (the Chicago River is famously green), near black at night.
    const c = mix(mix([0.16, 0.2, 0.19], [0.2, 0.17, 0.15], l.golden), [0.004, 0.006, 0.009], l.night);
    this.uniforms.color.value = new Color().setRGB(c[0], c[1], c[2]);
    this.strength = lerp(lerp(0.45, 0.6, l.golden), 0.95, l.night);
    this.uniforms.uStrength.value = this.reflecting ? this.strength : 0;
    this.uniforms.uStreak.value = l.night;
  }

  update(seconds: number, cameraHeight: number): void {
    this.uniforms.uTime.value = seconds;
    // Fade the reflection out between 350 and 450 m up, then stop rendering it.
    const k = Math.min(Math.max((450 - cameraHeight) / 100, 0), 1);
    this.reflecting = k > 0;
    this.uniforms.uStrength.value = this.strength * k;
  }

  setSize(pixelWidth: number, pixelHeight: number): void {
    this.reflector.getRenderTarget().setSize(Math.round(pixelWidth / 2), Math.round(pixelHeight / 2));
    this.uniforms.uTexel.value.set(2 / pixelWidth, 2 / pixelHeight);
  }
}
