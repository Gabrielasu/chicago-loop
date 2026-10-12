# Chicago Loop: project brief for agents

## What we are building

A 1:1 model of the Chicago Loop as it stands today, built in Blender from real data, with the elevated L integrated: the Loop tracks, all eight Loop stations and the lines that run on them. A web viewer loads the model and moves the trains to where CTA says they are, in real time.

Scope of the live trains: CTA L trains inside the Loop only (Brown, Green, Orange, Pink, Purple on the elevated Loop). Red and Blue run in subways under the Loop; whether to show them is an open question for Gabi (see docs/PLAN.md).

## Architecture

1. `data/` raw inputs (not committed when large): OpenStreetMap export of the Loop and the City of Chicago Building Footprints GeoJSON. See `data/README.md`.
2. `pipeline/` (to build) Python that turns raw data into clean, projected geometry: building footprints with heights, track centerlines, station platforms, river, streets. Output: `build/loop.json` in a local metric coordinate system (meters, origin at State & Madison, x east, y north).
3. `blender/` bpy scripts that read `build/loop.json` and build the scene: buildings, the L structure, stations, river, bridges, streets. Exports `build/loop.glb` for the web and renders stills.
4. `web/` (to build) Vite + TypeScript + three.js viewer. Loads `loop.glb`, polls train positions, places trains on the nearest point of the right line's track, eases between updates.
5. `mock/` (to build) a mock Train Tracker: until Gabi has a CTA key, the viewer runs on simulated trains. A small module produces responses in the exact shape of the real Locations API (same field names and types), moving trains along the real Loop track geometry at believable speeds and dwell times, stopping at the eight stations, with realistic run numbers and destinations per line. The viewer reads one setting, `VITE_TRAIN_SOURCE=mock|live`, and works the same either way. Mock is the default.
6. `proxy/` (to build, later) a tiny serverless function (Cloudflare Worker) that calls CTA Train Tracker with the API key from an environment secret and returns JSON with CORS headers. The key never ships to the browser.

## Running Blender

Blender runs as a Python module, no app needed:

```sh
./scripts/setup.sh                      # creates .venv with Python 3.11 and bpy
.venv/bin/python blender/prototype_city.py 24 build/preview.png
```

`blender/prototype_city.py` is a procedural stand-in (made-up buildings) from the first test. Replace it with the real data build; keep it only as a reference for materials, lighting and the camera.

Rendering is CPU Cycles in CI and sandboxes. Keep preview renders small (1600x900, 16 to 32 samples, denoise on). Look at every render you make and fix what is wrong before moving on.

## Data facts to respect

- Loop elevated stations (current): Clark/Lake, State/Lake, Washington/Wabash, Adams/Wabash, Harold Washington Library-State/Van Buren, LaSalle/Van Buren, Quincy, Washington/Wells. Randolph/Wabash and Madison/Wabash closed when Washington/Wabash opened; do not model them. State/Lake closed on 5 January 2026 for a rebuild expected to last until 2029: model the station, but trains pass through without stopping.
- Line colors (CTA): Red #C60C30, Blue #00A1DE, Brown #62361B, Green #009B3A, Orange #F9461C, Purple #522398, Pink #E27EA6, Yellow #F9E300.
- Train Tracker Locations API: `ttpositions.aspx?key=KEY&rt=brn,g,org,p,pink&outputType=JSON`. Needs a free key from transitchicago.com/developers. Gabi does not have a key yet, so build against mock data that follows CTA's published Train Tracker documentation for the response format. Do not call the live API.
- Use real data for every building. Where height is missing, estimate from floor count (about 3.9 m per floor for Loop office buildings) and record that it was estimated.

## Design direction

A modern architect's massing model, presented like the work of a top architecture or design studio.

- Model: buildings in warm white and pale grey; real glass only where the data says the facade is glass. Soft daylight with crisp shadows, light ambient occlusion, a clean neutral ground, AgX color.
- The L is the hero element: black steel structure. Color comes only from trains and line markers in exact CTA colors. Nothing else is saturated.
- Night preset: dark model, lit platforms, glowing trains.
- Interface: strict grid, generous space, thin rules, real hierarchy, light and dark themes that follow the day and night model. Minimal chrome over the 3D view; panels only where they earn their space. No gradients, glows, glassmorphism, rounded pills or decorative icons.
- Type: Big Shoulders Display (made for the City of Chicago's signage) only for the few big headings, Schibsted Grotesk for UI and body, Chivo Mono for data.

The earlier direction (Jules Guerin's Plan of Chicago palette) is retired; the prototype render in `docs/design/` is from that first test.

## Gabi's standing preferences

- No em dashes anywhere, in UI, docs or commit messages.
- Plain, production-ready copy. No slogans, no hype, no "AI-generated" sounding lines.
- Design should look like the work of a real artist or studio, never like AI graphic-design tropes (gradient washes, glassy cards, rounded pills on dark with gold).
- Avoid fonts that show up in every AI-made design (Inter, Geist, Instrument Serif, Space Grotesk, Jost, Syne, DM Sans, Fraunces and similar).
- Do not describe Gabi as a founder.
- Commit as: Gabi <gabriela.sulek@gmail.com>.

## Engineering standards

TypeScript strict, small pure modules, tests for the data pipeline and the train-placement math (Vitest / pytest), lint clean, no secrets in the repo (`.env` is git-ignored; document variables in `.env.example`).
