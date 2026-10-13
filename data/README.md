# Data

Raw downloads go here and are git-ignored. `python -m pipeline.fetch` (or `./scripts/build-data.sh`) downloads anything missing; the manual steps below are the fallback.

1. `loop.osm`: on openstreetmap.org, zoom to the Loop (roughly Lake St to Congress Pkwy, Wells St to Michigan Ave, plus a block of margin), click Export, then "Manually select a different area" if needed. Alternatively query Overpass for the same bounding box.
2. `building-footprints.geojson`: City of Chicago Data Portal, "Building Footprints", filtered to the same area, exported as GeoJSON.
3. `cta-l-stops.json`: City of Chicago Data Portal, "CTA - System Information - List of 'L' Stops" (8pix-ypme), as JSON.
4. Live trains: a free CTA Train Tracker API key from transitchicago.com/developers, stored as `CTA_TRAIN_TRACKER_KEY` in `.env` and in the Worker's secrets. Never commit it.
