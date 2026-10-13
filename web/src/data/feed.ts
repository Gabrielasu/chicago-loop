/**
 * Polls the train source, snaps every train to its line's track and keeps a
 * short position history per train for easing.
 */

import { type CtaTrain, LOOP_ROUTES, type LoopRoute, trainsOf, type TrainSource, type XY } from "@chicago-loop/mock";
import { TrackHistory } from "../trains/easing.ts";
import { snap, type SnapPath } from "../trains/snapping.ts";
import { frame } from "./frame.ts";

export interface FeedTrain {
  key: string;
  route: LoopRoute;
  info: CtaTrain;
  history: TrackHistory;
  lastSeen: number;
}

export interface FeedStatus {
  /** Train Tracker timestamp of the last good response */
  tmst: string | null;
  error: string | null;
  fetchedAt: number | null;
}

export class TrainFeed {
  readonly trains = new Map<string, FeedTrain>();
  readonly status: FeedStatus = { tmst: null, error: null, fetchedAt: null };
  private readonly byRoute = new Map<string, SnapPath[]>();
  private timer: number | null = null;
  private listeners: (() => void)[] = [];

  constructor(
    readonly source: TrainSource,
    paths: readonly SnapPath[],
    private readonly bounds: [number, number, number, number],
    private readonly margin = 400,
  ) {
    for (const p of paths) {
      const list = this.byRoute.get(p.route) ?? [];
      list.push(p);
      this.byRoute.set(p.route, list);
    }
  }

  onUpdate(listener: () => void): void {
    this.listeners.push(listener);
  }

  start(): void {
    void this.poll();
    this.timer = window.setInterval(() => void this.poll(), this.source.pollInterval);
  }

  stop(): void {
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private near([x, y]: XY): boolean {
    const [x0, y0, x1, y1] = this.bounds;
    const m = this.margin;
    return x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;
  }

  async poll(now = performance.now()): Promise<void> {
    try {
      const res = await this.source.fetch(LOOP_ROUTES);
      if (res.ctatt.errCd !== "0") throw new Error(`Train Tracker error ${res.ctatt.errCd}: ${res.ctatt.errNm ?? ""}`);
      this.ingest(trainsOf(res), now);
      this.status.tmst = res.ctatt.tmst;
      this.status.error = null;
      this.status.fetchedAt = now;
    } catch (e) {
      this.status.error = e instanceof Error ? e.message : String(e);
    }
    for (const l of this.listeners) l();
  }

  ingest(list: { route: string; train: CtaTrain }[], now: number): void {
    const seen = new Set<string>();
    for (const { route, train } of list) {
      const paths = this.byRoute.get(route);
      if (!paths) continue;
      const p = frame.toLocal(Number(train.lat), Number(train.lon));
      if (!Number.isFinite(p[0]) || !this.near(p)) continue;
      const key = `${route}:${train.rn}`;
      const existing = this.trains.get(key);
      const last = existing?.history.latest;
      const s = snap(paths, p, Number(train.heading), undefined, last ? { pathId: last.pathId, distance: last.distance } : undefined);
      if (!s) continue;
      const entry = existing ?? { key, route: route as LoopRoute, info: train, history: new TrackHistory(), lastSeen: now };
      entry.info = train;
      entry.lastSeen = now;
      entry.history.push({ time: now, pathId: s.pathId, distance: s.distance });
      this.trains.set(key, entry);
      seen.add(key);
    }
    // Trains missing from two updates in a row have left the model or the service.
    for (const [key, t] of this.trains) {
      if (!seen.has(key) && now - t.lastSeen > this.source.pollInterval * 2.5) this.trains.delete(key);
    }
  }
}
