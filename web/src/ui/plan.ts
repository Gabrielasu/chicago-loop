/**
 * A live plan of the Loop: the L's tracks as thin lines, north up, stations as
 * ticks, every train as a square in its line color pointing the way it runs.
 * Click a train to select it, click anywhere else to fly the camera there.
 */

import type { NetworkStation, NetworkTrack, XY } from "@chicago-loop/mock";

const SVG = "http://www.w3.org/2000/svg";

export interface PlanTrain {
  key: string;
  route: string;
  /** Local meters of the head and a point behind it */
  head: XY;
  tail: XY;
  label: string;
}

export interface PlanOptions {
  tracks: readonly NetworkTrack[];
  stations: readonly NetworkStation[];
  /** Area to show, local meters [x0, y0, x1, y1] */
  extent: [number, number, number, number];
  colors: Record<string, string>;
  onSelect: (key: string) => void;
  onPoint: (p: XY) => void;
}

export class LoopPlan {
  readonly element: SVGSVGElement;
  private readonly trainLayer: SVGGElement;
  private readonly view: SVGPolygonElement;
  private readonly marks = new Map<string, SVGGElement>();
  private readonly scale: number;
  private readonly x0: number;
  private readonly y1: number;
  selected: string | null = null;

  constructor(private readonly opts: PlanOptions) {
    const [x0, y0, x1, y1] = opts.extent;
    const width = 220;
    this.scale = width / (x1 - x0);
    const height = (y1 - y0) * this.scale;
    this.x0 = x0;
    this.y1 = y1;
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height.toFixed(1)}`);
    svg.setAttribute("class", "plan");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Plan of the Loop with the trains in it. North is up.");
    this.element = svg;

    const tracks = document.createElementNS(SVG, "g");
    tracks.setAttribute("class", "plan-tracks");
    for (const t of opts.tracks) {
      const path = document.createElementNS(SVG, "polyline");
      path.setAttribute("points", t.points.map((p) => this.pt(p).join(",")).join(" "));
      tracks.appendChild(path);
    }
    svg.appendChild(tracks);

    // The part of the city in view, as a light quadrilateral under the trains, clipped to the plan.
    const clipId = `plan-clip-${Math.random().toString(36).slice(2, 8)}`;
    const defs = document.createElementNS(SVG, "defs");
    const clip = document.createElementNS(SVG, "clipPath");
    clip.setAttribute("id", clipId);
    const box = document.createElementNS(SVG, "rect");
    box.setAttribute("width", String(width));
    box.setAttribute("height", height.toFixed(1));
    clip.appendChild(box);
    defs.appendChild(clip);
    svg.appendChild(defs);
    this.view = document.createElementNS(SVG, "polygon");
    this.view.setAttribute("class", "plan-view");
    this.view.setAttribute("clip-path", `url(#${clipId})`);
    svg.appendChild(this.view);

    const stations = document.createElementNS(SVG, "g");
    stations.setAttribute("class", "plan-stations");
    for (const s of opts.stations) {
      const [x, y] = this.pt(s.location);
      const tick = document.createElementNS(SVG, "rect");
      tick.setAttribute("x", (x - 2.5).toFixed(1));
      tick.setAttribute("y", (y - 2.5).toFixed(1));
      tick.setAttribute("width", "5");
      tick.setAttribute("height", "5");
      if (s.status === "closed") tick.setAttribute("class", "closed");
      const title = document.createElementNS(SVG, "title");
      title.textContent = s.status === "closed" ? `${s.name} (closed)` : s.name;
      tick.appendChild(title);
      stations.appendChild(tick);
    }
    svg.appendChild(stations);

    this.trainLayer = document.createElementNS(SVG, "g");
    svg.appendChild(this.trainLayer);

    const north = document.createElementNS(SVG, "text");
    north.setAttribute("class", "plan-north");
    north.setAttribute("x", (width - 6).toFixed(0));
    north.setAttribute("y", "12");
    north.setAttribute("text-anchor", "end");
    north.textContent = "N";
    svg.appendChild(north);

    svg.addEventListener("click", (e) => {
      const target = (e.target as Element).closest("[data-key]");
      if (target) {
        opts.onSelect(target.getAttribute("data-key")!);
        return;
      }
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * width;
      const py = ((e.clientY - r.top) / r.height) * height;
      opts.onPoint([this.x0 + px / this.scale, this.y1 - py / this.scale]);
    });
  }

  private pt([x, y]: XY): [number, number] {
    return [(x - this.x0) * this.scale, (this.y1 - y) * this.scale];
  }

  /** Corners of the ground area in view, local meters. */
  setView(corners: XY[]): void {
    this.view.setAttribute("points", corners.map((c) => this.pt(c).map((v) => v.toFixed(1)).join(",")).join(" "));
  }

  update(trains: readonly PlanTrain[]): void {
    const seen = new Set<string>();
    const [ex0, ey0, ex1, ey1] = this.opts.extent;
    for (const t of trains) {
      const [hx, hy] = t.head;
      if (hx < ex0 || hx > ex1 || hy < ey0 || hy > ey1) continue;
      seen.add(t.key);
      let g = this.marks.get(t.key);
      if (!g) {
        g = document.createElementNS(SVG, "g");
        g.setAttribute("data-key", t.key);
        g.setAttribute("class", "plan-train");
        const line = document.createElementNS(SVG, "line");
        const sq = document.createElementNS(SVG, "rect");
        sq.setAttribute("x", "-4");
        sq.setAttribute("y", "-4");
        sq.setAttribute("width", "8");
        sq.setAttribute("height", "8");
        const title = document.createElementNS(SVG, "title");
        g.append(line, sq, title);
        this.trainLayer.appendChild(g);
        this.marks.set(t.key, g);
      }
      const [x, y] = this.pt(t.head);
      const [tx, ty] = this.pt(t.tail);
      const color = this.opts.colors[t.route] ?? "#000";
      const line = g.children[0] as SVGLineElement;
      line.setAttribute("x1", tx.toFixed(1));
      line.setAttribute("y1", ty.toFixed(1));
      line.setAttribute("x2", x.toFixed(1));
      line.setAttribute("y2", y.toFixed(1));
      line.setAttribute("stroke", color);
      const sq = g.children[1] as SVGRectElement;
      sq.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      sq.setAttribute("fill", color);
      (g.children[2] as SVGTitleElement).textContent = t.label;
      g.classList.toggle("selected", t.key === this.selected);
    }
    for (const [key, g] of this.marks) {
      if (!seen.has(key)) {
        g.remove();
        this.marks.delete(key);
      }
    }
  }
}
