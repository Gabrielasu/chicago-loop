# Data report

Generated from `build/loop.json` (2026-10-12T22:26:24Z). Rerun with `python -m pipeline.report`.

## Area and coordinates

- Bounding box: 41.8728 to 41.8895 N, 87.6205 to 87.6385 W.
  That is Lake St to Congress Pkwy and Wells St to Michigan Ave plus one block on each side.
- Origin: State St & Madison St at 41.8820455, -87.6278089 (OpenStreetMap node 27446720).
- Projection: `+proj=tmerc +lat_0=41.8820455 +lon_0=-87.6278089 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs`. Meters, x east, y north.
- Extent: 1494 m east to west, 1855 m north to south.

## Buildings

- 1214 building volumes (949 OpenStreetMap outlines, 304 building parts).
- 74 outlines are drawn through their parts instead (Simple 3D Buildings).
- 35 footprints come from the City of Chicago where OpenStreetMap has none.
- Heights estimated: **1016 of 1214** (84 %). Measured: 198.
- Facade material recorded for 195 volumes, 58 of them glass.

| Height source | Volumes |
| --- | ---: |
| OpenStreetMap `building:levels` x 3.9 m | 523 |
| Canopy (`building=roof`): 0.5 m slab at 4.5 m | 202 |
| OpenStreetMap `height` (measured) | 198 |
| Default for kiosks, booths and footprints under 60 m2: 1 floor | 189 |
| Default, 4 floors (15.6 m) | 66 |
| City of Chicago `stories` x 3.9 m | 17 |
| Building part without height: 4 floors, capped by its building | 16 |
| Canopy part without height | 2 |
| Small building part without height: 1 floor | 1 |

Tallest volumes:

| Name | Height (m) | Source |
| --- | ---: | --- |
| Willis Tower | 527 | osm:height |
| Trump International Hotel & Tower Chicago | 423 | osm:height |
| Aon Center | 346 | osm:height |
| Franklin Center North Tower | 307 | osm:height |
| Two Prudential Plaza | 303 | osm:height |
| 311 South Wacker Drive | 293 | osm:height |
| One Prudential Plaza | 278 | osm:height |
| Chase Tower | 259 | osm:height |
| Salesforce Tower | 255 | osm:height |
| Legacy at Millennium Park | 250 | osm:height |

## The L

- Top of rail at 6.4 m above the street (estimated, not in the data).
- 71 elevated track pieces from OpenStreetMap:
  - inner loop: 3172 m
  - outer loop: 3153 m
  - main: 2898 m
  - crossover: 621 m
  - siding: 95 m
- Inner and Outer Loop are told apart by the lines that use them: CTA lists Brown on the Outer Loop
  and Orange, Pink and Purple on the Inner Loop.
- Tower 18 at (-510, 410): Junction of the Loop with the North Side Main Line and the Lake Street line. Signal boxes mapped: 1.
- Tower 12 at (145, -563): Junction of the Loop with the South Side Elevated. Signal boxes mapped: 0.

| Line | Direction | Path length (km) | Stops in the model |
| --- | --- | ---: | --- |
| Brown | Kimball to Loop | 15.5 | Merchandise Mart, Washington/Wells |
| Brown | Loop to Kimball | 17.8 | Washington/Wells, Quincy/Wells, LaSalle/Van Buren, Harold Washington Library-State/Van Buren, Adams/Wabash, Washington/Wabash, Clark/Lake, Merchandise Mart |
| Green | Ashland/63rd to Harlem/Lake | 30.8 | Adams/Wabash, Washington/Wabash, Clark/Lake |
| Green | Cottage Grove to Harlem/Lake | 28.1 | Adams/Wabash, Washington/Wabash, Clark/Lake |
| Green | Harlem/Lake to Ashland/63rd | 30.8 | Clark/Lake, Washington/Wabash, Adams/Wabash |
| Green | Harlem/Lake to Cottage Grove | 27.9 | Clark/Lake, Washington/Wabash, Adams/Wabash |
| Orange | Midway to Loop | 16.9 | Harold Washington Library-State/Van Buren |
| Orange | Loop to Midway | 19.6 | Harold Washington Library-State/Van Buren, LaSalle/Van Buren, Quincy/Wells, Washington/Wells, Clark/Lake, Washington/Wabash, Adams/Wabash |
| Purple | Loop to Linden | 25.8 | Clark/Lake, Washington/Wabash, Adams/Wabash, Harold Washington Library-State/Van Buren, LaSalle/Van Buren, Quincy/Wells, Washington/Wells, Merchandise Mart |
| Purple | Linden to Loop | 23.1 | Merchandise Mart, Clark/Lake |
| Pink | Loop to 54th/Cermak | 16.7 | Clark/Lake, Washington/Wabash, Adams/Wabash, Harold Washington Library-State/Van Buren, LaSalle/Van Buren, Quincy/Wells, Washington/Wells |
| Pink | 54th/Cermak to Loop | 13.8 | Clark/Lake |

## Stations

| Station | CTA id | Status | Platforms | Canopies | Stop ids |
| --- | ---: | --- | --- | ---: | --- |
| Clark/Lake | 40380 | open | 2 | 1 | 30074, 30075 |
| State/Lake | 40260 | closed | 2 (estimated) | 0 | none (trains pass through) |
| Washington/Wabash | 41700 | open | 2 | 1 | 30383, 30384 |
| Adams/Wabash | 40680 | open | 2 | 1 | 30131, 30132 |
| Harold Washington Library-State/Van Buren | 40850 | open | 2 | 3 | 30165, 30166 |
| LaSalle/Van Buren | 40160 | open | 2 | 4 | 30030, 30031 |
| Quincy | 40040 | open | 2 | 4 | 30007, 30008 |
| Washington/Wells | 40730 | open | 2 | 2 | 30141, 30142 |
| Merchandise Mart | 40460 | open | 2 | 0 | 30090, 30091 |

## River, bridges and streets

- River: 9 polygons, 20.6 ha inside the area.
- Bridges: 97 outlines. Named: Adams Street Bridge, BP Bridge, Balbo Bridge, Bataan-Corregidor Memorial Bridge, Clark Street Bridge, Dearborn Street Bridge, DuSable Bridge, Franklin Street Bridge, Harrison Pedestrian Bridge, Harrison Street Bridge, Irv Kupcinet Bridge, Jackson Boulevard Bridge, Jackson Bridge, Lake Street Bridge, Madison Street Bridge, Marshall Suloway Bridge, Monroe Street Bridge, Randolph Street Bridge, Van Buren Pedestrian Bridge, Van Buren Street Bridge, Washington Street Bridge, Wells Street Bridge, William P. Fahey Bridge.
- Streets: 1450 centerlines; width estimated for 1434 (from lanes or road class).
- Parks: 30 polygons.

## Gaps and oddities

- **State/Lake is closed.** CTA closed it on 5 January 2026 for a rebuild expected to finish in 2029,
  and OpenStreetMap now tags it `disused:railway=station` with its platforms removed. The model keeps
  the station at its real location with estimated platforms, and the mock trains pass through it.
- Randolph/Wabash and Madison/Wabash are not in the data and are not modelled (validated).
- Clark/Lake has two station nodes in OpenStreetMap; the Blue Line subway one is skipped.
- Platform canopies and the Tower 18 signal box are mapped as buildings on `layer=2` or `layer=3`.
  46 such volumes are kept out of the street level buildings and built on the L structure.
- Most heights come from floor counts at 3.9 m per floor. Real Loop floor heights range from about
  3.5 m (newer residential) to over 5 m (early office buildings), so these heights are approximate.
- Canopies (`building=roof`) have no height in the data; they are drawn as thin slabs at 4.5 m.
- Building parts without a height are drawn low (4 floors) rather than at the full building height.
- The Overpass API sometimes times out; `pipeline.fetch` retries and falls back to mirrors.
- Lower Wacker Drive and other roads below grade are left out (layer below 0).

## Sources

- OpenStreetMap contributors (ODbL), via the Overpass API
- City of Chicago Data Portal: Building Footprints (syp8-uezg)
- City of Chicago Data Portal: CTA L stops (8pix-ypme)
