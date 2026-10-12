# Data

Put raw downloads here. Large files are git-ignored.

1. `loop.osm`: on openstreetmap.org, zoom to the Loop (roughly Lake St to Congress Pkwy, Wells St to Michigan Ave, plus a block of margin), click Export, then "Manually select a different area" if needed. Alternatively query Overpass for the same bounding box.
2. `building-footprints.geojson`: City of Chicago Data Portal, "Building Footprints", filtered to the same area, exported as GeoJSON.
3. Live trains: a free CTA Train Tracker API key from transitchicago.com/developers, stored as `CTA_TRAIN_TRACKER_KEY` in `.env` and in the Worker's secrets. Never commit it.
