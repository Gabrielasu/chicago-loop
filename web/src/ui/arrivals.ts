/** Trains whose next stop is a given station, soonest first. */

import type { CtaTrain } from "@chicago-loop/mock";

export interface Arrival {
  key: string;
  route: string;
  train: CtaTrain;
}

export function arrivalsAt(
  stationId: number,
  trains: Iterable<{ key: string; route: string; info: CtaTrain }>,
): Arrival[] {
  const out: Arrival[] = [];
  for (const t of trains) {
    if (Number(t.info.nextStaId) === stationId) out.push({ key: t.key, route: t.route, train: t.info });
  }
  return out.sort((a, b) => a.train.arrT.localeCompare(b.train.arrT) || a.route.localeCompare(b.route));
}
