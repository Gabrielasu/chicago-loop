# CTA Train Tracker: Locations API

The viewer reads train positions in the exact format of CTA's Train Tracker Locations API. Until there is an API key it reads them from the mock in `mock/`, which answers with the same JSON. This page records the format from CTA's published documentation (transitchicago.com/developers/ttdocs, read on 12 October 2026) and what the mock does where the documentation is silent.

## Request

```
https://lapi.transitchicago.com/api/1.0/ttpositions.aspx?key=KEY&rt=brn,g,org,p,pink&outputType=JSON
```

| Parameter | Required | Notes |
| --- | --- | --- |
| `key` | yes | Free key from transitchicago.com/developers. Never sent from the browser: the proxy adds it. |
| `rt` | yes | One or more route codes, comma separated, at most 8: `red`, `blue`, `brn`, `g`, `org`, `p`, `pink`, `y`. |
| `outputType` | no | `JSON`; XML is the default. |

## Response

```json
{
  "ctatt": {
    "tmst": "2026-10-13T08:15:00",
    "errCd": "0",
    "errNm": null,
    "route": [
      {
        "@name": "brn",
        "train": [
          {
            "rn": "408",
            "destSt": "30249",
            "destNm": "Loop",
            "trDr": "5",
            "nextStaId": "41440",
            "nextStpId": "30278",
            "nextStaNm": "Addison",
            "prdt": "2026-10-13T08:14:44",
            "arrT": "2026-10-13T08:15:35",
            "isApp": "1",
            "isDly": "0",
            "flags": null,
            "lat": "41.95171",
            "lon": "-87.67483",
            "heading": "179"
          }
        ]
      }
    ]
  }
}
```

Every value is a string; empty values are `null`. Times are Chicago local time, `yyyy-MM-ddTHH:mm:ss` in JSON.

| Field | Meaning |
| --- | --- |
| `tmst` | When the response was generated |
| `errCd`, `errNm` | Error code (`0` is success) and message |
| `route` | One per requested route; `@name` is the route code |
| `rn` | Run number |
| `destSt` | GTFS stop id where the run ends |
| `destNm` | Destination name |
| `trDr` | Direction code, see below |
| `nextStaId` | Next station, GTFS parent station id (4xxxx) |
| `nextStpId` | Next platform, GTFS stop id (3xxxx) |
| `nextStaNm` | Next station name |
| `prdt` | When the prediction was made |
| `arrT` | Predicted arrival (or departure) at the next station |
| `isApp` | `1` when Train Tracker shows Approaching or Due |
| `isDly` | `1` when the train is considered delayed |
| `flags` | Not in use |
| `lat`, `lon` | Position in decimal degrees |
| `heading` | Bearing in degrees: 0 north, 90 east, 180 south, 270 west (0 to 359) |

Direction codes (`trDr`) are operational, not compass directions:

| Route | 1 | 5 |
| --- | --- | --- |
| Brown | Kimball-bound | Loop-bound |
| Green | Harlem/Lake-bound | Ashland/63rd or Cottage Grove-bound |
| Orange | Loop-bound | Midway-bound |
| Pink | Loop-bound | 54th/Cermak-bound |
| Purple | Linden-bound | Howard or Loop-bound |

Errors:

| Code | Message |
| --- | --- |
| 100 | Required parameter missing |
| 101 | Invalid API key |
| 102 | Maximum daily usage exceeded |
| 106 | Invalid route identifier |
| 107 | Maximum number of rt's per request is 8 |
| 500 | Invalid parameter |

A known quirk of the JSON output, converted from XML: a route with exactly one train returns `train` as an object, not an array, and a route with none has no `train` key. The viewer handles both (`trainsOf` in `mock/src/source.ts`).

## What the mock does

`mock/src/simulator.ts` produces the response above for any moment.

From real data:
- Each line's path, in order, from the OpenStreetMap route relations, so trains run the real track and the right way around the Loop: Brown counterclockwise on the Outer Loop, Orange, Pink and Purple clockwise on the Inner Loop, Green straight through on Lake and Wabash.
- Every stop on the path and its GTFS station and stop ids from the City of Chicago CTA stop list. State/Lake is closed for its rebuild, so no train stops there.
- Route codes, direction codes, field names and formats from CTA's documentation.

Estimated (not in any open feed we use):
- Headways and service hours, patterned on CTA weekday timetables (for example Brown every 4 minutes in the rush and 7.5 midday; Purple Line Express on weekday rush hours only). Weekends run less often and without the Purple Express.
- Speeds: 35 mph between stations, 25 mph on and near the Loop, curves limited by a lateral acceleration of 0.5 m/s2, acceleration 0.9 and braking 1.0 m/s2. Dwell 30 s at Loop stations, 25 s elsewhere.
- Run numbers: Brown 4xx, Orange 7xx, Pink 3xx, Purple 5xx, Green 0xx toward Harlem and 6xx toward the south side.
- Where the direction code flips on Loop lines: at the Loop station where the OpenStreetMap route relation splits (Brown at Washington/Wells, Orange at Harold Washington Library, Pink and Purple at Clark/Lake).
- `destSt` for Loop-bound trains: the terminal the run returns to.
- About one train in twenty runs four to nine minutes late and is flagged `isDly`; the others run up to 90 seconds late. `prdt` lags the response by up to 25 seconds.
- Only the five Loop lines are simulated. `red`, `blue` and `y` are accepted and come back without trains.
- The mock does not check the `key`.

Trains keep their distance. A dispatcher (`dispatch` in `mock/src/simulator.ts`) holds each run at its terminal until it reaches every platform in the model at least 60 seconds after the train before it, and finds the track it needs through Tower 18 and Tower 12 clear for 20 seconds after the last train left it. Moves through a junction that use different tracks run at the same time; moves that share or cross track wait. Departure phases per line (`PHASES` in `mock/src/schedule.ts`, tuned with `node mock/scripts/tune-phases.ts`) interleave the five lines on the Loop the way a timetable would, so in the rush most trains are held less than two minutes. A test checks a full weekday and a Saturday: no two trains are ever on the same track closer than a train length inside the model.

The simulator is deterministic: the same seed and the same moment always give the same response. Samples for a weekday and a Saturday are in `mock/samples/` (regenerate with `npm run samples`).
