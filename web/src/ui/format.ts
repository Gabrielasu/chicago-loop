/** Small text formatters for the interface. Pure, so they are tested. */

import type { CtaTrain } from "@chicago-loop/mock";

/** "2026-10-13T08:15:32" to "08:15:32". */
export function clockTime(tmst: string | null): string {
  if (!tmst) return "--:--:--";
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(tmst);
  return m ? m[1]! : tmst;
}

/** When the train reaches its next station, relative to the response time. */
export function arrival(train: CtaTrain, tmst: string | null): string {
  if (train.isApp === "1") return "Due";
  const a = Date.parse(train.arrT);
  const now = tmst ? Date.parse(tmst) : NaN;
  if (Number.isNaN(a) || Number.isNaN(now)) return clockTime(train.arrT).slice(0, 5);
  const minutes = Math.max(Math.round((a - now) / 60000), 1);
  return `${minutes} min`;
}

export function direction(route: string, trDr: string): string {
  const table: Record<string, Record<string, string>> = {
    brn: { "1": "Kimball-bound", "5": "Loop-bound" },
    g: { "1": "Harlem/Lake-bound", "5": "South-bound" },
    org: { "1": "Loop-bound", "5": "Midway-bound" },
    p: { "1": "Linden-bound", "5": "Loop-bound" },
    pink: { "1": "Loop-bound", "5": "54th/Cermak-bound" },
  };
  return table[route]?.[trDr] ?? "";
}
