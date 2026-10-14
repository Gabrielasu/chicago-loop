/**
 * Write sample responses to mock/samples/ for a few moments of a weekday and a Saturday.
 * Usage: node mock/scripts/samples.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ttpositions } from "../src/api.ts";
import { network } from "../src/network-data.ts";
import { createSimulator } from "../src/simulator.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "samples");
mkdirSync(out, { recursive: true });
const sim = createSimulator(network, { seed: 1 });

// Chicago is on daylight saving time (UTC-5) on these dates.
const moments: [string, string, string][] = [
  ["weekday-0815-am-rush", "2026-10-13T08:15:00-05:00", "rt=brn,g,org,p,pink&outputType=JSON"],
  ["weekday-1230-midday", "2026-10-13T12:30:00-05:00", "rt=brn,g,org,p,pink&outputType=JSON"],
  ["weekday-1730-pm-rush", "2026-10-13T17:30:00-05:00", "rt=brn,g,org,p,pink&outputType=JSON"],
  ["weekday-2345-late", "2026-10-13T23:45:00-05:00", "rt=brn,g,org,p,pink&outputType=JSON"],
  ["saturday-1400", "2026-10-17T14:00:00-05:00", "rt=brn,g,org,p,pink&outputType=JSON"],
  ["single-route-pink", "2026-10-13T12:30:00-05:00", "rt=pink&outputType=JSON"],
  ["error-invalid-route", "2026-10-13T12:30:00-05:00", "rt=brn,purple&outputType=JSON"],
];

for (const [name, iso, query] of moments) {
  const res = ttpositions(sim, `key=MOCK&${query}`, new Date(iso));
  writeFileSync(join(out, `${name}.json`), `${JSON.stringify(res, null, 2)}\n`);
  const count = (res.ctatt.route ?? []).reduce(
    (n, r) => n + (Array.isArray(r.train) ? r.train.length : r.train ? 1 : 0),
    0,
  );
  console.log(`${name}.json  ${count} trains`);
}
