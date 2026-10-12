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
