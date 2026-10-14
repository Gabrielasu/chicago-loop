# Train Tracker proxy

A Cloudflare Worker that keeps the CTA key out of the browser. The viewer calls the Worker, the Worker adds `CTA_TRAIN_TRACKER_KEY` and calls `ttpositions.aspx`, and returns the JSON with CORS headers for the viewer's origin only.

Not deployed yet, and untested against the live API because there is no key yet.

To go live:

1. Get a free key at transitchicago.com/developers.
2. In `proxy/`, set `ALLOWED_ORIGIN` in `wrangler.toml` to where the viewer is hosted.
3. `npx wrangler secret put CTA_TRAIN_TRACKER_KEY`, then `npx wrangler deploy`.
4. Build the viewer with `VITE_TRAIN_SOURCE=live` and `VITE_TRAIN_PROXY_URL=https://<worker>.workers.dev/`.
