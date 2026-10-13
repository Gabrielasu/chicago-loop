# Viewer

A Vite, TypeScript and three.js viewer for the Loop model with the trains on it.

```sh
npm install
npm run dev          # http://localhost:5173/ (landing) and /viewer.html
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
| `theme` | `?theme=night` | `day` or `night` |
| `quality` | `?quality=low` | force the light renderer (no ambient occlusion, smaller shadows) |

## How it works

- `src/loaders/model.ts` loads the Draco compressed glTF and gives its materials the day or night look from `src/scene/palette.ts`, which mirrors `blender/looks.py`.
- `src/scene/stage.ts`: renderer with AgX tone mapping, sun with shadows over the whole model, sky light, and ambient occlusion (GTAO) on desktops. Phones get a smaller shadow map, a lower pixel ratio and no ambient occlusion.
- `src/data/feed.ts` polls the train source. Each train is converted from lat/lon to local meters and snapped (`src/trains/snapping.ts`) to the nearest point of its line's directed paths, choosing the track that runs the way the train is heading.
- `src/trains/easing.ts` keeps the last few snapped positions per train. The viewer draws trains one update interval in the past and interpolates along the track, so they glide around corners instead of jumping, and never reverse on noisy data.
- `src/trains/layer.ts` draws every car as an instance: one instanced mesh per line in its CTA color plus one for the window bands. Each car sits on the track at its own distance behind the head, so trains bend through the Loop's corners and Tower 18.
- `src/scene/views.ts`: Overview, Tower 18 and Wabash. Wabash is street level under the L: drag to look around, arrow keys or W A S D to walk.

## Interface

Hover a train (tap on a phone) for its line, run number, destination, next station and arrival. The legend counts trains inside the model; pressing a line selects its next train, so everything works from the keyboard. Keys: `1` `2` `3` for the views, `N` for night, `Escape` to clear a selection.

## Tests

`npm test` at the repository root runs Vitest for the mock and the viewer: snapping (`snapping.test.ts`), easing (`easing.test.ts`) and the interface text (`format.test.ts`).
