/**
 * Train markers: a square in the line's color over every train in the model,
 * with a short stroke pointing the way it is going. Markers stay on screen when
 * the train is hidden behind buildings (drawn lighter then), so it is always
 * clear where the trains are. Up close, where the train itself is plain to see,
 * its marker steps aside.
 */

import { type Camera, type Object3D, Raycaster, Vector3 } from "three";
import { toScreen } from "../scene/screen.ts";

export interface MarkerTrain {
  key: string;
  route: string;
  /** Scene position of the middle of the train, at roof height */
  middle: Vector3;
  /** Scene position of the head, for the direction stroke */
  head: Vector3;
  /** Train length in meters */
  length: number;
  label: string;
}

/** Screen length of a train below which its marker is shown, in pixels: up close the train speaks for itself. */
const SHOW_BELOW = 200;

export class TrainMarkers {
  private readonly pool = new Map<string, HTMLButtonElement>();
  private readonly ray = new Raycaster();
  private readonly hidden = new Map<string, boolean>();
  private checkIndex = 0;
  selected: string | null = null;
  enabled = true;

  constructor(
    private readonly layer: HTMLElement,
    private readonly colors: Record<string, string>,
    private readonly onSelect: (key: string) => void,
  ) {}

  update(trains: readonly MarkerTrain[], camera: Camera, occluders: Object3D[], w: number, h: number): void {
    const seen = new Set<string>();
    // Check a few trains per frame for buildings in the way.
    const toCheck = new Set<string>();
    if (trains.length) {
      for (let i = 0; i < Math.min(4, trains.length); i++) {
        toCheck.add(trains[(this.checkIndex + i) % trains.length]!.key);
      }
      this.checkIndex = (this.checkIndex + 4) % trains.length;
    }
    const placed: [number, number][] = [];
    for (const t of trains) {
      const mid = toScreen(t.middle, camera, w, h);
      const hd = toScreen(t.head, camera, w, h);
      const { x, y } = mid;
      const hx = hd.visible ? hd.x : x;
      const hy = hd.visible ? hd.y : y;
      const onScreen = mid.visible && x > -20 && x < w + 20 && y > -20 && y < h + 20;
      const screenLength = Math.hypot(hx - x, hy - y) * 2;
      if (!onScreen || (!this.enabled && t.key !== this.selected)) continue;

      if (toCheck.has(t.key)) {
        const from = camera.getWorldPosition(new Vector3());
        const dir = t.middle.clone().sub(from);
        const dist = dir.length();
        this.ray.set(from, dir.normalize());
        this.ray.far = dist - 4;
        this.hidden.set(t.key, this.ray.intersectObjects(occluders, true).length > 0);
      }
      const behind = this.hidden.get(t.key) ?? false;
      const selected = t.key === this.selected;
      if (screenLength > SHOW_BELOW && !behind && !selected) continue;

      let el = this.pool.get(t.key);
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.className = "train-marker";
        // Out of the tab order: markers come and go every second. The legend and the plan reach the same trains.
        el.tabIndex = -1;
        el.addEventListener("click", () => this.onSelect(t.key));
        this.layer.appendChild(el);
        this.pool.set(t.key, el);
      }
      seen.add(t.key);
      el.style.setProperty("--c", this.colors[t.route] ?? "#000");
      const angle = (Math.atan2(hy - y, hx - x) * 180) / Math.PI;
      el.style.setProperty("--a", `${angle.toFixed(1)}deg`);
      // Trains side by side at a station: nudge markers apart so each stays visible.
      const mx = x;
      let my = y;
      for (let k = 0; k < 6 && placed.some(([px, py]) => Math.abs(px - mx) < 16 && Math.abs(py - my) < 16); k++) {
        my -= 18;
      }
      placed.push([mx, my]);
      el.style.transform = `translate(${mx.toFixed(1)}px, ${my.toFixed(1)}px)`;
      el.classList.toggle("behind", behind);
      el.classList.toggle("selected", selected);
      el.setAttribute("aria-label", t.label);
      el.title = t.label;
      el.style.display = "";
    }
    for (const [key, el] of this.pool) {
      if (!seen.has(key)) el.style.display = "none";
    }
  }
}
