# Blender model

`build_loop.py` builds the Loop from `build/loop.json`, renders the stills and exports `build/loop.glb` for the viewer. Blender runs as a Python module (bpy 5.0.1), so no Blender app is needed.

```sh
./scripts/setup.sh                    # once
./scripts/build-data.sh               # build/loop.json (phase 1)
.venv/bin/python blender/build_loop.py
```

That writes:

| Output | What |
| --- | --- |
| `build/renders/{aerial,junction,street,station}-{day,night}.png` | 1600x900 stills |
| `build/loop.glb` | Draco compressed glTF for the web viewer, about 2 MB |
| `build/loop.blend` | the scene, to open in Blender |

Useful options:

```sh
# Model and glb only, no renders
.venv/bin/python blender/build_loop.py --render none
# One quick preview
.venv/bin/python blender/build_loop.py --render aerial --modes day --samples 16 --size 800x450 --no-glb
# Force CPU (CI and sandboxes); otherwise Metal, OptiX, CUDA, HIP or oneAPI is used when found
.venv/bin/python blender/build_loop.py --cpu
```

A full run with 64 samples takes about five minutes on an M3 with Metal.

## Scene

Collections:

- `buildings`: every building volume at its height, split by tone (`buildings_white`, `buildings_grey`, `buildings_glass`) plus thin canopies (`buildings_roof`). Glass is used only where OpenStreetMap records a glass facade. Masonry reads warm white, metal and concrete pale grey, unknown facades are split between the two by a stable hash of the OSM id.
- `l_structure`: one object per OpenStreetMap track way, named `track_<kind>_<osm id>` (`inner_loop`, `outer_loop`, `main`, `crossover`, `siding`), each with rails, ties, two plate girders and Warren bracing under the deck. `l_columns` holds the column bents every 14 m with cross girders and knee braces. `junction_tower_18` is the signal box at Lake and Wells.
- `stations`: one empty per station named `station_<CTA id>_<name>`, with platforms, edge strips, railings, canopies, canopy lights, stairs from each mapped street entrance and signs with a square per line in CTA colors. State/Lake is closed for its rebuild, so it has platforms only.
- `river`: the Chicago River at 2.6 m below the street and the road bridges over it.
- `streets`: the ground plinth, street surfaces, parks and center lines.
- `preview_trains` (stills only, not exported): a few trains on their real paths.
- `night_lamps` (night stills only, not exported): about 1,800 point lights along the streets.

## Look

`looks.py` holds the materials and light. Day is a massing model: warm white and pale grey volumes, black steel L, neutral ground, a sun from the west-south-west with crisp shadows, a soft sky fill and AgX (High Contrast look). The camera sees a plain neutral backdrop while the model is lit by the sky. Night is the same model in near black, platforms lit from the canopies, trains glowing in their line colors and warm street lamps.

Color appears only on trains and line signs, in exact CTA colors: Brown `#62361B`, Green `#009B3A`, Orange `#F9461C`, Pink `#E27EA6`, Purple `#522398`.

## Dimensions

Measured or standard: track geometry and junctions, platform and canopy outlines, entrance locations, building footprints and many heights (see `docs/data-report.md`), track gauge (1435 mm).

Estimated and marked as such: top of rail at 6.4 m, girder depth 1.15 m, column bents every 14 m with columns 1.7 m outside the outer track, platform 1.0 m above the rail, canopy 3.1 m above the platform, stair pitch, CTA car size 14.63 x 2.84 m (48 ft cars).

## Cameras

- `cam_aerial`: the whole model from the south, looking up the street grid so the Wells, Van Buren and Wabash structures read.
- `cam_junction`: nearly straight down onto Tower 18 at Lake and Wells.
- `cam_street_wabash`: eye level on Wabash between Adams and Washington, looking north under the L.
- `cam_station_quincy`: along the Quincy platforms from above Wells St.

`prototype_city.py` is the first procedural test (made-up buildings) and is kept only for reference.
