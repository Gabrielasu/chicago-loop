/**
 * Find departure phases that interleave the lines on shared track: coordinate
 * descent on the total time trains are held by the dispatcher on a weekday.
 * Prints the PHASES table for mock/src/schedule.ts.
 * Usage: node mock/scripts/tune-phases.ts
 */

import { network } from "../src/network-data.ts";
import { SERVICES } from "../src/schedule.ts";
import { createSimulator, dispatch } from "../src/simulator.ts";

const sim = createSimulator(network, { seed: 1 });
const keys = sim.trips.map((t) => `${t.route}:${t.index}`);
const phases: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));

function cost(p: Record<string, number>): number {
  let total = 0;
  for (const day of ["2026-10-13", "2026-10-14"]) {
    for (const r of dispatch(sim.trips, 1, day, false, p)) total += r.start - r.scheduled;
  }
  return total;
}

let best = cost(phases);
console.error(`start: ${(best / 60).toFixed(0)} train-minutes of holding and delay`);
for (let round = 0; round < 3; round++) {
  for (const key of keys) {
    const [route] = key.split(":") as [keyof typeof SERVICES];
    // Search one rush headway in 20 s steps.
    const peak = Math.min(...SERVICES[route].weekday.map((b) => b[2])) * 60;
    let bestPhase = phases[key]!;
    for (let ph = 0; ph < peak; ph += 20) {
      const trial = { ...phases, [key]: ph };
      const c = cost(trial);
      if (c < best) {
        best = c;
        bestPhase = ph;
      }
    }
    phases[key] = bestPhase;
  }
  console.error(`round ${round + 1}: ${(best / 60).toFixed(0)} train-minutes`);
}
console.log(JSON.stringify(phases, null, 2));
