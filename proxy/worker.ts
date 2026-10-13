/**
 * Cloudflare Worker: forwards Train Tracker Locations requests to CTA with the
 * API key from a secret, and returns the JSON with CORS headers for the viewer.
 *
 * Not deployed yet. Untested against the live API (there is no key yet).
 *
 *   npx wrangler secret put CTA_TRAIN_TRACKER_KEY
 *   npx wrangler deploy
 */

interface Env {
  CTA_TRAIN_TRACKER_KEY: string;
  /** The viewer's origin, for example https://gabrielasu.github.io */
  ALLOWED_ORIGIN: string;
}

const CTA = "https://lapi.transitchicago.com/api/1.0/ttpositions.aspx";
const ROUTES = new Set(["red", "blue", "brn", "g", "org", "p", "pink", "y"]);

function cors(env: Env): Record<string, string> {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN,
    "access-control-allow-methods": "GET, OPTIONS",
    vary: "origin",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(env) });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors(env) });

    const url = new URL(request.url);
    const rt = (url.searchParams.get("rt") ?? "")
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter((r) => ROUTES.has(r));
    if (!rt.length) return new Response("rt is required", { status: 400, headers: cors(env) });

    const upstream = new URL(CTA);
    upstream.searchParams.set("key", env.CTA_TRAIN_TRACKER_KEY);
    upstream.searchParams.set("rt", rt.join(","));
    upstream.searchParams.set("outputType", "JSON");

    // Cache for 15 seconds at the edge: positions change about once a minute and
    // the key has a daily limit.
    const res = await fetch(upstream, { cf: { cacheTtl: 15, cacheEverything: true } } as RequestInit);
    return new Response(res.body, {
      status: res.status,
      headers: { ...cors(env), "content-type": "application/json", "cache-control": "public, max-age=15" },
    });
  },
};
