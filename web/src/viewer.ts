/** The viewer: model, trains, views and interface. */

import "./fonts.ts";
import "./styles.css";
import { createSimulator, createTrainSource, MockTrainSource, pointAt, type Polyline } from "@chicago-loop/mock";
import { network } from "@chicago-loop/mock/network";
import { Raycaster, Vector2, Vector3 } from "three";
import { TrainFeed } from "./data/feed.ts";
import { toScene } from "./data/frame.ts";
import { applyTheme, loadModel } from "./loaders/model.ts";
import { LINE_COLORS, LINE_NAMES, type Theme } from "./scene/palette.ts";
import { detectQuality, Stage } from "./scene/stage.ts";
import { type ViewName, VIEWS, ViewController } from "./scene/views.ts";
import { type DisplayTrain, TrainLayer } from "./trains/layer.ts";
import { makeSnapPath } from "./trains/snapping.ts";
import { arrival, clockTime, direction } from "./ui/format.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------- data

const simulator = createSimulator(network, { seed: Number(params.get("seed") ?? 1) });
// The mock clock: real time by default; ?t=2026-10-13T08:15:00-05:00 and ?speed=8 for demos.
const t0 = params.get("t") ? Date.parse(params.get("t")!) : Date.now();
const speed = Number(params.get("speed") ?? 1) || 1;
const started = Date.now();
const source = createTrainSource(
  import.meta.env,
  () =>
    new MockTrainSource({
      simulator,
      clock: () => new Date(t0 + (Date.now() - started) * speed),
      pollInterval: Number(params.get("poll") ?? 5000),
    }),
);

const snapPaths = simulator.trips.map((t) => makeSnapPath(`${t.route}:${t.index}`, t.route, t.path));
const pathLines = new Map<string, Polyline>(snapPaths.map((p) => [p.id, p.line]));
const feed = new TrainFeed(source, snapPaths, network.bounds);

// ------------------------------------------------------------------ scene

const stage = new Stage($("stage"), detectQuality());
const views = new ViewController(stage);
const layer = new TrainLayer(pathLines, network.trackZ, network.bounds);
stage.scene.add(layer.group);
let theme: Theme = params.get("theme") === "night" ? "night" : "day";
const startView = (params.get("view") as ViewName | null) ?? "overview";
views.go(startView in VIEWS ? startView : "overview", true);

const model = await loadModel((f) => {
  $("progress").textContent = `${Math.round(f * 100)}%`;
});
stage.scene.add(model.root);
setTheme(theme);
$("loading").classList.add("done");

// --------------------------------------------------------------- interface

const lineList = $("lines");
const counts = new Map<string, HTMLElement>();
for (const code of Object.keys(LINE_COLORS)) {
  const li = document.createElement("li");
  li.innerHTML = `<button type="button" data-line="${code}"><span class="swatch" style="background:${LINE_COLORS[code]}"></span><span class="name">${LINE_NAMES[code]}</span><span class="count">0</span></button>`;
  const button = li.querySelector("button")!;
  button.setAttribute("aria-label", `${LINE_NAMES[code]} Line: show the next train`);
  button.addEventListener("click", () => selectNextOfLine(code));
  counts.set(code, li.querySelector(".count")!);
  lineList.appendChild(li);
}

const labelLayer = $("labels");
const stationLabels = network.stations.map((s) => {
  const el = document.createElement("div");
  el.className = "label";
  el.textContent = s.name.replace("-State/Van Buren", "");
  if (s.status === "closed") {
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = "Closed for rebuild";
    el.appendChild(note);
  }
  labelLayer.appendChild(el);
  return { el, at: new Vector3(...toScene(s.location[0], s.location[1], network.trackZ + 6)) };
});
const trainTag = document.createElement("div");
trainTag.className = "label train-tag";
trainTag.hidden = true;
labelLayer.appendChild(trainTag);

$("source").textContent = source.kind === "mock" ? "Mock data" : "CTA Train Tracker";

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
  b.addEventListener("click", () => views.go(b.dataset.view as ViewName));
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-theme]")) {
  b.addEventListener("click", () => setTheme(b.dataset.theme as Theme));
}
views.onChange((v) => {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    b.setAttribute("aria-pressed", String(b.dataset.view === v));
  }
  $("hint").hidden = v !== "wabash";
});
$("hint").hidden = views.current !== "wabash";

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "1") views.go("overview");
  else if (e.key === "2") views.go("tower18");
  else if (e.key === "3") views.go("wabash");
  else if (e.key === "n" || e.key === "N") setTheme(theme === "day" ? "night" : "day");
  else if (e.key === "Escape") select(null);
});

function setTheme(next: Theme): void {
  theme = next;
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "day" ? "#e3e3e1" : "#121316");
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-theme]")) {
    b.setAttribute("aria-pressed", String(b.dataset.theme === next));
  }
  stage.setTheme(next);
  applyTheme(model, next);
  layer.setTheme(next);
}

// --------------------------------------------------------------- selection

let selected: string | null = null;
let hovered: string | null = null;

function select(key: string | null): void {
  selected = key;
  renderPanel();
}

function selectNextOfLine(code: string): void {
  const keys = visible.filter((t) => t.route === code).map((t) => t.key).sort();
  if (!keys.length) return;
  const i = selected ? keys.indexOf(selected) : -1;
  select(keys[(i + 1) % keys.length]!);
}

function renderPanel(): void {
  const key = selected ?? hovered;
  const t = key ? feed.trains.get(key) : undefined;
  const panel = $("train");
  if (!t) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("train-swatch").style.background = LINE_COLORS[t.route] ?? "";
  $("train-line").textContent = `${LINE_NAMES[t.route]} Line`;
  $("train-run").textContent = `Run ${t.info.rn}`;
  $("train-dest").textContent = t.info.destNm;
  $("train-next").textContent = t.info.nextStaNm;
  $("train-arr").textContent = arrival(t.info, feed.status.tmst) + (t.info.isDly === "1" ? ", delayed" : "");
  $("train-heading").textContent = direction(t.route, t.info.trDr);
  $("train-close").hidden = selected == null;
}
$("train-close").addEventListener("click", () => select(null));

const raycaster = new Raycaster();
const pointer = new Vector2();
let pointerDirty = false;
let downAt: [number, number] | null = null;
const canvas = stage.renderer.domElement;
canvas.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  pointerDirty = e.pointerType === "mouse";
});
canvas.addEventListener("pointerdown", (e) => {
  downAt = [e.clientX, e.clientY];
});
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, stage.camera);
  select(layer.pick(raycaster));
});

// -------------------------------------------------------------------- loop

let visible: DisplayTrain[] = [];
const [bx0, by0, bx1, by1] = network.bounds;

feed.onUpdate(() => {
  $("updated").textContent = clockTime(feed.status.tmst);
  if (feed.status.error) $("source").textContent = "No train data";
  else $("source").textContent = source.kind === "mock" ? "Mock data" : "CTA Train Tracker";
  renderPanel();
});
feed.start();

function project(v: Vector3, el: HTMLElement, w: number, h: number, maxDistance = Infinity): void {
  if (stage.camera.position.distanceTo(v) > maxDistance) {
    el.style.display = "none";
    return;
  }
  const p = v.clone().project(stage.camera);
  const x = (p.x * 0.5 + 0.5) * w;
  const y = (-p.y * 0.5 + 0.5) * h;
  const show = p.z < 1 && x > -50 && x < w + 50 && y > 0 && y < h + 50;
  el.style.display = show ? "" : "none";
  if (!show) return;
  // Near the right edge the label hangs to the left of its station instead.
  const flip = x + el.offsetWidth > w - 8;
  el.classList.toggle("flip", flip);
  const left = flip ? x - el.offsetWidth : x;
  el.style.transform = `translate(${left.toFixed(1)}px, ${(y - el.offsetHeight).toFixed(1)}px)`;
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  views.update(dt);

  // Draw one update interval in the past, so there is always a next sample to glide toward.
  const renderTime = now - source.pollInterval;
  visible = [];
  const perLine = new Map<string, number>();
  for (const t of feed.trains.values()) {
    const p = t.history.at(renderTime);
    if (!p) continue;
    visible.push({ key: t.key, route: t.route, pathId: p.pathId, distance: p.distance });
    const line = pathLines.get(p.pathId);
    if (line) {
      const [x, y] = pointOn(line, p.distance);
      if (x > bx0 && x < bx1 && y > by0 && y < by1) perLine.set(t.route, (perLine.get(t.route) ?? 0) + 1);
    }
  }
  layer.update(visible);
  for (const [code, el] of counts) el.textContent = String(perLine.get(code) ?? 0);

  if (pointerDirty) {
    pointerDirty = false;
    raycaster.setFromCamera(pointer, stage.camera);
    const key = layer.pick(raycaster);
    if (key !== hovered) {
      hovered = key;
      canvas.style.cursor = key ? "pointer" : "";
      renderPanel();
    }
  }

  const { x: w, y: h } = stage.size();
  // At street level only nearby stations are labelled; far ones pile up on the horizon.
  const labelRange = views.isStreet() ? 450 : Infinity;
  for (const l of stationLabels) project(l.at, l.el, w, h, labelRange);
  hideOverlaps(stationLabels.map((l) => l.el));
  const tagKey = selected ?? hovered;
  const tagTrain = tagKey ? visible.find((t) => t.key === tagKey) : undefined;
  const tagLine = tagTrain ? pathLines.get(tagTrain.pathId) : undefined;
  if (tagTrain && tagLine) {
    const [x, y] = pointOn(tagLine, tagTrain.distance);
    trainTag.hidden = false;
    trainTag.textContent = `${LINE_NAMES[tagTrain.route]} ${feed.trains.get(tagTrain.key)?.info.rn ?? ""}`;
    project(new Vector3(...toScene(x, y, network.trackZ + 4)), trainTag, w, h);
  } else {
    trainTag.hidden = true;
  }

  stage.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** Hide labels that would sit on top of one placed before them. */
function hideOverlaps(els: HTMLElement[]): void {
  const placed: DOMRect[] = [];
  for (const el of els) {
    if (el.style.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (placed.some((p) => r.left < p.right + 6 && r.right > p.left - 6 && r.top < p.bottom && r.bottom > p.top)) {
      el.style.display = "none";
    } else {
      placed.push(r);
    }
  }
}

function pointOn(line: Polyline, d: number): [number, number] {
  return pointAt(line, d).point;
}

// For screenshots and tests.
Object.assign(window, { __loop: { stage, views, feed, setTheme, select } });
