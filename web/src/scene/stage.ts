/** Renderer, camera, light, controls and post-processing. */

import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { toScene } from "../data/frame.ts";
import { BACKGROUND, type Theme } from "./palette.ts";

export type Quality = "high" | "low";

export function detectQuality(): Quality {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const forced = new URLSearchParams(location.search).get("quality");
  if (forced === "high" || forced === "low") return forced;
  return coarse || small ? "low" : "high";
}

/** Direction toward the sun from compass azimuth and elevation, in scene axes. */
function sunDirection(azimuth: number, elevation: number): Vector3 {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const [x, y, z] = toScene(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
  return new Vector3(x, y, z).normalize();
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly sky = new HemisphereLight(0xffffff, 0xffffff, 1);
  private composer: EffectComposer | null = null;
  private gtao: GTAOPass | null = null;
  theme: Theme = "day";

  constructor(
    readonly container: HTMLElement,
    readonly quality: Quality,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === "high" ? 2 : 1.5));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = AgXToneMapping ?? ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(38, 1, 1, 20000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 6000;
    this.controls.screenSpacePanning = false;

    // Shadows over the whole model: an orthographic box around the Loop.
    const s = this.sun.shadow;
    s.mapSize.set(quality === "high" ? 4096 : 2048, quality === "high" ? 4096 : 2048);
    s.camera.left = -1150;
    s.camera.right = 1150;
    s.camera.top = 1150;
    s.camera.bottom = -1150;
    s.camera.near = 100;
    s.camera.far = 6000;
    s.bias = -0.0004;
    s.normalBias = 0.6;
    this.sun.castShadow = true;
    this.scene.add(this.sun, this.sun.target, this.sky);

    if (quality === "high") {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.gtao.updateGtaoMaterial({ radius: 6, distanceExponent: 1.5, thickness: 4, scale: 1 });
      this.gtao.blendIntensity = 0.55;
      this.composer.addPass(this.gtao);
      this.composer.addPass(new OutputPass());
    }

    this.setTheme("day");
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.scene.background = new Color(BACKGROUND[theme]);
    const center = new Vector3(...toScene(-180, -80, 0));
    if (theme === "day") {
      // Afternoon sun from the west-south-west, as in the renders.
      this.sun.position.copy(center).addScaledVector(sunDirection(242, 34), 3000);
      this.sun.color.setRGB(1.0, 0.96, 0.9);
      this.sun.intensity = 5.2;
      this.sky.color.setRGB(0.66, 0.73, 0.84);
      this.sky.groundColor.setRGB(0.5, 0.49, 0.47);
      this.sky.intensity = 1.7;
      this.renderer.toneMappingExposure = 1.15;
    } else {
      this.sun.position.copy(center).addScaledVector(sunDirection(140, 50), 3000);
      this.sun.color.setRGB(0.62, 0.72, 1.0);
      this.sun.intensity = 0.25;
      this.sky.color.setRGB(0.05, 0.06, 0.1);
      this.sky.groundColor.setRGB(0.02, 0.02, 0.025);
      this.sky.intensity = 1.0;
      this.renderer.toneMappingExposure = 1.4;
    }
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.gtao?.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }

  size(): Vector2 {
    return this.renderer.getSize(new Vector2());
  }

  render(): void {
    this.controls.update();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
