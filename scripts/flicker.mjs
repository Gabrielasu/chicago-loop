// Captures consecutive frames while the camera moves a tiny amount, for flicker hunting.
// Usage: node scripts/flicker.mjs <url> <outdir> [frames] [step]
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const [url, out, frames = "6", step = "0.002"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(url, { waitUntil: "networkidle0" });
await page.waitForSelector(".loading.done");
await new Promise((r) => setTimeout(r, 6000));
for (let i = 0; i < Number(frames); i++) {
  await page.evaluate((a) => {
    const s = window.__loop.stage;
    const c = s.controls;
    const off = s.camera.position.clone().sub(c.target);
    off.applyAxisAngle({ x: 0, y: 1, z: 0, isVector3: true }, a);
    s.camera.position.copy(c.target).add(off);
  }, Number(step));
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${out}/f${i}.png` });
}
await browser.close();
