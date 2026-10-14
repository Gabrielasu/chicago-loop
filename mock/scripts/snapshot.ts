/**
 * Write build/trains-snapshot.json: where every train is at one moment, for the
 * Blender stills. Usage: node mock/scripts/snapshot.ts [ISO time]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "../src/network-data.ts";
import { CONSIST } from "../src/schedule.ts";
import { createSimulator } from "../src/simulator.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// A weekday morning when trains of four lines are passing through Tower 18.
const when = new Date(process.argv[2] ?? "2026-10-13T07:50:30-05:00");
const sim = createSimulator(network, { seed: 1 });
const [x0, y0, x1, y1] = network.bounds;
const out = sim
  .trains(when)
  .filter((t) => t.position[0] > x0 - 200 && t.position[0] < x1 + 200 && t.position[1] > y0 - 200 && t.position[1] < y1 + 200)
  .map((t) => ({ route: t.route, run: t.run, distance: t.distance, cars: CONSIST[t.route], points: t.trip.path.points }));
mkdirSync(join(root, "build"), { recursive: true });
writeFileSync(join(root, "build", "trains-snapshot.json"), JSON.stringify(out));
console.log(`wrote build/trains-snapshot.json: ${out.length} trains at ${when.toISOString()}`);
