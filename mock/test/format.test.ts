import { describe, expect, it } from "vitest";
import { ttpositions } from "../src/api.ts";
import { trainsOf } from "../src/source.ts";
import type { CtaPositionsResponse } from "../src/types.ts";
import { chicago, sim } from "./helpers.ts";

const FIELDS = [
  "rn", "destSt", "destNm", "trDr", "nextStaId", "nextStpId", "nextStaNm",
  "prdt", "arrT", "isApp", "isDly", "flags", "lat", "lon", "heading",
];
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

describe("Locations API format", () => {
  const now = chicago("08:15");
  const res = ttpositions(sim, "key=x&rt=brn,g,org,p,pink&outputType=JSON", now);

  it("has the documented envelope", () => {
    expect(Object.keys(res.ctatt)).toEqual(["tmst", "errCd", "errNm", "route"]);
    expect(res.ctatt.tmst).toBe("2026-10-13T08:15:00");
    expect(res.ctatt.errCd).toBe("0");
    expect(res.ctatt.errNm).toBeNull();
    expect(res.ctatt.route?.map((r) => r["@name"])).toEqual(["brn", "g", "org", "p", "pink"]);
  });

  it("returns every train with the documented fields as strings", () => {
    const trains = trainsOf(res);
    expect(trains.length).toBeGreaterThan(30);
    for (const { train } of trains) {
      expect(Object.keys(train)).toEqual(FIELDS);
      for (const f of FIELDS) {
        if (f === "flags") expect(train.flags).toBeNull();
        else expect(typeof train[f as keyof typeof train]).toBe("string");
      }
      expect(train.rn).toMatch(/^\d{3}$/);
      expect(train.destSt).toMatch(/^3\d{4}$/);
      expect(train.nextStaId).toMatch(/^4\d{4}$/);
      expect(train.nextStpId).toMatch(/^3\d{4}$/);
      expect(["1", "5"]).toContain(train.trDr);
      expect(["0", "1"]).toContain(train.isApp);
      expect(["0", "1"]).toContain(train.isDly);
      expect(train.prdt).toMatch(STAMP);
      expect(train.arrT).toMatch(STAMP);
      expect(train.arrT >= train.prdt).toBe(true);
      expect(train.lat).toMatch(/^4[12]\.\d{5}$/);
      expect(train.lon).toMatch(/^-87\.\d{5}$/);
      const h = Number(train.heading);
      expect(Number.isInteger(h) && h >= 0 && h <= 359).toBe(true);
    }
  });

  it("uses the direction codes and destinations CTA documents", () => {
    const dirs: Record<string, Record<string, Set<string>>> = {};
    for (const { route, train } of trainsOf(res)) {
      ((dirs[route] ??= {})[train.trDr] ??= new Set()).add(train.destNm);
    }
    expect([...(dirs.brn?.["1"] ?? [])]).toEqual(["Kimball"]);
    expect([...(dirs.brn?.["5"] ?? [])]).toEqual(["Loop"]);
    expect([...(dirs.org?.["1"] ?? [])]).toEqual(["Loop"]);
    expect([...(dirs.org?.["5"] ?? [])]).toEqual(["Midway"]);
    expect([...(dirs.pink?.["1"] ?? [])]).toEqual(["Loop"]);
    expect([...(dirs.p?.["1"] ?? [])]).toEqual(["Linden"]);
    expect([...(dirs.g?.["1"] ?? [])]).toEqual(["Harlem/Lake"]);
    expect([...(dirs.g?.["5"] ?? [])].sort()).toEqual(["Ashland/63rd", "Cottage Grove"]);
  });

  it("answers errors like the real endpoint", () => {
    expect(ttpositions(sim, "key=x", now).ctatt.errCd).toBe("100");
    expect(ttpositions(sim, "rt=brn,purple", now).ctatt.errCd).toBe("106");
    expect(ttpositions(sim, "rt=red,blue,brn,g,org,p,pink,y,red", now).ctatt.errCd).toBe("107");
    expect(ttpositions(sim, "rt=brn&max=3", now).ctatt.errCd).toBe("500");
    const err = ttpositions(sim, "rt=nope", now);
    expect(err.ctatt.route).toBeUndefined();
    expect(err.ctatt.errNm).toContain("nope");
  });

  it("lists routes without trains and reads CTA's single-train objects", () => {
    const red = ttpositions(sim, "rt=red", now);
    expect(red.ctatt.route).toEqual([{ "@name": "red" }]);
    const one: CtaPositionsResponse = {
      ctatt: { tmst: "", errCd: "0", errNm: null, route: [{ "@name": "p", train: trainsOf(res)[0]!.train }] },
    };
    expect(trainsOf(one)).toHaveLength(1);
  });
});
