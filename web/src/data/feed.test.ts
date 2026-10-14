import { createSimulator, MockTrainSource, trainsOf } from "@chicago-loop/mock";
import { network } from "@chicago-loop/mock/network";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSnapPath } from "../trains/snapping.ts";
import { TrainFeed } from "./feed.ts";

const sim = createSimulator(network, { seed: 1 });
const paths = sim.trips.map((t) => makeSnapPath(`${t.route}:${t.index}`, t.route, t.path));
const at = (iso: string) => new Date(iso);

function feedAt(iso: string) {
  const source = new MockTrainSource({ simulator: sim, clock: () => at(iso), pollInterval: 5000 });
  return new TrainFeed(source, paths, network.bounds);
}

describe("TrainFeed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the trains near the model, each snapped onto its line", async () => {
    const feed = feedAt("2026-10-13T08:15:00-05:00");
    await feed.poll(0);
    expect(feed.status.error).toBeNull();
    expect(feed.trains.size).toBeGreaterThan(8);
    for (const t of feed.trains.values()) {
      const s = t.history.latest!;
      expect(s.pathId.startsWith(`${t.route}:`)).toBe(true);
    }
    const all = trainsOf(sim.positions(at("2026-10-13T08:15:00-05:00")));
    expect(feed.trains.size).toBeLessThan(all.length);
  });

  it("ignores routes it has no track for", () => {
    const feed = feedAt("2026-10-13T08:15:00-05:00");
    const any = trainsOf(sim.positions(at("2026-10-13T08:15:00-05:00")))[0]!;
    feed.ingest([{ route: "red", train: any.train }], 0);
    expect(feed.trains.size).toBe(0);
  });

  it("drops trains that stop being reported", async () => {
    const feed = feedAt("2026-10-13T08:15:00-05:00");
    await feed.poll(0);
    const n = feed.trains.size;
    feed.ingest([], 5000);
    expect(feed.trains.size).toBe(n);
    feed.ingest([], 13000);
    expect(feed.trains.size).toBe(0);
  });

  it("starts polling once, however often it is started", () => {
    const timers: number[] = [];
    vi.stubGlobal("window", {
      setInterval: () => timers.push(timers.length + 1) && timers.length,
      clearInterval: () => undefined,
    });
    const feed = feedAt("2026-10-13T08:15:00-05:00");
    feed.restart();
    expect(timers).toHaveLength(0);
    feed.start();
    feed.start();
    expect(timers).toHaveLength(1);
    feed.restart();
    expect(timers).toHaveLength(2);
  });
});
