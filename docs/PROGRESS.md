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

## Refinement: night (in progress, not committed)

Gabi asked for a real night time Loop: lights on, people living in the buildings.

Done:
- Lit windows in Blender (`add_window_lights` in `blender/looks.py`) and in the viewer (`web/src/scene/windows.ts`), the same pattern in both: floors every 3.9 m, bays every 3 m, frame depth by facade type, about 40 % lit with a slow noise making some blocks busier, mostly warm light with some cool white, varied brightness. Shader only; the glTF did not grow.
- Viewer night: brighter sky fill, a warm glow on streets and sidewalks, bloom on desktops, windows that fade to their average glow when smaller than a pixel (no sparkle in the overview).
- Platform and canopy glow toned down so stations read as lit, not blown out.
- Forgiving train picking: nearest train within 22 px (36 px on touch) when the ray misses.
- Loading screen: wordmark with a thin progress rule.
- Night renders and README media regenerated.

## Refinement: trains, controls and the city (in progress, not committed)

Gabi asked for better visibility of the trains from higher up, better controls for moving around, and a better designed city.

Trains:
- Trains are real looking cars: curved roof, window band, end windows, doors, trucks and roof equipment, head and tail lamps. Each car rests on two trucks on the track, so trains bend through the corners and Tower 18 like the real ones.
- From far away cars are drawn wider and taller (not longer) so they read from above.
- Markers over every train in its line color, pointing the way it runs, visible through buildings; a faint building mode; route lines along the L from higher up; a live plan of the Loop in the side panel.
- The mock had trains running into each other where lines merge. It now dispatches like block signals and interlockings would: 60 s between trains at any platform in the model, junction tracks clear for 20 s after the last train, crossing moves only when the track is free. Departure phases are tuned so the five lines interleave. Tested over a full weekday and Saturday.

Controls:
- Keyboard pan, turn and zoom; zoom toward the pointer; double-click to fly; the camera is kept over the model.
- Follow a train (the camera rises over buildings to keep it in view) or ride at its front.
- Walking on Wabash collides with buildings and the L's columns; Shift to run.
- Station labels open the trains on their way to that station.
- Mock clock at 1x, 10x and 60x from the status bar.

City:
- Fine edge lines on every building volume, in the viewer and in the Blender renders (as thin geometry: Freestyle draws nothing in the bpy module build).
- 3,076 trees and 830 planted areas from OpenStreetMap (`data/trees.osm`, a new optional download), as abstract canopies.
- A soft environment light in the viewer for gentler shading and reflections on the glass.
- Blender stills place their trains from a mock snapshot at a busy moment (`node mock/scripts/snapshot.ts`), with the same car design as the viewer.
- Mobile controls in two rows.

## Refinement, second round (in progress, not committed)

- Roof shapes from OpenStreetMap (23 buildings: pyramids on the Merchandise Mart and Willis Tower, hips on the Board of Trade, a skillion on the Crain Building and others), with roof heights from the data or estimated from the footprint.
- Curbs: streets sit 15 cm below the blocks, in the renders and the viewer.
- The viewer's sun follows the real sun for the moment on screen, and the light switches to night at dusk on its own. The shadow map follows the camera for crisp shadows up close. Cascaded shadow maps were tried and dropped: they showed no visible gain over one shadow map fitted to the camera, and patch every material.
- Shareable links: view, light, building mode and selected train or station in the address bar.
- The camera cannot end up inside a building.
- Fixed: screen labels and markers for points behind the camera were mirrored onto the screen; a doubled polling timer when the clock speed was set at load; a code block that an earlier edit had duplicated into the speed control.
- Side panel and controls fit short and narrow windows; the plan scales with the window height.
- Markers are out of the tab order; the legend and plan give keyboard access to the same trains.
- New tests: train feed (snapping, unknown routes, trains leaving, single timer), solar position, screen projection.

## Fix: night view flickering (in progress, not committed)

Cause: the lit windows were drawn with hard edges and one sample per pixel. From the overview a window is 2 to 5 pixels wide, so any camera movement changed which pixels landed on a lit window and the city sparkled. Three smaller causes added to it: the post-processing chain rendered without antialiasing, overlays 1 to 2 cm above the ground and the edge lines on the building faces fought in the depth buffer from far away, and the shadow box resized every frame while zooming.

Fix:
- Windows are averaged over each pixel's footprint (3 x 3 samples where windows are small, one softened sample up close) and fade to the wall's average glow only below a pixel.
- MSAA on the post-processing render target; bloom threshold raised.
- Polygon offsets for overlays and building faces; the near plane follows the viewing distance (depth precision); the shadow box changes size in 25 % steps.
- Adaptive quality: if frames run slower than about 50 fps for two seconds, ambient occlusion goes off, then the pixel ratio drops (shown in the status bar tooltip).
- Checked with `scripts/flicker.mjs` (frames under a tiny camera move), `scripts/flicker_score.py` and `scripts/alias.mjs` / `scripts/alias_score.py` (1x against a 2x reference).

## Refinement: light and the Chicago night (in progress, not committed)

Gabi asked for the most beautiful app, and a night that truly reflects Chicago: true lights, true buildings.

- Continuous light: day, golden hour, blue hour and night blend from the real sun (`light.ts`), easing over about a second. Auto, Day and Night in the interface.
- Gradient sky dome and distance haze in the horizon color.
- Windows as office towers really light up: whole floors in bands, stray windows, lobbies, one light color per facade, brighter toward the ceiling, blinds; the share of lit floors follows the hour.
- Floodlit crowns on towers over 120 m, from a per-vertex roof height exported with the model.
- Street light map from the real streets: pools under streetlights every 30 m, the lit corridor under the L, station pools, spill on lower walls.
- Window filtering redone as an exact box filter per sample: night flicker under sub-pixel camera moves down from 1.6 % to 0.5 % of pixels (day is 0.2 %).
- The Blender night shader follows the same rules (floor bands, facade colors, crowns), so the stills match the viewer.
- The river reflects the city in the viewer (planar reflection, ripples, Fresnel, night light streaks), and a new Blender camera looks east down the river from Wolf Point; that night still is now the landing page and README hero, with a Day/Night crossfade on the landing page.
- Windows come on only once the sun is down (from the start of the blue hour), so sunlit walls stay clean at golden hour.
- Idle turntable drift in the viewer after 25 seconds.
- Blender street lamps are kept out of tree canopies (a lamp inside a tree showed as a hot spot).

## Change: no landing page

Gabi asked to remove the landing page and open straight on the map. The viewer is now `web/index.html`; the landing page, its styles and its copies of the renders are gone. The README keeps the renders.

## README demo

The README is rebuilt as a demo of the app: a time-lapse from late afternoon to night as the hero, a tour (trains from any height, faint buildings, stations, Tower 18 live, following a train, the Loop after dark, any hour, phone), the Blender renders, a diagram of how it works, controls, run and rebuild, going live, what is real and what is estimated, credits. GIFs are recorded with `scripts/capture-gif.mjs` (now with orbit, setup scripts and palette options) and compressed with gifsicle; `?ui=off` now also hides labels and markers.
