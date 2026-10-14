import type { CtaTrain } from "@chicago-loop/mock";
import { describe, expect, it } from "vitest";
import { arrivalsAt } from "./arrivals.ts";

const t = (key: string, nextStaId: string, arrT: string) => ({
  key,
  route: key.split(":")[0]!,
  info: { nextStaId, arrT } as CtaTrain,
});

describe("arrivalsAt", () => {
  it("lists only trains heading to the station, soonest first", () => {
    const list = arrivalsAt(40380, [
      t("brn:401", "40380", "2026-10-13T08:19:00"),
      t("g:002", "40260", "2026-10-13T08:16:00"),
      t("org:701", "40380", "2026-10-13T08:17:30"),
    ]);
    expect(list.map((a) => a.key)).toEqual(["org:701", "brn:401"]);
  });
});
