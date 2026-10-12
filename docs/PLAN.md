# Plan

Each phase is sized so it can run as its own Conductor workspace. Phases 2, 4 and 5 can start in parallel once phase 1 has produced `build/loop.json`.

## Phase 1: Data pipeline
- Read the OSM export: buildings (`building=*`, `height`, `building:levels`), L track ways (`railway=subway` / `railway=light_rail` / elevated `railway=rail` with `layer`/`bridge`), stations (`railway=station`, `public_transport=station`), platforms, the river, bridges, streets.
- Join City of Chicago footprints for floor counts where OSM lacks height.
- Project lat/lon to local meters (origin State & Madison). Output `build/loop.json` plus a short report: building count, how many heights were estimated.
- Tests: projection round-trip, height fallback rules.

## Phase 2: Blender model
- Buildings extruded from footprints at real height, roofs, simple facade materials by type.
- The L: steel structure along the real track centerlines (both tracks), columns at regular spacing, the Tower 18 junction at Lake and Wells, all eight stations with platforms and canopies.
- River, bridges, streets.
- Render stills in the Plan of Chicago palette. Export `build/loop.glb` (draco-compressed, under ~30 MB).

## Phase 3: Live trains backend
- Cloudflare Worker proxy for Train Tracker, key in a secret, short cache (a few seconds), CORS for the viewer's origin only.

## Phase 4: Web viewer
- three.js scene from `loop.glb`, orbit and street-level views.
- Poll the proxy, snap each train to its line's track polyline, ease between positions, show run number, destination and next station on hover.
- Station labels, line legend, "last updated" time.

## Phase 5: Design
- Viewer UI and landing page in the Chicago-history direction (see CLAUDE.md).
- README with renders and a GIF of trains moving.

## Open questions for Gabi
- Show Red and Blue subway trains under the Loop as see-through tunnels, or elevated lines only?
- Where should the viewer be hosted (GitHub Pages + Worker, or Vercel)?
