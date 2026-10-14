# Viewer

A Vite, TypeScript and three.js viewer for the Loop model with the trains on it.

```sh
npm install
npm run dev          # http://localhost:5173/
npm run build        # static site in web/dist
```

The model is `public/model/loop.glb`, committed so the viewer runs without Blender. After rebuilding the model with `blender/build_loop.py`, copy it in with `npm run sync-model -w web`.

## Train data: mock or live

One setting decides where trains come from, read from `.env` at the repository root (see `.env.example`):

```sh
VITE_TRAIN_SOURCE=mock   # default: simulated trains, computed in the browser
VITE_TRAIN_SOURCE=live   # CTA Train Tracker through the proxy
VITE_TRAIN_PROXY_URL=https://chicago-loop-cta-proxy.<account>.workers.dev/
```

Both sources answer with the exact Train Tracker Locations JSON (`docs/cta-api.md`), so nothing else changes. To go live:

1. Get a free key at transitchicago.com/developers.
2. Deploy the proxy (`proxy/README.md`): it keeps the key in a Worker secret, so the key never reaches the browser.
3. Set `VITE_TRAIN_SOURCE=live` and `VITE_TRAIN_PROXY_URL`, then `npm run build`.

The mock polls every 5 seconds, the live source every 30.

Mock options in the address bar, for demos and screenshots:

| Parameter | Example | Effect |
| --- | --- | --- |
| `t` | `?t=2026-10-13T08:15:00-05:00` | start the simulated clock at this moment |
| `speed` | `?speed=8` | run the simulated clock faster |
| `seed` | `?seed=2` | a different day of delays |
| `view` | `?view=tower18` | `overview`, `tower18` or `wabash` |
| `light` | `?light=night` | `auto` (default), `day` or `night` |
| `quality` | `?quality=low` | force the light renderer (no ambient occlusion, smaller shadows) |
| `buildings` | `?buildings=faint` | start with the buildings faint |

## How it works

- `src/loaders/model.ts` loads the Draco compressed glTF and gives its materials the day or night look from `src/scene/palette.ts`, which mirrors `blender/looks.py`.
- `src/scene/stage.ts`: renderer with AgX tone mapping, sun with shadows over the whole model, sky light, and ambient occlusion (GTAO) on desktops. Phones get a smaller shadow map, a lower pixel ratio and no ambient occlusion.
- `src/data/feed.ts` polls the train source. Each train is converted from lat/lon to local meters and snapped (`src/trains/snapping.ts`) to the nearest point of its line's directed paths, choosing the track that runs the way the train is heading.
- `src/trains/easing.ts` keeps the last few snapped positions per train. The viewer draws trains one update interval in the past and interpolates along the track, so they glide around corners instead of jumping, and never reverse on noisy data.
- `src/trains/layer.ts` draws every car as an instance: one instanced mesh per line in its CTA color plus one for the window bands. Each car sits on the track at its own distance behind the head, so trains bend through the Loop's corners and Tower 18.
- `src/scene/windows.ts` patches the building shaders with the same lit window pattern as the Blender night renders, so at night the Loop is lived in. Windows smaller than a pixel fade to their average glow instead of sparkling. Night also turns on a soft bloom on desktops.
- `src/scene/views.ts`: the camera. Preset views, keyboard pan, turn and zoom, double-click to fly, the street level walk with collisions, follow and ride. Raycasts against the city use bounding volume hierarchies (`three-mesh-bvh`), cheap enough to run every frame.
- `src/scene/routes.ts`, `src/trains/markers.ts`, `src/ui/plan.ts`: route lines, train markers and the plan.
- `src/scene/trees.ts`: the 3,076 trees mapped in OpenStreetMap, as instanced canopies.
- The camera never ends up inside a building: if it would, it rises just over the roof.
- Building volumes carry fine edge lines, as on an architect's model.

## Light

`Auto` (the default) lights the scene for the moment on screen, from the real sun over the Loop (NOAA solar position equations, `src/scene/sun.ts`). The light is two numbers (`src/scene/light.ts`): how much night, and how golden, so it moves smoothly through afternoon, golden hour (a low warm sun, cool blue shadows, long shadows), the blue hour and night, and every change eases in over about a second. `Day` and `Night` hold one look.

- **Sky:** a gradient dome (`src/scene/sky.ts`), pale by day, warm on the horizon at golden hour, deep blue at dusk, near black at night with the city's glow low on the horizon. Distance haze takes the horizon color.
- **Windows** (`src/scene/windows.ts`): office towers light whole floors, so light comes in horizontal bands with stray windows on dark floors; lobbies glow at street level; each facade has one kind of light (warm, neutral or cool white, glass towers mostly cool); windows are brighter toward the ceiling and some have blinds drawn. How many floors are lit follows the hour in Chicago: busiest around 6 pm, sparse at 3 am.
- **Crowns:** towers over 120 m have the top of their walls floodlit, as so many Loop towers do. Each building's roof height travels with its vertices in the glTF (`_ROOFZ`).
- **Streets** (`src/scene/lightmap.ts`): a light map drawn from the real streets puts a warm pool under every streetlight about every 30 m, a lit band under the L, brighter pools at the stations, and spill on the lower walls of the buildings.
- **River:** a planar reflection of the city on the water (`src/scene/water.ts`) with slow, irregular ripples, Fresnel (dark from above, a mirror from the bank) and, at night, lights stretched into vertical streaks as on moving water. Desktop only; skipped when the camera is above 450 m, where it would barely show.
- **No flicker:** every window is box filtered over the pixel's footprint (exact pulse integrals per sample), so the city does not sparkle as the camera moves. `scripts/flicker.mjs` with `scripts/flicker2_score.py` measures it.

## Idle

Left alone for 25 seconds, the overview turns slowly around the Loop, about one turn in six minutes, like a model on a turntable. Any input stops it; it never runs with reduced motion.

## Links

The address bar keeps the view, the light (if chosen), the building mode and the selected train or station, so a link opens the same scene: for example `?view=tower18&buildings=faint&train=org:709`.

## Seeing the trains

- **Markers.** Every train in the model has a square in its line color over it, with a short stroke pointing the way it runs. Markers stay visible when buildings hide the train (drawn lighter then) and step aside up close, where the train itself is plain to see.
- **Route lines.** From higher up, the L is also drawn as a thin line, with a faint trace where buildings hide the structure, so the shape of the Loop reads from any height.
- **Faint buildings.** `Faint` (or `B`) turns the buildings into a pale see-through massing so the whole L and every train show at once.
- **The plan.** The panel at the left has a live plan of the Loop, north up, with every train at its real position and length. The shaded area is what the camera sees. Click a train to select it, click anywhere else to fly there.
- **Trains from far away** are drawn wider and taller (never longer, so they stay on their track) so they read from above.

## Moving around

- Drag to orbit, right-drag or two fingers to pan, scroll or pinch to zoom toward the pointer.
- `W` `A` `S` `D` or the arrow keys pan over the city (faster with Shift), `Q` and `E` turn, `+` and `-` zoom.
- Double-click anything to fly to it.
- `1` `2` `3` jump to Overview, Tower 18 and Wabash. At street level on Wabash the same keys walk, and buildings and the L's columns stop you.
- Select a train, then `Follow` (`F`) keeps it in view from above, rising over buildings that would hide it; `Ride` (`R`) puts you at the front of the train.
- Click a station label for the trains on their way to it, soonest first.
- With mock data, `1x` `10x` `60x` in the status bar speed up the simulated clock.

## Interface

Hover a train (tap on a phone; picking is forgiving at overview scale, where a train is a few pixels wide) for its line, run number, destination, next station and arrival. The legend counts trains inside the model; pressing a line selects its next train, so everything works from the keyboard. Keys: `1` `2` `3` for the views, `N` to switch Day and Night, `B` for faint buildings, `F` and `R` to follow or ride the selected train, `Escape` to step back.

## Tests

`npm test` at the repository root runs Vitest for the mock and the viewer: snapping, easing, car placement on curves (`car.test.ts`), the simulated clock, station arrivals and the interface text.
