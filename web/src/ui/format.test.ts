import type { CtaTrain } from "@chicago-loop/mock";
import { describe, expect, it } from "vitest";
import { arrival, clockTime, direction } from "./format.ts";

const train = (over: Partial<CtaTrain>): CtaTrain => ({
  rn: "408", destSt: "30249", destNm: "Kimball", trDr: "1", nextStaId: "40730", nextStpId: "30142",
  nextStaNm: "Washington/Wells", prdt: "2026-10-13T08:15:00", arrT: "2026-10-13T08:18:10",
  isApp: "0", isDly: "0", flags: null, lat: "41.88", lon: "-87.63", heading: "180", ...over,
});

describe("format", () => {
  it("shows the clock time of a Train Tracker stamp", () => {
    expect(clockTime("2026-10-13T08:15:32")).toBe("08:15:32");
    expect(clockTime(null)).toBe("--:--:--");
  });

  it("shows minutes to the next station, or Due", () => {
    expect(arrival(train({}), "2026-10-13T08:15:00")).toBe("3 min");
    expect(arrival(train({ arrT: "2026-10-13T08:15:20" }), "2026-10-13T08:15:00")).toBe("1 min");
    expect(arrival(train({ isApp: "1" }), "2026-10-13T08:15:00")).toBe("Due");
  });

  it("names the direction codes", () => {
    expect(direction("brn", "5")).toBe("Loop-bound");
    expect(direction("org", "5")).toBe("Midway-bound");
  });
});
