/**
 * Where the viewer gets trains from. Both sources answer with the exact Train
 * Tracker Locations JSON, so the viewer cannot tell them apart.
 *
 *   VITE_TRAIN_SOURCE=mock   simulated trains in the browser (default)
 *   VITE_TRAIN_SOURCE=live   CTA Train Tracker through the proxy at VITE_TRAIN_PROXY_URL
 */

import { ttpositions } from "./api.ts";
import type { Simulator } from "./simulator.ts";
import type { CtaPositionsResponse, CtaTrain, LoopRoute } from "./types.ts";

export interface TrainSource {
  readonly kind: "mock" | "live";
  /** How often to ask for new positions, in milliseconds */
  readonly pollInterval: number;
  fetch(routes: readonly LoopRoute[]): Promise<CtaPositionsResponse>;
}

export interface MockSourceOptions {
  simulator: Simulator;
  /** The simulated clock. Defaults to the real time. */
  clock?: () => Date;
  pollInterval?: number;
}

export class MockTrainSource implements TrainSource {
  readonly kind = "mock" as const;
  readonly pollInterval: number;
  private readonly simulator: Simulator;
  private readonly clock: () => Date;

  constructor(options: MockSourceOptions) {
    this.simulator = options.simulator;
    this.clock = options.clock ?? (() => new Date());
    this.pollInterval = options.pollInterval ?? 5000;
  }

  fetch(routes: readonly LoopRoute[]): Promise<CtaPositionsResponse> {
    const query = new URLSearchParams({ rt: routes.join(","), outputType: "JSON" });
    return Promise.resolve(ttpositions(this.simulator, query, this.clock()));
  }
}

export interface LiveSourceOptions {
  /** The proxy that adds the API key, for example https://cta-proxy.example.workers.dev/ttpositions */
  endpoint: string;
  pollInterval?: number;
}

/**
 * Live CTA data. The browser never sees the API key: requests go to a small
 * Cloudflare Worker (proxy/worker.ts) that adds CTA_TRAIN_TRACKER_KEY from its
 * secrets and forwards the call to lapi.transitchicago.com.
 *
 * TODO: deploy the Worker once there is a key, then set VITE_TRAIN_SOURCE=live
 * and VITE_TRAIN_PROXY_URL to its URL.
 */
export class LiveTrainSource implements TrainSource {
  readonly kind = "live" as const;
  readonly pollInterval: number;
  private readonly endpoint: string;

  constructor(options: LiveSourceOptions) {
    this.endpoint = options.endpoint;
    this.pollInterval = options.pollInterval ?? 30000;
  }

  async fetch(routes: readonly LoopRoute[]): Promise<CtaPositionsResponse> {
    if (!this.endpoint) {
      throw new Error("VITE_TRAIN_PROXY_URL is not set. Deploy proxy/worker.ts and point the viewer at it.");
    }
    const url = new URL(this.endpoint);
    url.searchParams.set("rt", routes.join(","));
    url.searchParams.set("outputType", "JSON");
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Train Tracker proxy answered ${res.status}`);
    return (await res.json()) as CtaPositionsResponse;
  }
}

export interface SourceEnv {
  VITE_TRAIN_SOURCE?: string | undefined;
  VITE_TRAIN_PROXY_URL?: string | undefined;
}

/** Pick the source from the environment. Mock unless VITE_TRAIN_SOURCE is "live". */
export function createTrainSource(env: SourceEnv, mock: () => TrainSource): TrainSource {
  if ((env.VITE_TRAIN_SOURCE ?? "mock").toLowerCase() === "live") {
    return new LiveTrainSource({ endpoint: env.VITE_TRAIN_PROXY_URL ?? "" });
  }
  return mock();
}

/** Trains of a response as a flat list. Handles CTA's single-train object quirk. */
export function trainsOf(response: CtaPositionsResponse): { route: string; train: CtaTrain }[] {
  const out: { route: string; train: CtaTrain }[] = [];
  for (const r of response.ctatt.route ?? []) {
    const list = r.train == null ? [] : Array.isArray(r.train) ? r.train : [r.train];
    for (const t of list) out.push({ route: r["@name"].toLowerCase(), train: t });
  }
  return out;
}
