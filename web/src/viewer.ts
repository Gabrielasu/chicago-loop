/** The viewer: model, trains, camera and interface. */

import "./fonts.ts";
import "./styles.css";
import {
  chicagoTime,
  createSimulator,
  createTrainSource,
  MockTrainSource,
  pointAt,
  type Polyline,
  type TrainSource,
} from "@chicago-loop/mock";
import { network } from "@chicago-loop/mock/network";
import { Raycaster, Vector2, Vector3 } from "three";
import { pollIntervalFor, SimClock } from "./data/clock.ts";
import { TrainFeed } from "./data/feed.ts";
import { toScene } from "./data/frame.ts";
import { applyLight, loadModel, setBuildingsFaint, styleEdges } from "./loaders/model.ts";
import { drawLightMap, groundLightUniforms, loadStreets } from "./scene/lightmap.ts";
import { approach, closeTo, type Light, type LightMode, lightFor } from "./scene/light.ts";
import { LINE_COLORS, LINE_NAMES, type Theme } from "./scene/palette.ts";
import { detectQuality, Stage } from "./scene/stage.ts";
import { RouteLines } from "./scene/routes.ts";
import { River } from "./scene/water.ts";
import { sunPosition } from "./scene/sun.ts";
import { litFloorsAt } from "./scene/windows.ts";
import { toScreen } from "./scene/screen.ts";
import { loadTrees } from "./scene/trees.ts";
import { type CameraMode, type TrainSight, type ViewName, VIEWS, ViewController } from "./scene/views.ts";
import { type DisplayTrain, TrainLayer } from "./trains/layer.ts";
import { TrainMarkers } from "./trains/markers.ts";
import { makeSnapPath } from "./trains/snapping.ts";
import { trainLength } from "./trains/car.ts";
import { arrivalsAt } from "./ui/arrivals.ts";
import { LoopPlan, type PlanTrain } from "./ui/plan.ts";
import { arrival, clockTime, direction } from "./ui/format.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------- data

const simulator = createSimulator(network, { seed: Number(params.get("seed") ?? 1) });
// The mock clock: real time by default; ?t=2026-10-13T08:15:00-05:00 and ?speed=10 for demos.
const clock = new SimClock(
  params.get("t") ? Date.parse(params.get("t")!) : Date.now(),
  Number(params.get("speed") ?? 1) || 1,
);
let mock: MockTrainSource | null = null;
const source: TrainSource = createTrainSource(import.meta.env, () => {
  mock = new MockTrainSource({
    simulator,
    clock: () => clock.now(),
    pollInterval: Number(params.get("poll") ?? 0) || pollIntervalFor(clock.speed),
  });
  return mock;
});

const snapPaths = simulator.trips.map((t) => makeSnapPath(`${t.route}:${t.index}`, t.route, t.path));
const pathLines = new Map<string, Polyline>(snapPaths.map((p) => [p.id, p.line]));
const feed = new TrainFeed(source, snapPaths, network.bounds);
const [bx0, by0, bx1, by1] = network.bounds;

// ------------------------------------------------------------------ scene

const stage = new Stage($("stage"), detectQuality());
const views = new ViewController(stage);
const layer = new TrainLayer(pathLines, network.trackZ, network.bounds);
stage.scene.add(layer.group);
// The light follows the shown moment (Auto): the real sun over the Loop, golden hour,
// dusk and night blending into each other. Day or Night can be chosen instead.
const sunNow = () => sunPosition(source.kind === "mock" ? clock.now() : new Date(), network.origin.lat, network.origin.lon);
const lightParam = params.get("light") ?? params.get("theme");
let lightMode: LightMode = lightParam === "day" || lightParam === "night" ? lightParam : "auto";
let sunElevation = sunNow().elevation;
let lightNow: Light = lightFor(lightMode, sunElevation);
let theme: Theme = "day";
let faint = params.get("buildings") === "faint";
const startView = (params.get("view") as ViewName | null) ?? "overview";
views.go(startView in VIEWS ? startView : "overview", true);

// Night light on the ground, from the real streets (see scene/lightmap.ts).
const streets = await loadStreets();
const groundLight = groundLightUniforms(
  streets.length ? drawLightMap(streets, network.tracks, network.stations, network.bounds) : null,
);
const model = await loadModel(groundLight, (f) => {
  $("progress").textContent = `${Math.round(f * 100)}%`;
  $("progress-bar").style.width = `${Math.round(f * 100)}%`;
});
stage.scene.add(model.root);
views.solids = [model.root];
{
  const sun = sunNow();
  stage.setSun(sun.azimuth, sun.elevation);
}
// A reflecting river on capable machines; the flat water stays on phones.
const river =
  stage.quality === "high"
    ? River.fromModel(model.root, stage.size().x * stage.renderer.getPixelRatio(), stage.size().y * stage.renderer.getPixelRatio())
    : null;
const routes = new RouteLines(network.tracks, network.trackZ);
stage.scene.add(routes.group);
const trees = await loadTrees();
if (trees) stage.scene.add(trees.group);
applyLightNow(lightNow);
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

// The plan shows the Loop and its approaches: the tracks' extent plus a margin, cropped to the model.
const planExtent = ((): [number, number, number, number] => {
  const loop = network.stations.filter((s) => s.loop).map((s) => s.location);
  const xs = loop.map((p) => p[0]);
  const ys = loop.map((p) => p[1]);
  const m = 140;
  return [
    Math.max(Math.min(...xs) - m, bx0),
    Math.max(Math.min(...ys) - m, by0),
    Math.min(Math.max(...xs) + m, bx1),
    Math.min(Math.max(...ys) + m + 220, by1),
  ];
})();
const plan = new LoopPlan({
  tracks: network.tracks,
  stations: network.stations,
  extent: planExtent,
  colors: LINE_COLORS,
  onSelect: (key) => select(key),
  onPoint: (p) => views.lookAt(new Vector3(...toScene(p[0], p[1], 0))),
});
$("plan").appendChild(plan.element);

const labelLayer = $("labels");
labelLayer.removeAttribute("aria-hidden");
const stationLabels = network.stations.map((s) => {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "label";
  el.textContent = s.name.replace("-State/Van Buren", "");
  el.setAttribute("aria-label", `${s.name} station`);
  if (s.status === "closed") {
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = "Closed for rebuild";
    el.appendChild(note);
  }
  el.addEventListener("click", () => selectStation(s.id));
  labelLayer.appendChild(el);
  return { el, id: s.id, at: new Vector3(...toScene(s.location[0], s.location[1], network.trackZ + 6)) };
});
const markers = new TrainMarkers(labelLayer, LINE_COLORS, (key) => select(key));
const trainTag = document.createElement("div");
trainTag.className = "label train-tag";
trainTag.setAttribute("aria-hidden", "true");
trainTag.hidden = true;
labelLayer.appendChild(trainTag);

const status = document.querySelector<HTMLElement>(".status")!;
status.classList.toggle("mock", source.kind === "mock");
$("source").textContent = source.kind === "mock" ? "Mock data" : "CTA Train Tracker";

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
  b.addEventListener("click", () => views.go(b.dataset.view as ViewName));
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-light]")) {
  b.addEventListener("click", () => setLightMode(b.dataset.light as LightMode));
}
setLightMode(lightMode);
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-buildings]")) {
  b.addEventListener("click", () => setFaint(b.dataset.buildings === "faint"));
}
setFaint(faint);
function setFaint(on: boolean): void {
  faint = on;
  setBuildingsFaint(model, on);
  styleEdges(model, lightNow, on);
  trees?.setFaint(on);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-buildings]")) {
    b.setAttribute("aria-pressed", String((b.dataset.buildings === "faint") === on));
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
  b.addEventListener("click", () => setSpeed(Number(b.dataset.speed)));
}
setSpeed(clock.speed);

const HINTS: Partial<Record<CameraMode, string>> = {
  wabash: "Drag to look around. W A S D or arrow keys to walk, Shift to run.",
  follow: "Following the train. Drag to orbit, scroll to zoom. Escape to stop.",
  ride: "Riding at the front of the train. Escape to get off.",
};

function showView(v: CameraMode): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    b.setAttribute("aria-pressed", String(b.dataset.view === v));
  }
  const hint = HINTS[v];
  $("hint").hidden = !hint;
  $("hint").textContent = hint ?? "";
  $("train-follow").setAttribute("aria-pressed", String(v === "follow"));
  $("train-ride").setAttribute("aria-pressed", String(v === "ride"));
  document.body.classList.toggle("riding", v === "ride");
}
views.onChange(showView);
showView(views.current);
// ?ui=off hides the interface, for clean recordings.
if (params.get("ui") === "off") document.body.classList.add("bare");

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "1") views.go("overview");
  else if (e.key === "2") views.go("tower18");
  else if (e.key === "3") views.go("wabash");
  else if (e.key === "n" || e.key === "N") setLightMode(lightMode === "night" ? "day" : "night");
  else if (e.key === "b" || e.key === "B") setFaint(!faint);
  else if ((e.key === "f" || e.key === "F") && selected) toggleFollow("follow");
  else if ((e.key === "r" || e.key === "R") && selected) toggleFollow("ride");
  else if (e.key === "Escape") {
    if (views.following) views.stopFollowing();
    else if (selectedStation != null) selectStation(null);
    else select(null);
  }
});

function setLightMode(mode: LightMode): void {
  lightMode = mode;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-light]")) {
    b.setAttribute("aria-pressed", String(b.dataset.light === mode));
  }
}

/** Put a light on everything; the interface turns dark once the scene is more night than day. */
function applyLightNow(l: Light): void {
  stage.setLight(l);
  groundLight.uGroundLight.value = groundLight.uLightMap.value ? l.night : 0;
  applyLight(model, l);
  styleEdges(model, l, faint);
  trees?.setLight(l);
  routes.setLight(l);
  river?.setLight(l);
  layer.setLight(l);
  const next: Theme = l.night > 0.45 ? "night" : "day";
  if (next !== theme) {
    theme = next;
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "day" ? "#e3e3e1" : "#121316");
  }
}

function setSpeed(speed: number): void {
  clock.setSpeed(speed);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
    b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === speed));
  }
  if (mock && !params.get("poll")) {
    mock.pollInterval = pollIntervalFor(speed);
    feed.restart();
  }
}

// --------------------------------------------------------------- selection

let selected: string | null = null;
let hovered: string | null = null;
let selectedStation: number | null = null;

function select(key: string | null): void {
  if (key !== selected && views.following) views.stopFollowing();
  selected = key;
  if (key) selectedStation = null;
  renderPanels();
}

function selectStation(id: number | null): void {
  selectedStation = id;
  if (id != null) {
    if (views.following) views.stopFollowing();
    selected = null;
  }
  renderPanels();
}

function selectNextOfLine(code: string): void {
  const keys = visible
    .filter((t) => t.route === code)
    .map((t) => t.key)
    .sort();
  if (!keys.length) return;
  const i = selected ? keys.indexOf(selected) : -1;
  select(keys[(i + 1) % keys.length]!);
}

function toggleFollow(mode: "follow" | "ride"): void {
  if (!selected) return;
  if (views.current === mode) {
    views.stopFollowing();
    return;
  }
  const sight = sightOf(selected);
  if (mode === "follow") views.follow(selected, sight);
  else views.ride(selected, sight);
}
$("train-follow").addEventListener("click", () => toggleFollow("follow"));
$("train-ride").addEventListener("click", () => toggleFollow("ride"));

function renderPanels(): void {
  renderTrainPanel();
  renderStationPanel();
}

function renderTrainPanel(): void {
  const key = selected ?? (selectedStation == null ? hovered : null);
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
  panel.querySelector<HTMLElement>(".panel-actions")!.hidden = selected == null;
}
$("train-close").addEventListener("click", () => select(null));

function renderStationPanel(): void {
  const panel = $("station");
  const s = network.stations.find((x) => x.id === selectedStation);
  if (!s) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("station-name").textContent = s.name;
  const note = $("station-note");
  note.hidden = !s.note;
  note.textContent = s.note ?? "";
  const list = $("station-arrivals");
  list.replaceChildren();
  const arrivals = arrivalsAt(s.id, feed.trains.values());
  if (!arrivals.length) {
    const li = document.createElement("li");
    const empty = s.status === "closed" ? "No trains stop here." : "No trains on their way right now.";
    li.innerHTML = `<span class="empty">${empty}</span>`;
    list.appendChild(li);
  }
  for (const a of arrivals.slice(0, 8)) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const eta = arrival(a.train, feed.status.tmst);
    b.setAttribute("aria-label", `${LINE_NAMES[a.route]} Line to ${a.train.destNm}, ${eta}`);
    b.innerHTML = `<span class="swatch" style="background:${LINE_COLORS[a.route]}"></span><span>${a.train.destNm}</span><span class="eta">${eta}</span>`;
    b.addEventListener("click", () => select(a.key));
    li.appendChild(b);
    list.appendChild(li);
  }
}
$("station-close").addEventListener("click", () => selectStation(null));

const raycaster = new Raycaster();
const pointer = new Vector2();
const pointerPx = new Vector2();
let pointerDirty = false;
let downAt: [number, number] | null = null;
const canvas = stage.renderer.domElement;
canvas.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  pointerPx.set(e.clientX - r.left, e.clientY - r.top);
  pointerDirty = e.pointerType === "mouse";
});
canvas.addEventListener("pointerdown", (e) => {
  downAt = [e.clientX, e.clientY];
});
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  if (views.current === "ride") return;
  const r = canvas.getBoundingClientRect();
  const key = pickTrain(e.clientX - r.left, e.clientY - r.top, e.pointerType === "touch" ? 36 : 22);
  if (key || !views.following) select(key);
});

// -------------------------------------------------------------------- loop

let visible: DisplayTrain[] = [];

feed.onUpdate(() => {
  $("updated").textContent = clockTime(feed.status.tmst);
  if (feed.status.error) $("source").textContent = "No train data";
  else $("source").textContent = source.kind === "mock" ? "Mock data" : "CTA Train Tracker";
  renderPanels();
});
feed.start();

/** Head position and travel direction of a visible train, in scene space. */
function sightOf(key: string): TrainSight | null {
  const t = visible.find((v) => v.key === key);
  const line = t ? pathLines.get(t.pathId) : undefined;
  if (!t || !line) return null;
  const [x, y] = pointOn(line, t.distance);
  if (x < bx0 || x > bx1 || y < by0 || y > by1) return null;
  const [ax, ay] = pointOn(line, t.distance - 6);
  const [cx, cy] = pointOn(line, t.distance + 6);
  const forward = new Vector3(...toScene(cx - ax, cy - ay, 0)).normalize();
  return { head: new Vector3(...toScene(x, y, network.trackZ)), forward };
}

function project(v: Vector3, el: HTMLElement, w: number, h: number, maxDistance = Infinity): void {
  if (stage.camera.position.distanceTo(v) > maxDistance) {
    el.style.display = "none";
    return;
  }
  const { x, y, visible: inFront } = toScreen(v, stage.camera, w, h);
  const show = inFront && x > -50 && x < w + 50 && y > 0 && y < h + 50;
  el.style.display = show ? "" : "none";
  if (!show) return;
  // Near the right edge the label hangs to the left of its station instead.
  const flip = x + el.offsetWidth > w - 8;
  el.classList.toggle("flip", flip);
  const left = flip ? x - el.offsetWidth : x;
  el.style.transform = `translate(${left.toFixed(1)}px, ${(y - el.offsetHeight).toFixed(1)}px)`;
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let last = performance.now();
let panelTick = 0;
let planTick = 0;
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

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
  layer.update(visible, stage.camera.position);
  for (const [code, el] of counts) el.textContent = String(perLine.get(code) ?? 0);

  views.update(dt, views.following ? sightOf(views.following) : null);

  // Ease the light toward the chosen mode or the sun: a change of light takes about a second.
  const lightTarget = lightFor(lightMode, sunElevation);
  if (!closeTo(lightNow, lightTarget)) {
    lightNow = reducedMotion.matches ? lightTarget : approach(lightNow, lightTarget, dt);
    applyLightNow(lightNow);
  }

  if (pointerDirty) {
    pointerDirty = false;
    const key = views.current === "ride" ? null : pickTrain(pointerPx.x, pointerPx.y, 22);
    if (key !== hovered) {
      hovered = key;
      canvas.style.cursor = key ? "pointer" : "";
      renderTrainPanel();
    }
  }
  if (now - panelTick > 1000) {
    panelTick = now;
    const sun = sunNow();
    sunElevation = sun.elevation;
    // How many offices are still lit depends on the hour in Chicago.
    const t = chicagoTime(source.kind === "mock" ? clock.now() : new Date());
    for (const w of model.windows) w.setFloors(litFloorsAt(t.hour + t.minute / 60));
    stage.setSun(sun.azimuth, sun.elevation);
    if (selectedStation != null) renderStationPanel();
    if (stage.degraded.length) status.title = `Lowered for speed: ${stage.degraded.join(", ")}`;
  }

  const { x: w, y: h } = stage.size();
  river?.update(now / 1000, stage.camera.position.y);
  routes.setSize(w, h);
  routes.update(stage.camera.position.y);
  markers.selected = selected;
  // At street level and on a train only the selected train keeps its marker.
  markers.enabled = views.current !== "ride" && !views.isStreet();
  markers.update(markerTrains(), stage.camera, faint ? [] : model.buildings, w, h);
  if (now - planTick > 100) {
    planTick = now;
    plan.selected = selected;
    plan.update(planTrains());
    plan.setView(groundInView());
  }
  // At street level and on a train only nearby stations are labelled; far ones pile up on the horizon.
  const labelRange = views.isStreet() || views.current === "ride" ? 450 : Infinity;
  for (const l of stationLabels) project(l.at, l.el, w, h, labelRange);
  hideOverlaps(stationLabels.map((l) => l.el));
  const tagKey = views.current === "ride" ? null : (selected ?? hovered);
  const tagTrain = tagKey ? visible.find((t) => t.key === tagKey) : undefined;
  const tagLine = tagTrain ? pathLines.get(tagTrain.pathId) : undefined;
  if (tagTrain && tagLine) {
    const [x, y] = pointOn(tagLine, tagTrain.distance);
    trainTag.hidden = false;
    trainTag.textContent = `${LINE_NAMES[tagTrain.route]} ${feed.trains.get(tagTrain.key)?.info.rn ?? ""}`;
    project(new Vector3(...toScene(x, y, network.trackZ + 5)), trainTag, w, h);
  } else {
    trainTag.hidden = true;
  }

  stage.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/**
 * The train under a screen point. A ray test first; if it misses, the nearest
 * train within `radius` pixels, measured to points along its cars. At overview
 * scale a train is only a few pixels wide, so the ray alone is too strict.
 */
function pickTrain(x: number, y: number, radius: number): string | null {
  const { x: w, y: h } = stage.size();
  pointer.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
  raycaster.setFromCamera(pointer, stage.camera);
  const hit = layer.pick(raycaster);
  if (hit) return hit;
  let best: string | null = null;
  let bestD = radius;
  const v = new Vector3();
  for (const t of visible) {
    const line = pathLines.get(t.pathId);
    if (!line) continue;
    for (let k = 0; k <= 4; k++) {
      const [px, py] = pointOn(line, t.distance - k * 25);
      if (px < bx0 || px > bx1 || py < by0 || py > by1) continue;
      const sp = toScreen(v.set(...toScene(px, py, network.trackZ + 2)), stage.camera, w, h);
      if (!sp.visible) continue;
      const d = Math.hypot(sp.x - x, sp.y - y);
      if (d < bestD) {
        bestD = d;
        best = t.key;
      }
    }
  }
  return best;
}

/** Trains inside the model, for the markers. */
function markerTrains() {
  const out = [];
  for (const t of visible) {
    const line = pathLines.get(t.pathId);
    const info = feed.trains.get(t.key)?.info;
    if (!line || !info) continue;
    const length = trainLength(t.route);
    const [mx, my] = pointOn(line, t.distance - length / 2);
    if (mx < bx0 || mx > bx1 || my < by0 || my > by1) continue;
    const [hx, hy] = pointOn(line, t.distance);
    out.push({
      key: t.key,
      route: t.route,
      middle: new Vector3(...toScene(mx, my, network.trackZ + 4)),
      head: new Vector3(...toScene(hx, hy, network.trackZ + 4)),
      length,
      label: `${LINE_NAMES[t.route]} Line run ${info.rn} to ${info.destNm}`,
    });
  }
  return out;
}

function planTrains(): PlanTrain[] {
  const out: PlanTrain[] = [];
  for (const t of visible) {
    const line = pathLines.get(t.pathId);
    const info = feed.trains.get(t.key)?.info;
    if (!line || !info) continue;
    out.push({
      key: t.key,
      route: t.route,
      head: pointOn(line, t.distance),
      tail: pointOn(line, t.distance - trainLength(t.route)),
      label: `${LINE_NAMES[t.route]} Line run ${info.rn} to ${info.destNm}`,
    });
  }
  return out;
}

/** Where the corners of the screen meet the ground, local meters, clamped to a horizon distance. */
function groundInView(): [number, number][] {
  const out: [number, number][] = [];
  const cam = stage.camera;
  const origin = cam.position;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const dir = new Vector3(sx, sy, 0.5).unproject(cam).sub(origin).normalize();
    let d = dir.y < -1e-3 ? -origin.y / dir.y : 3000;
    d = Math.min(d, 3000);
    const p = origin.clone().addScaledVector(dir, d);
    out.push([p.x, -p.z]);
  }
  return out;
}

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

// ------------------------------------------------------------- shareable links

/** Keep the address bar in step with what is on screen, so a link opens the same view. */
function syncUrl(): void {
  const q = new URLSearchParams(location.search);
  const set = (k: string, v: string | null) => (v == null ? q.delete(k) : q.set(k, v));
  set("view", views.current in VIEWS ? views.current : null);
  q.delete("theme");
  set("light", lightMode === "auto" ? null : lightMode);
  set("buildings", faint ? "faint" : null);
  set("train", selected);
  set("station", selectedStation == null ? null : String(selectedStation));
  const next = `${location.pathname}${q.size ? `?${q}` : ""}`;
  if (next !== `${location.pathname}${location.search}`) history.replaceState(null, "", next);
}
setInterval(syncUrl, 1000);

// A shared link can name a train (?train=brn:408) or a station (?station=40380).
const wantTrain = params.get("train");
const wantStation = Number(params.get("station")) || null;
if (wantStation) selectStation(wantStation);
if (wantTrain) {
  let tries = 0;
  const pick = () => {
    if (feed.trains.has(wantTrain)) select(wantTrain);
    else if (++tries < 20) setTimeout(pick, 500);
  };
  setTimeout(pick, 300);
}

// For screenshots and tests.
Object.assign(window, {
  __loop: { stage, views, feed, setLightMode, select, selectStation, toggleFollow, setSpeed, visible: () => visible, sightOf },
});
