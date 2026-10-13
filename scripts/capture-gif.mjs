// Records the viewer into a GIF for the README.
// Usage: node scripts/capture-gif.mjs <url> <out.gif> [frames] [width] [height]
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import puppeteer from "puppeteer-core";

const [url, out, frames = "60", w = "960", h = "540"] = process.argv.slice(2);
const dir = ".context/gif-frames";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: Number(w), height: Number(h) });
await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
await page.waitForSelector(".loading.done", { timeout: 120000 });
await new Promise((r) => setTimeout(r, 8000));
const t0 = Date.now();
for (let i = 0; i < Number(frames); i++) {
  await page.screenshot({ path: `${dir}/f${String(i).padStart(3, "0")}.png` });
  const next = t0 + (i + 1) * 100;
  await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
}
const fps = Math.round((Number(frames) * 1000) / (Date.now() - t0));
await browser.close();
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-framerate", String(fps), "-i", `${dir}/f%03d.png`,
  "-vf", `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
  out,
]);
console.log(`wrote ${out} at ${fps} fps`);
