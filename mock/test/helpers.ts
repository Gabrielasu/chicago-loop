import { network } from "../src/network-data.ts";
import { createSimulator } from "../src/simulator.ts";

export { network };
export const sim = createSimulator(network, { seed: 1 });

/** A Tuesday in October 2026, Chicago time (UTC-5 in daylight saving time). */
export function chicago(hhmm: string, day = "2026-10-13"): Date {
  return new Date(`${day}T${hhmm}:00-05:00`);
}
