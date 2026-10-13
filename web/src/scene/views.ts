/**
 * Camera views: overview, Tower 18 and street level on Wabash, with smooth
 * transitions and a walk mode at street level.
 */

import { Vector3 } from "three";
import { network } from "@chicago-loop/mock/network";
import { toScene } from "../data/frame.ts";
import type { Stage } from "./stage.ts";

export type ViewName = "overview" | "tower18" | "wabash";

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

const EYE = 1.65;

export class ViewController {
  current: ViewName | "free" = "overview";
  private tween: { from: [Vector3, Vector3]; to: [Vector3, Vector3]; start: number; duration: number } | null = null;
  private keys = new Set<string>();
  private listeners: ((v: ViewName | "free") => void)[] = [];

  constructor(private readonly stage: Stage) {
    window.addEventListener("keydown", (e) => {
      if (this.isStreet() && !(e.target instanceof HTMLButtonElement) && /^(Arrow|Key[WASD])/.test(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    stage.controls.addEventListener("start", () => {
      this.tween = null;
      if (this.current !== "free" && !this.isStreet()) this.setCurrent("free");
    });
  }

  onChange(listener: (v: ViewName | "free") => void): void {
    this.listeners.push(listener);
  }

  private setCurrent(v: ViewName | "free"): void {
    this.current = v;
    for (const l of this.listeners) l(v);
  }

  isStreet(): boolean {
    return this.current === "wabash";
  }

  go(name: ViewName, instant = false): void {
    const def = VIEWS[name];
    const c = this.stage.controls;
    let toTarget = new Vector3(...def.target);
    const toPos = new Vector3(...def.position);
    if (!def.street) {
      // Views are framed for a 16:9 screen; on narrow screens step back so the Loop still fits.
      const aspect = this.stage.camera.aspect || 16 / 9;
      const factor = Math.max(1, (1.6 / aspect) ** 0.5);
      toPos.sub(toTarget).multiplyScalar(factor).add(toTarget);
    }
    if (def.street) {
      // Look-around: orbit a point just ahead of the eye.
      toTarget = toPos.clone().add(toTarget.sub(toPos).normalize().multiplyScalar(0.5));
    }
    this.configure(def.street);
    if (instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.stage.camera.position.copy(toPos);
      c.target.copy(toTarget);
    } else {
      this.tween = {
        from: [this.stage.camera.position.clone(), c.target.clone()],
        to: [toPos, toTarget],
        start: performance.now(),
        duration: 1400,
      };
    }
    this.setCurrent(name);
  }

  private configure(street: boolean): void {
    const c = this.stage.controls;
    c.enableZoom = !street;
    c.enablePan = !street;
    c.rotateSpeed = street ? -0.35 : 1;
    c.minDistance = street ? 0.1 : 20;
    c.maxPolarAngle = street ? Math.PI * 0.9 : Math.PI * 0.495;
    c.minPolarAngle = street ? Math.PI * 0.1 : 0;
    this.stage.camera.near = street ? 0.2 : 1;
    this.stage.camera.fov = street ? 62 : 38;
    this.stage.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    if (this.tween) {
      const t = Math.min((performance.now() - this.tween.start) / this.tween.duration, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      this.stage.camera.position.lerpVectors(this.tween.from[0], this.tween.to[0], e);
      this.stage.controls.target.lerpVectors(this.tween.from[1], this.tween.to[1], e);
      if (t >= 1) this.tween = null;
    }
    if (this.isStreet() && this.keys.size) {
      const cam = this.stage.camera;
      const forward = this.stage.controls.target.clone().sub(cam.position).setY(0).normalize();
      const right = new Vector3(-forward.z, 0, forward.x);
      const step = new Vector3();
      if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) step.add(forward);
      if (this.keys.has("ArrowDown") || this.keys.has("KeyS")) step.sub(forward);
      if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) step.add(right);
      if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) step.sub(right);
      if (step.lengthSq() > 0) {
        step.normalize().multiplyScalar(5 * dt);
        cam.position.add(step);
        cam.position.y = EYE;
        this.stage.controls.target.add(step);
      }
    }
  }
}
