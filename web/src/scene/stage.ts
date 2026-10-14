/** Renderer, camera, light, controls and post-processing. */

import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Fog,
  DirectionalLight,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  HalfFloatType,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { toScene } from "../data/frame.ts";
import { type Light, lerp, mix, type RGB } from "./light.ts";
import { Sky } from "./sky.ts";

// Linear RGB for the hemisphere sky, sRGB for the backdrop.
const SKY: Record<"day" | "golden" | "dusk" | "night", RGB> = {
  day: [0.66, 0.73, 0.84],
  golden: [0.42, 0.5, 0.7],
  dusk: [0.16, 0.2, 0.36],
  night: [0.07, 0.085, 0.14],
};

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
  private bloom: UnrealBloomPass | null = null;
  private sunDir = sunDirection(242, 34);
  private sunAz = 242;
  private sunEl = 34;

  /**
   * Put the day sun where the real sun is. A very low sun would leave the model
   * almost entirely in shadow, so the light stays at least 14 degrees up (6 at
   * golden hour); the direction still follows the real azimuth.
   */
  setSun(azimuth: number, elevation: number): void {
    this.sunAz = azimuth;
    this.sunEl = elevation;
    this.setLight(this.light);
  }

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
    // A soft studio environment: gentler shading on the volumes and something for the glass to reflect.
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    if (quality === "high") {
      // The composer renders into its own targets, which lose the canvas's antialiasing; give them MSAA.
      const target = new WebGLRenderTarget(1, 1, { samples: 4, type: HalfFloatType });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.gtao.updateGtaoMaterial({ radius: 6, distanceExponent: 1.5, thickness: 4, scale: 1 });
      this.gtao.blendIntensity = 0.55;
      this.composer.addPass(this.gtao);
      // Night only: a soft halo around lit windows, platforms and trains.
      this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.35, 0.4, 0.85);
      this.bloom.enabled = false;
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    this.scene.fog = this.fog;
    this.scene.add(this.skyDome.mesh);
    this.setLight(this.light);
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  /** The light now on the scene (see light.ts). */
  light: Light = { night: 0, golden: 0 };

  /**
   * Light the scene for a blend of day, golden hour, dusk and night. Called every
   * frame while a change eases in; it only touches numbers, never recompiles.
   */
  setLight(l: Light): void {
    this.light = l;
    const { night, golden } = l;
    // Sky and backdrop: neutral by day, warm haze when golden, deep blue at dusk, near black at night.
    const sky = night < 0.5 ? mix(mix(SKY.day, SKY.golden, golden), SKY.dusk, night * 2) : mix(SKY.dusk, SKY.night, night * 2 - 1);
    this.skyDome.setLight(l, this.fog.color);
    this.sky.color.setRGB(...sky);
    this.sky.groundColor.setRGB(...mix([0.42, 0.41, 0.39], [0.05, 0.04, 0.03], night));
    this.sky.intensity = lerp(lerp(1.25, 0.85, golden), 1.6, night);

    // The sun: the real one, kept above 14 degrees by day but allowed down to 6 when golden
    // (long shadows), turning to a faint cool moonlight from the south-east at night.
    const el = Math.max(this.sunEl, lerp(14, 9, golden));
    const sunDir = sunDirection(this.sunAz, el);
    this.sunDir = sunDir.lerp(sunDirection(140, 50), night).normalize();
    this.sun.color.setRGB(...mix(mix([1.0, 0.96, 0.9], [1.0, 0.55, 0.28], golden), [0.62, 0.72, 1.0], night));
    this.sun.intensity = lerp(lerp(5.2, 7.5, golden), 0.35, night);
    this.scene.environmentIntensity = lerp(lerp(0.18, 0.08, golden), 0.04, night);
    // Exposure opens up only late in the dusk, so the blue hour stays dark and rich.
    this.renderer.toneMappingExposure = lerp(lerp(1.05, 1.0, golden), 1.25, night * night);
    if (this.bloom) {
      this.bloom.enabled = night > 0.15;
      this.bloom.strength = 0.35 * night;
    }
    if (this.gtao) this.gtao.blendIntensity = lerp(0.55, 0.25, night);
    const center = new Vector3(...toScene(-180, -80, 0));
    this.sun.position.copy(center).addScaledVector(this.sunDir, 3000);
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
  }

  private readonly skyDome = new Sky();
  /** Distance haze in the backdrop color: the far side of the model settles into the background. */
  private readonly fog = new Fog(0xe3e3e1, 1000, 6000);

  private fitFog(): void {
    const d = this.camera.position.distanceTo(this.controls.target);
    this.fog.near = d * 1.15;
    this.fog.far = d * 9 + 600;
  }


  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w, h);
    this.gtao?.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }

  /** Call after changing the camera's near, far or field of view. */
  cameraChanged(): void {
    this.camera.updateProjectionMatrix();
  }

  /**
   * Fit the shadow map to what the camera looks at: a box around the orbit
   * target sized by the viewing distance. Close up the L's girders and columns
   * cast crisp shadows; from the overview the box covers the whole model.
   * Snapped to shadow texels so shadows do not shimmer as the camera moves.
   */
  private fitShadows(): void {
    const target = this.controls.target;
    const distance = this.camera.position.distanceTo(target);
    // Sizes in steps of 25 %, so zooming does not make shadow edges crawl every frame.
    const wanted = Math.min(Math.max(distance * 0.9, 140), 1250);
    const half = Math.min(140 * 1.25 ** Math.ceil(Math.log(wanted / 140) / Math.log(1.25)), 1250);
    const cam = this.sun.shadow.camera;
    const texel = (2 * half) / this.sun.shadow.mapSize.x;
    const center = new Vector3(Math.round(target.x / texel) * texel, 0, Math.round(target.z / texel) * texel);
    if (cam.right !== half) {
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.updateProjectionMatrix();
    }
    this.sun.position.copy(center).addScaledVector(this.sunDir, 3000);
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
    this.sun.shadow.normalBias = Math.max(0.15, half / 1250);
  }

  size(): Vector2 {
    return this.renderer.getSize(new Vector2());
  }

  /**
   * Near plane in step with the viewing distance: depth precision depends on it,
   * and a near plane of 1 m seen from 2 km away makes thin layers shimmer.
   * Street level and riding keep their own close near plane.
   */
  nearFollowsDistance = true;
  private fitNear(): void {
    if (!this.nearFollowsDistance) return;
    const d = this.camera.position.distanceTo(this.controls.target);
    const near = Math.min(Math.max(2 ** Math.round(Math.log2(Math.max(d * 0.02, 0.5))), 0.5), 32);
    if (near !== this.camera.near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Keep the frame rate up on slower machines: if frames take longer than
   * about 20 ms for two seconds, first drop ambient occlusion, then lower the
   * pixel ratio. Each step is taken once and logged.
   */
  private frameTimes: number[] = [];
  private lastFrame = 0;
  private slowSince = 0;
  readonly degraded: string[] = [];
  private adapt(now: number): void {
    if (this.lastFrame) {
      this.frameTimes.push(now - this.lastFrame);
      if (this.frameTimes.length > 60) this.frameTimes.shift();
    }
    this.lastFrame = now;
    if (this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    if (avg < 20) {
      this.slowSince = 0;
      return;
    }
    if (!this.slowSince) this.slowSince = now;
    if (now - this.slowSince < 2000) return;
    this.slowSince = 0;
    this.frameTimes = [];
    if (this.gtao?.enabled) {
      this.gtao.enabled = false;
      this.degraded.push("ambient occlusion off");
    } else if (this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(Math.max(1, this.renderer.getPixelRatio() - 0.5));
      this.resize();
      this.degraded.push(`pixel ratio ${this.renderer.getPixelRatio()}`);
    } else {
      return;
    }
    console.info(`Chicago Loop: running slowly, ${this.degraded.at(-1)}`);
  }

  render(): void {
    this.adapt(performance.now());
    // Disabled controls (riding a train) must not pull the camera back to their limits.
    if (this.controls.enabled) this.controls.update();
    this.fitNear();
    this.fitShadows();
    this.fitFog();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
