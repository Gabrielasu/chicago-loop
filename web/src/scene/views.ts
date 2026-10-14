/**
 * Camera: the preset views, free orbit with keyboard and double-click to fly,
 * a street level walk on Wabash, and following or riding a train.
 */

import { type Object3D, Raycaster, Vector2, Vector3 } from "three";
import { network } from "@chicago-loop/mock/network";
import { toScene } from "../data/frame.ts";
import type { Stage } from "./stage.ts";

export type ViewName = "overview" | "tower18" | "wabash";
export type CameraMode = ViewName | "free" | "follow" | "ride";

interface ViewDef {
  label: string;
  position: [number, number, number];
  target: [number, number, number];
  street: boolean;
}

const station = (name: string) => network.stations.find((s) => s.name === name)!.location;
const tower18 = network.junctions.find((j) => j.name === "Tower 18")!.location;
const adamsWabash = station("Adams/Wabash");
const washWabash = station("Washington/Wabash");
const tz = network.trackZ;

export const VIEWS: Record<ViewName, ViewDef> = {
  overview: {
    label: "Overview",
    position: toScene(-150, -1420, 1320),
    target: toScene(-170, -40, 0),
    street: false,
  },
  tower18: {
    label: "Tower 18",
    position: toScene(tower18[0] + 6, tower18[1] - 70, 300),
    target: toScene(tower18[0], tower18[1], tz),
    street: false,
  },
  wabash: {
    label: "Wabash",
    position: toScene(adamsWabash[0] - 7, (adamsWabash[1] + washWabash[1]) / 2 - 70, 1.65),
    target: toScene(washWabash[0] - 2.5, washWabash[1] + 90, 8),
    street: true,
  },
};

/** Where the followed train is: its head and the direction it travels, in scene space. */
export interface TrainSight {
  head: Vector3;
  forward: Vector3;
}

const EYE = 1.65;
const DOWN = new Vector3(0, -1, 0);
const IDLE_AFTER = 25;
const DRIFT_SPEED = (2 * Math.PI) / 360; // radians per second
const WALK = 4.5; // m/s, a brisk walk
const RUN = 14;
/** Eye height in the cab above the top of rail */
const CAB_EYE = 2.75;

export class ViewController {
  current: CameraMode = "overview";
  following: string | null = null;
  private tween: { from: [Vector3, Vector3]; to: [Vector3, Vector3]; start: number; duration: number } | null = null;
  private keys = new Set<string>();
  private listeners: ((v: CameraMode) => void)[] = [];
  private rideForward = new Vector3(1, 0, 0);
  private lastHead: Vector3 | null = null;
  private sightCheck = 0;
  private readonly ray = new Raycaster();
  private readonly bounds: { min: Vector2; max: Vector2 };
  /** Seconds since the last input; after IDLE_AFTER the overview starts to drift. */
  private idle = 0;
  private drift = 0;
  /** Meshes the walker cannot pass through and double-click can land on. */
  solids: Object3D[] = [];

  constructor(private readonly stage: Stage) {
    const [x0, y0, x1, y1] = network.bounds;
    // Scene x is local x, scene z is local -y.
    this.bounds = { min: new Vector2(x0, -y1), max: new Vector2(x1, -y0) };
    window.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement) return;
      if (/^(Arrow|Key[WASDQE]$|Equal|Minus|ShiftLeft|ShiftRight)/.test(e.code)) {
        this.keys.add(e.code);
        if (e.code.startsWith("Arrow")) e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    stage.controls.addEventListener("start", () => {
      this.tween = null;
      if (this.current === "overview" || this.current === "tower18") this.setCurrent("free");
    });
    stage.renderer.domElement.addEventListener("dblclick", (e) => this.flyToPointer(e));
    for (const type of ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"]) {
      window.addEventListener(type, () => {
        this.idle = 0;
        this.drift = 0;
      }, { passive: true });
    }
  }

  onChange(listener: (v: CameraMode) => void): void {
    this.listeners.push(listener);
  }

  private setCurrent(v: CameraMode): void {
    this.current = v;
    for (const l of this.listeners) l(v);
  }

  isStreet(): boolean {
    return this.current === "wabash";
  }

  private reducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private moveTo(pos: Vector3, target: Vector3, instant = false, duration = 1400): void {
    if (instant || this.reducedMotion()) {
      this.tween = null;
      this.stage.camera.position.copy(pos);
      this.stage.controls.target.copy(target);
      return;
    }
    this.tween = {
      from: [this.stage.camera.position.clone(), this.stage.controls.target.clone()],
      to: [pos, target],
      start: performance.now(),
      duration,
    };
  }

  go(name: ViewName, instant = false): void {
    this.following = null;
    const def = VIEWS[name];
    let toTarget = new Vector3(...def.target);
    const toPos = new Vector3(...def.position);
    if (!def.street) {
      // Views are framed for a 16:9 screen; on narrow screens step back so the Loop still fits.
      const aspect = this.stage.camera.aspect || 16 / 9;
      const factor = Math.max(1, (1.6 / aspect) ** 0.5);
      toPos.sub(toTarget).multiplyScalar(factor).add(toTarget);
    } else {
      // Look-around: orbit a point just ahead of the eye.
      toTarget = toPos.clone().add(toTarget.sub(toPos).normalize().multiplyScalar(0.5));
    }
    this.configure(def.street ? "street" : "orbit");
    this.moveTo(toPos, toTarget, instant);
    this.setCurrent(name);
  }

  /** Glide the view so it looks at a ground point, keeping the current angle and distance. */
  lookAt(point: Vector3): void {
    if (this.current === "ride" || this.isStreet()) this.go("overview");
    this.following = null;
    const c = this.stage.controls;
    const offset = this.stage.camera.position.clone().sub(c.target);
    const target = point.clone().setY(c.target.y);
    this.configure("orbit");
    this.moveTo(target.clone().add(offset), target, false, 900);
    this.setCurrent("free");
  }

  /** Follow a train from behind and above; orbit and zoom stay free around it. */
  follow(key: string, sight: TrainSight | null): void {
    this.following = key;
    this.lastHead = null;
    this.configure("follow");
    if (sight) {
      const target = sight.head.clone().addScaledVector(sight.forward, -45).setY(tz);
      this.moveTo(this.clearVantage(target, sight.forward), target, false, 1200);
      this.lastHead = sight.head.clone();
    }
    this.setCurrent("follow");
  }

  /**
   * A camera position looking at `target` with nothing in between: behind the
   * train and to one side first, then higher, then straight down.
   */
  private clearVantage(target: Vector3, forward: Vector3): Vector3 {
    const back = forward.clone().negate().setY(0).normalize();
    const distance = 150;
    for (const pitch of [38, 52, 66, 80]) {
      for (const turn of [35, -35, 0, 90, -90]) {
        const dir = back.clone().applyAxisAngle(new Vector3(0, 1, 0), (turn * Math.PI) / 180);
        const p = (pitch * Math.PI) / 180;
        const offset = dir.multiplyScalar(Math.cos(p)).add(new Vector3(0, Math.sin(p), 0)).multiplyScalar(distance);
        if (this.clear(target, offset)) return target.clone().add(offset);
      }
    }
    return target.clone().add(new Vector3(0, 320, 0.01));
  }

  /** True if nothing solid lies between target and target + offset. */
  private clear(target: Vector3, offset: Vector3): boolean {
    if (!this.solids.length) return true;
    this.ray.set(target.clone().add(new Vector3(0, 4, 0)), offset.clone().normalize());
    this.ray.far = offset.length();
    return this.ray.intersectObjects(this.solids, true).length === 0;
  }

  /** While following, lift the camera over anything that comes between it and the train. */
  private keepInSight(dt: number): void {
    const c = this.stage.controls;
    const cam = this.stage.camera;
    const offset = cam.position.clone().sub(c.target);
    if (this.clear(c.target, offset)) return;
    const horizontal = Math.hypot(offset.x, offset.z);
    const pitch = Math.atan2(offset.y, horizontal);
    if (pitch > Math.PI * 0.47) return;
    const next = Math.min(pitch + dt * 1.2, Math.PI * 0.47);
    const len = offset.length();
    const h = new Vector3(offset.x, 0, offset.z).normalize().multiplyScalar(Math.cos(next) * len);
    cam.position.copy(c.target).add(h.setY(Math.sin(next) * len));
  }

  /** Ride at the front of a train, looking down the track. */
  ride(key: string, sight: TrainSight | null): void {
    this.following = key;
    this.lastHead = null;
    this.configure("ride");
    if (sight) this.rideForward.copy(sight.forward);
    this.tween = null;
    this.setCurrent("ride");
  }

  stopFollowing(): void {
    if (!this.following) return;
    this.following = null;
    const wasRiding = this.current === "ride";
    this.configure("orbit");
    if (wasRiding) {
      // Lift off the track to a view over the area the train was in.
      const target = this.stage.camera.position.clone().addScaledVector(this.rideForward, 80).setY(0);
      const pos = target.clone().addScaledVector(this.rideForward, -260).add(new Vector3(0, 220, 0));
      this.moveTo(pos, target, false, 1200);
    } else {
      this.stage.controls.target.y = 0;
    }
    this.setCurrent("free");
  }

  private configure(mode: "orbit" | "street" | "follow" | "ride"): void {
    const c = this.stage.controls;
    const street = mode === "street";
    c.enabled = mode !== "ride";
    c.enableZoom = !street;
    c.enablePan = mode === "orbit";
    c.zoomToCursor = mode === "orbit";
    c.rotateSpeed = street ? -0.35 : 0.9;
    c.minDistance = street ? 0.1 : mode === "follow" ? 15 : 20;
    c.maxDistance = mode === "follow" ? 900 : 6000;
    c.maxPolarAngle = street ? Math.PI * 0.9 : Math.PI * 0.485;
    c.minPolarAngle = street ? Math.PI * 0.1 : 0;
    this.stage.camera.near = street || mode === "ride" ? 0.1 : mode === "follow" ? 0.5 : 1;
    this.stage.nearFollowsDistance = !street && mode !== "ride";
    this.stage.camera.fov = street ? 62 : mode === "ride" ? 68 : 38;
    this.stage.cameraChanged();
  }

  /** Double-click: fly toward the point under the pointer. */
  private flyToPointer(e: MouseEvent): void {
    if (this.current === "ride" || this.isStreet() || !this.solids.length) return;
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    const p = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(p, this.stage.camera);
    this.ray.far = Infinity;
    const hit = this.ray.intersectObjects(this.solids, true)[0];
    if (!hit) return;
    const cam = this.stage.camera.position;
    const dir = cam.clone().sub(this.stage.controls.target).normalize();
    const distance = Math.max(Math.min(cam.distanceTo(hit.point) * 0.45, 600), 70);
    this.following = null;
    this.configure("orbit");
    this.moveTo(hit.point.clone().addScaledVector(dir, distance), hit.point.clone(), false, 1000);
    this.setCurrent("free");
  }

  update(dt: number, sight: TrainSight | null): void {
    const cam = this.stage.camera;
    const c = this.stage.controls;
    if (this.tween) {
      const t = Math.min((performance.now() - this.tween.start) / this.tween.duration, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      cam.position.lerpVectors(this.tween.from[0], this.tween.to[0], e);
      c.target.lerpVectors(this.tween.from[1], this.tween.to[1], e);
      if (t >= 1) this.tween = null;
    }

    if (this.following && !sight) {
      // The train has left the model.
      this.stopFollowing();
    } else if (this.current === "follow" && sight) {
      // Carry the camera along with the train; the user still orbits and zooms.
      if (this.lastHead) {
        const delta = sight.head.clone().sub(this.lastHead);
        if (delta.length() < 50) {
          cam.position.add(delta);
          c.target.add(delta);
          if (this.tween) {
            for (const v of [...this.tween.from, ...this.tween.to]) v.add(delta);
          }
        }
      }
      this.lastHead = sight.head.clone();
      this.sightCheck += dt;
      if (this.sightCheck > 0.1 && !this.tween) {
        this.keepInSight(this.sightCheck);
        this.sightCheck = 0;
      }
    } else if (this.current === "ride" && sight) {
      // Smooth the view direction so segment corners in the track do not jolt the camera.
      const k = 1 - Math.exp(-dt * 3);
      this.rideForward.lerp(sight.forward, k).normalize();
      // The driver's seat, a meter behind the front window; the car's own body is not drawn from inside.
      cam.position.copy(sight.head).addScaledVector(sight.forward, -1.0).add(new Vector3(0, CAB_EYE, 0));
      c.target.copy(cam.position).addScaledVector(this.rideForward, 40).add(new Vector3(0, -1.6, 0));
      cam.lookAt(c.target);
    }

    if (this.keys.size) this.keyboard(dt);
    this.idleDrift(dt);
    if (this.current !== "ride") this.clamp();
  }

  /**
   * Left alone, the overview turns slowly around its target, like a model on a
   * turntable: about one turn in six minutes, easing in. Any input stops it.
   */
  private idleDrift(dt: number): void {
    this.idle += dt;
    const allowed =
      (this.current === "overview" || this.current === "free" || this.current === "tower18") &&
      !this.tween &&
      !this.reducedMotion() &&
      document.visibilityState === "visible";
    if (!allowed || this.idle < IDLE_AFTER) {
      this.drift = 0;
      return;
    }
    this.drift = Math.min(this.drift + dt / 4, 1);
    const c = this.stage.controls;
    const offset = this.stage.camera.position.clone().sub(c.target);
    offset.applyAxisAngle(new Vector3(0, 1, 0), DRIFT_SPEED * this.drift * dt);
    this.stage.camera.position.copy(c.target).add(offset);
  }

  private keyboard(dt: number): void {
    const cam = this.stage.camera;
    const c = this.stage.controls;
    const fast = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const forward = c.target.clone().sub(cam.position).setY(0);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const right = new Vector3(-forward.z, 0, forward.x);
    const step = new Vector3();
    if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) step.add(forward);
    if (this.keys.has("ArrowDown") || this.keys.has("KeyS")) step.sub(forward);
    if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) step.add(right);
    if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) step.sub(right);

    if (this.isStreet()) {
      if (step.lengthSq() === 0) return;
      step.normalize().multiplyScalar((fast ? RUN : WALK) * dt);
      if (this.blocked(cam.position, step)) return;
      cam.position.add(step);
      cam.position.y = EYE;
      c.target.add(step);
      return;
    }
    if (this.current === "ride") return;

    // Orbit: pan over the ground at a speed that scales with height, rotate with Q and E, zoom with + and -.
    const distance = cam.position.distanceTo(c.target);
    if (step.lengthSq() > 0 && this.current !== "follow") {
      step.normalize().multiplyScalar(distance * (fast ? 1.6 : 0.6) * dt);
      cam.position.add(step);
      c.target.add(step);
      if (this.current !== "free") this.setCurrent("free");
    }
    const turn = (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0);
    if (turn) {
      const offset = cam.position.clone().sub(c.target);
      offset.applyAxisAngle(new Vector3(0, 1, 0), turn * dt * 0.9);
      cam.position.copy(c.target).add(offset);
    }
    const zoom = (this.keys.has("Minus") ? 1 : 0) - (this.keys.has("Equal") ? 1 : 0);
    if (zoom) {
      const offset = cam.position.clone().sub(c.target);
      const len = Math.min(Math.max(offset.length() * Math.exp(zoom * dt * 1.2), c.minDistance), c.maxDistance);
      cam.position.copy(c.target).add(offset.setLength(len));
    }
  }

  /** True if walking `step` from `from` would go into a building or the L. */
  private blocked(from: Vector3, step: Vector3): boolean {
    if (!this.solids.length) return false;
    for (const h of [0.4, 1.5]) {
      this.ray.set(new Vector3(from.x, h, from.z), step.clone().normalize());
      this.ray.far = step.length() + 0.45;
      if (this.ray.intersectObjects(this.solids, true).length) return true;
    }
    return false;
  }

  /** Keep the camera over the model and above the ground. */
  private clamp(): void {
    const c = this.stage.controls;
    const cam = this.stage.camera;
    const { min, max } = this.bounds;
    const margin = this.isStreet() ? -2 : 150;
    const tx = Math.min(Math.max(c.target.x, min.x - margin), max.x + margin);
    const tz = Math.min(Math.max(c.target.z, min.y - margin), max.y + margin);
    if (tx !== c.target.x || tz !== c.target.z) {
      const dx = tx - c.target.x;
      const dz = tz - c.target.z;
      c.target.x += dx;
      c.target.z += dz;
      cam.position.x += dx;
      cam.position.z += dz;
    }
    if (!this.isStreet() && cam.position.y < 3) cam.position.y = 3;
    if (!this.isStreet()) this.liftOutOfBuildings();
  }

  /**
   * Never let the camera end up inside a building: look straight down from
   * high above the eye; if the first roof found is above the eye, the eye is
   * under that roof, so it rises just over it.
   */
  private liftOutOfBuildings(): void {
    if (!this.solids.length) return;
    const cam = this.stage.camera;
    this.ray.set(new Vector3(cam.position.x, 2000, cam.position.z), DOWN);
    this.ray.far = 2000 - cam.position.y;
    const hit = this.ray.intersectObjects(this.solids, true)[0];
    if (hit && hit.point.y > cam.position.y) cam.position.y = hit.point.y + 4;
  }

}
