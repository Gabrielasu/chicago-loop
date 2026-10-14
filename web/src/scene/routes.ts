/**
 * The L as a drawn line: every elevated track as a thin screen-space stroke.
 * Where the structure is in view the stroke sits on it; where buildings hide
 * it, a faint trace shows through, so the shape of the Loop and its approaches
 * reads from any height, the way a plan drawing shows it.
 */

import { Group, SRGBColorSpace } from "three";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { Line2 } from "three/addons/lines/Line2.js";
import type { NetworkTrack } from "@chicago-loop/mock";
import { toScene } from "../data/frame.ts";
import { type Light, lerp, mix } from "./light.ts";

export class RouteLines {
  readonly group = new Group();
  private readonly front: LineMaterial;
  private readonly behind: LineMaterial;

  constructor(tracks: readonly NetworkTrack[], trackZ: number) {
    this.group.name = "route_lines";
    this.front = new LineMaterial({ linewidth: 1.6, transparent: true, opacity: 0.9, depthWrite: false });
    this.behind = new LineMaterial({
      linewidth: 1.2,
      transparent: true,
      opacity: 0.22,
      depthTest: false,
      depthWrite: false,
    });
    for (const t of tracks) {
      const positions: number[] = [];
      for (const [x, y] of t.points) positions.push(...toScene(x, y, trackZ + 0.4));
      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      for (const mat of [this.behind, this.front]) {
        const line = new Line2(geometry, mat);
        line.computeLineDistances();
        line.renderOrder = mat === this.behind ? 3 : 1;
        line.raycast = () => {};
        this.group.add(line);
      }
    }
    this.setLight({ night: 0, golden: 0 });
  }

  setLight(l: Light): void {
    const c = mix([0.067, 0.067, 0.067], [0.85, 0.8, 0.7], l.night);
    this.front.color.setRGB(...c, SRGBColorSpace);
    this.behind.color.setRGB(...c, SRGBColorSpace);
    this.behindOpacity = lerp(0.22, 0.3, l.night);
  }

  private behindOpacity = 0.22;


  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  setSize(width: number, height: number): void {
    this.front.resolution.set(width, height);
    this.behind.resolution.set(width, height);
  }

  /** Fade the strokes in as the camera rises: up close the structure itself shows. */
  update(cameraHeight: number): void {
    const k = Math.min(Math.max((cameraHeight - 120) / 380, 0), 1);
    this.front.opacity = 0.9 * k;
    this.behind.opacity = this.behindOpacity * k;
    this.group.visible = k > 0.01;
  }
}
