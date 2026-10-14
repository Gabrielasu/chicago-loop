// Records the viewer into a GIF for the README.
//
// Usage: node scripts/capture-gif.mjs <url> <out.gif> [options]
//   --frames 80        frames to capture
//   --fps 12           frames per second in the GIF
//   --size 1200x675    viewport
//   --width 960        GIF width (height follows)
//   --orbit 0.25       degrees to turn the camera around its target per frame
//   --wait 9000        ms to wait after load before capturing
//   --eval "js"        run in the page before capturing (window.__loop is the viewer)
//   --colors 256       palette size
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import puppeteer from "puppeteer-core";

const [url, out, ...rest] = process.argv.slice(2);
const opt = { frames: 80, fps: 12, size: "1200x675", width: 960, orbit: 0, wait: 9000, eval: "", colors: 256 };
for (let i = 0; i < rest.length; i += 2) {
  const key = rest[i].replace(/^--/, "");
  opt[key] = typeof opt[key] === "number" ? Number(rest[i + 1]) : rest[i + 1];
}
const [w, h] = opt.size.split("x").map(Number);
const dir = ".context/gif-frames";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: w, height: h });
await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
await page.waitForSelector(".loading.done", { timeout: 120000 });
if (opt.eval) await page.evaluate(opt.eval);
await new Promise((r) => setTimeout(r, opt.wait));

const step = 1000 / opt.fps;
const t0 = Date.now();
for (let i = 0; i < opt.frames; i++) {
  if (opt.orbit) {
    await page.evaluate((deg) => {
      const s = window.__loop.stage;
      const c = s.controls.target;
      const o = s.camera.position.clone().sub(c);
      const a = (deg * Math.PI) / 180;
      const x = o.x * Math.cos(a) + o.z * Math.sin(a);
      const z = -o.x * Math.sin(a) + o.z * Math.cos(a);
      s.camera.position.set(c.x + x, c.y + o.y, c.z + z);
    }, opt.orbit);
  }
  await page.screenshot({ path: `${dir}/f${String(i).padStart(3, "0")}.png` });
  const next = t0 + (i + 1) * step;
  await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
}
await browser.close();

execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-framerate", String(opt.fps), "-i", `${dir}/f%03d.png`,
  "-vf",
  `scale=${opt.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${opt.colors}:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
  out,
]);
console.log(`wrote ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB, ${opt.frames} frames)`);
