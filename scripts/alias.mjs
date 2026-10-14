// Renders one view at device pixel ratio 1 and 2 for an aliasing measurement.
// Usage: node scripts/alias.mjs <url> <outdir>
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const [url, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"],
});
for (const dpr of [1, 2]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: dpr });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForSelector(".loading.done");
  await new Promise((r) => setTimeout(r, 5000));
  await page.screenshot({ path: `${out}/dpr${dpr}.png` });
  await page.close();
}
await browser.close();
