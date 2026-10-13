# Progress

## Phase 1: Data pipeline (done)

Done:
- `scripts/setup.sh` installs Python 3.11, bpy 5.0.1 and the pipeline dependencies (pyproj, shapely, pytest, ruff). `uv` was missing on this machine and was installed with Homebrew.
- `pipeline/fetch.py` downloads `data/loop.osm` (Overpass), `data/building-footprints.geojson` (City of Chicago, syp8-uezg) and `data/cta-l-stops.json` (City of Chicago, CTA L stops 8pix-ypme) when missing.
- `pipeline/build.py` writes `build/loop.json`: buildings with footprints, heights, estimated flags, materials and names; elevated track pieces tagged Inner Loop, Outer Loop, main, crossover or siding; full route paths for each line and direction with their stops; the eight Loop stations plus Merchandise Mart with platform and canopy outlines; Tower 18 and Tower 12; river, bridges, streets, street surfaces and parks.
- `pipeline/validate.py` checks the eight stations, the absence of Randolph/Wabash and Madison/Wabash, that both Loop tracks close around State & Madison, and that Tower 18 sits at Lake and Wells with the right lines passing through it.
- `pipeline/report.py` writes `docs/data-report.md`.
- `blender/preview_data.py` renders `build/phase1-preview.png` and a plan view, `build/phase1-preview-plan.png`.
- pytest: projection (origin, axes, round trip, distances against the WGS84 ellipsoid), height rules, OSM way joining, and checks on the real build.
- Run it all with `./scripts/build-data.sh`.

Decisions:
- **Origin** is read from the data: the node shared by State St and Madison St (OSM node 27446720). Projection is a transverse Mercator centred there, so local distances match the ellipsoid to 1e-5.
- **Line paths come from OpenStreetMap route relations**, which give the exact sequence of track each line and direction uses. That is how we know Brown runs counterclockwise on the Outer Loop and Orange, Pink and Purple run clockwise on the Inner Loop, matching the CTA stop list. Inner and Outer Loop tracks are labelled from this, not guessed from geometry.
- **Full line lengths** are kept (simplified outside the model) so the mock can run whole routes with real distances and show only the trains inside the model.
- **CTA stop ids** (`stop_id`, `map_id`) come from the City's CTA stop list and are matched to each OSM stop by line, distance and direction of travel.
- **State/Lake is closed** (5 January 2026, rebuild to 2029). OSM tags it as disused with no platforms. We model the station with estimated platforms and the mock trains pass through. This departs from the brief, which lists it as current; it is one flag to change when the station reopens.
- **Building parts** (Simple 3D Buildings) replace their outline when present, which gives real setbacks for towers like Willis and Trump. Parts with no height are kept low instead of inheriting the full building height.
- **Heights**: OSM height, then OSM levels, then city stories at 3.9 m per floor, then defaults by type and size (canopies as thin slabs, kiosks one floor, others four). All but OSM height are flagged estimated.
- **Track height** of 6.0 m top of rail is an estimate; it is not in the data.
- **Design direction**: the brief for this run describes a modern massing model look. The CLAUDE.md in the zip still had the earlier Plan of Chicago palette, so CLAUDE.md now carries the modern direction.

Left for later phases: everything from the Blender model on.

## Phase 2: Blender model (done)

Done:
- `blender/build_loop.py` builds the scene from `build/loop.json` in collections `buildings`, `l_structure`, `stations`, `river`, `streets`, renders `build/renders/{aerial,junction,street,station}-{day,night}.png` at 1600x900 and exports `build/loop.glb` (Draco, about 2 MB, a named node for every station and every track way).
- `blender/looks.py` holds the day and night looks; `blender/loopgeom.py` the mesh helpers; `blender/README.md` explains it all.
- The L: rails, ties, plate girders and Warren bracing on every OSM track way, column bents every 14 m (spanning all tracks at that point, so the junctions get wide bents), cross girders flush with the track girders, knee braces, no columns in the river, the Tower 18 signal box on the structure.
- Stations: mapped platform and canopy outlines, edge strips, railings, canopy columns and lights, stairs from each mapped street entrance, signs with one square per line in CTA colors.

Decisions:
- **Aerial camera** looks north up the street grid. From any diagonal the L disappears between the towers; from the south the Wells, Van Buren and Wabash structures read as the Loop.
- **Junction camera** looks nearly straight down on Tower 18. Every oblique view was blocked by the corner towers, and the plan view shows the real track geometry best.
- **Platforms and station houses from the City footprints** are dropped from the buildings: the city draws CTA platforms as buildings. Anything low that overlaps the track bed is left to the L model.
- **Top of rail raised to 6.4 m** (estimate) after the first street render showed the structure too low; cross girders now frame flush into the track girders as on the real structure.
- **Night lighting** uses point lights along the streets (stills only). An emissive street surface looked flat at street level.
- Added a fourth camera at Quincy to show station detail; the three required views are aerial, junction and street.
- Rendering uses Metal on this Mac; `--cpu` forces CPU for CI and sandboxes.

## Phase 3: Mock trains (done)

Done:
- `docs/cta-api.md`: the Locations API format from CTA's published documentation (read 12 October 2026), and what the mock does and estimates.
- `mock/`: a TypeScript simulator (`createSimulator`) and a mocked `ttpositions.aspx` (`ttpositions`) answering with the documented JSON, including error codes. Trains run the whole line on the real paths from `mock/data/network.json` (exported from `build/loop.json` by `python -m pipeline.export_network`), accelerate, cruise under speed and curve limits, brake and dwell at each station, with run numbers, destinations, next stations, predictions and headings.
- Deterministic: a seed plus a clock. `mock/samples/` has responses for a weekday at 08:15, 12:30, 17:30 and 23:45, a Saturday, a single route and an error (`npm run samples`).
- `TrainSource` with `MockTrainSource` and `LiveTrainSource`, picked by `VITE_TRAIN_SOURCE` (mock by default). The live source calls the proxy at `VITE_TRAIN_PROXY_URL`; `proxy/worker.ts` is the Cloudflare Worker for it, written but not deployed.
- Vitest (18 tests): the documented format and errors, trains on their trip path and on mapped tracks of their own line inside the model, legs joined without gaps, no backward motion, speed caps, determinism, rush and late night counts, Purple Express on weekday rush only, dwell at every stop, no stop at State/Lake, Loop direction per line.

Decisions:
- **Simulate whole lines, not just the Loop.** The real API returns every train on a line; the viewer filters to the model. It also means trains enter the model on the right track at the right time.
- **Timing is analytic, not stepped.** Each trip has a run profile computed once; a train's position is a lookup from its departure time, so any clock time can be asked for directly (tests, samples, scrubbing).
- **Service days run 03:00 to 03:00**, so trains after midnight stay on the evening timetable.
- **Speeds** were tuned down after the first run gave terminal to Loop times well under CTA's; open running is now 35 mph, the Loop 25 mph.
- **Only the five Loop lines** are simulated; Red, Blue and Yellow are valid codes that return no trains.
- Lint: ESLint with typescript-eslint strict, TypeScript 6.0 in strict mode (typescript-eslint does not support TypeScript 7 yet).

## Phase 4: Web viewer (done)

Done:
- `web/`: Vite, TypeScript (strict) and three.js, in modules for the scene (`scene/`), loaders, trains, data and interface. `npm run dev` runs it.
- Loads `public/model/loop.glb` (the Blender export, committed, 2 MB) with the same day and night materials as the renders; AgX tone mapping, sun shadows over the whole model, GTAO ambient occlusion on desktops.
- Trains from the `TrainSource` (mock by default), snapped to the right directed track of their line, eased along the track between updates, drawn as instanced cars that follow curves.
- Orbit and zoom, Overview, Tower 18 and a street level walk mode on Wabash; hover or tap a train for its details; station labels, line legend with live counts, last updated time.
- Vitest for snapping, easing and interface text (16 tests). `web/README.md` covers running it and switching to live data.
- Checked in headless Chrome at 1600x900 and on a 390x844 phone viewport: 60 fps on this Mac in both.

Decisions:
- **Snap to directed line paths, not to physical tracks.** The Inner and Outer Loop tracks are four meters apart; a path knows its direction of travel, so the train's heading picks the right track. Paths are the same composed trips the mock runs, so Loop lines glide through the change from Loop-bound to outbound without a jump.
- **Draw one update in the past.** Easing between the last two snapped positions gives smooth motion at any update rate (5 s mock, about 30 s live) at the cost of that delay.
- **Cars outside the model are not drawn**, so trains appear at the edge of the plinth rather than floating beyond it.
- Labels hide when they would overlap one already placed, flip to the left at the right edge of the screen, and at street level only stations within 450 m are labelled.
- Narrow screens step the camera back so the whole Loop fits in portrait.

## Phase 5: Design and README (done)

Done:
- Viewer interface in the modern direction: a strict grid of solid panels with one pixel rules, no rounded corners, shadows, gradients or icons. Big Shoulders Display for the wordmark only, Schibsted Grotesk for the interface, Chivo Mono for data. Light and dark themes follow the day and night model. Fonts are self-hosted from Fontsource.
- Landing page (`web/index.html`): one screen on a twelve column grid with the hero render, a plain explanation, the key figures, a link into the viewer and data credits.
- README with the hero render, a GIF of trains moving through Tower 18 (`docs/media/trains-tower18.gif`, recorded with `scripts/capture-gif.mjs`), the other renders, how it works, how to run it, what is estimated, how to go live, and data credits.
- Accessibility: every text color pair passes WCAG AA (lowest 5.07:1, muted text on the backdrop); all controls are buttons with pressed states and labels; keyboard shortcuts for views, theme and clearing a selection; the legend selects trains, so train details work without a pointer; camera moves are instant under reduced motion; line colors always sit next to the line name.
- GitHub Actions (`.github/workflows/ci.yml`): ESLint, TypeScript, Vitest and the production build; ruff and pytest for the pipeline.

Decisions:
- Panels are opaque, not translucent, to stay readable over the model without any blur effects.
- The recording option `?ui=off` hides the interface for clean captures.
- CI runs the pipeline tests without bpy or the raw data; the checks on a real `build/loop.json` run locally and skip in CI.

What is left for Gabi:
- Answer the open questions in `docs/PLAN.md` (Red and Blue subways, hosting).
- Get a CTA Train Tracker key, deploy `proxy/`, set `VITE_TRAIN_SOURCE=live` and `VITE_TRAIN_PROXY_URL`.
- When State/Lake reopens (expected 2029), remove it from `CLOSED_STATIONS` in `pipeline/build.py` and rebuild.
