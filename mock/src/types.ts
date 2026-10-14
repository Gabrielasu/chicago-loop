/**
 * Types for the CTA Train Tracker Locations API (ttpositions.aspx, outputType=JSON)
 * and for the network data exported by the pipeline.
 *
 * Field names, order and types follow CTA's published Train Tracker documentation:
 * every value in the JSON output is a string, empty values are null.
 */

/** Route identifiers accepted by the rt parameter (lowercase, as CTA returns them in "@name"). */
export type RouteCode = "red" | "blue" | "brn" | "g" | "org" | "p" | "pink" | "y";

/** The Loop routes this project models. */
export type LoopRoute = "brn" | "g" | "org" | "p" | "pink";
export const LOOP_ROUTES: readonly LoopRoute[] = ["brn", "g", "org", "p", "pink"];

export interface CtaTrain {
  /** Run number */
  rn: string;
  /** GTFS stop id where the train ends its run */
  destSt: string;
  /** Friendly destination name */
  destNm: string;
  /** Direction code: 1 or 5, meaning depends on the route */
  trDr: string;
  /** Next parent station id (GTFS, 4xxxx) */
  nextStaId: string;
  /** Next platform stop id (GTFS, 3xxxx) */
  nextStpId: string;
  /** Proper name of the next station */
  nextStaNm: string;
  /** When the prediction was generated, yyyy-MM-ddTHH:mm:ss Chicago time */
  prdt: string;
  /** Predicted arrival or departure at the next station, same format */
  arrT: string;
  /** "1" when Train Tracker says Approaching or Due */
  isApp: string;
  /** "1" when the train is considered delayed */
  isDly: string;
  /** Not in use; always null */
  flags: string | null;
  lat: string;
  lon: string;
  /** Bearing in whole degrees, 0 = north, 90 = east, range 0 to 359 */
  heading: string;
}

export interface CtaRoute {
  "@name": string;
  /** CTA returns a bare object instead of an array when a route has one train. */
  train?: CtaTrain[] | CtaTrain;
}

export interface CtaPositionsResponse {
  ctatt: {
    tmst: string;
    errCd: string;
    errNm: string | null;
    route?: CtaRoute[];
  };
}

// ----------------------------------------------------------------- network

export type XY = [number, number];

export interface NetworkStop {
  name: string;
  stationId: number | null;
  stopId: number | null;
  stopName: string | null;
  /** Distance along the pattern, meters */
  distance: number;
}

export interface NetworkPattern {
  osmRelation: number;
  name: string;
  from: string;
  to: string;
  length: number;
  /** Local meters, x east, y north, origin State & Madison */
  points: XY[];
  /** [lat, lon] for every point */
  latlon: XY[];
  stops: NetworkStop[];
}

export interface NetworkLine {
  name: string;
  color: string;
  patterns: NetworkPattern[];
}

export interface NetworkStation {
  id: number;
  name: string;
  status: "open" | "closed";
  loop: boolean;
  location: XY;
  lines: string[];
  stops: { stopId: number; name: string }[];
  note?: string;
}

export interface NetworkTrack {
  id: string;
  track: "inner_loop" | "outer_loop" | "main";
  lines: string[];
  points: XY[];
}

export interface Network {
  generated: string;
  origin: { lat: number; lon: number };
  projection: string;
  bounds: [number, number, number, number];
  trackZ: number;
  lines: Record<LoopRoute, NetworkLine>;
  stations: NetworkStation[];
  tracks: NetworkTrack[];
  junctions: { name: string; location: XY }[];
}
