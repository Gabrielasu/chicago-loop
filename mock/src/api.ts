/**
 * The ttpositions.aspx endpoint, mocked: same parameters, same errors, same JSON.
 *
 * Only the Loop routes are simulated. Red, Blue and Yellow are valid route codes
 * but come back without trains.
 */

import type { Simulator } from "./simulator.ts";
import { ctaTimestamp } from "./time.ts";
import type { CtaPositionsResponse, RouteCode } from "./types.ts";

export const VALID_ROUTES: readonly RouteCode[] = ["red", "blue", "brn", "g", "org", "p", "pink", "y"];

function error(now: Date, code: string, message: string): CtaPositionsResponse {
  return { ctatt: { tmst: ctaTimestamp(now), errCd: code, errNm: message } };
}

/** Answer a Locations API query string (key, rt, outputType) at a moment. */
export function ttpositions(sim: Simulator, query: string | URLSearchParams, now: Date): CtaPositionsResponse {
  const params = typeof query === "string" ? new URLSearchParams(query.replace(/^\?/, "")) : query;
  for (const name of params.keys()) {
    if (!["key", "rt", "outputType", "outputtype"].includes(name)) {
      return error(now, "500", `Invalid parameter: '${name}'`);
    }
  }
  const rt = params.get("rt");
  if (!rt) return error(now, "100", "Required parameter 'rt' is missing.");
  const routes = rt.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (routes.length > 8) return error(now, "107", "Maximum number of rt's per request is 8.");
  const bad = routes.find((r) => !VALID_ROUTES.includes(r as RouteCode));
  if (bad) return error(now, "106", `Invalid route identifier: '${bad}'`);
  return sim.positions(now, routes);
}
