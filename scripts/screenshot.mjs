// Screenshots of the viewer with the local Chrome.
// Usage: node scripts/screenshot.mjs <url> <out.png> [width] [height] [waitMs] [mobile]
import puppeteer from "puppeteer-core";

const [url, out, w = "1600", h = "900", wait = "9000", mobile] = process.argv.slice(2);
const chrome =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"],
});
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.setViewport({
  width: Number(w),
  height: Number(h),
  deviceScaleFactor: mobile ? 3 : 1,
  isMobile: Boolean(mobile),
  hasTouch: Boolean(mobile),
});
await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
await page.waitForSelector(".loading.done, body:not(:has(.loading))", { timeout: 120000 }).catch(() => {});
await new Promise((r) => setTimeout(r, Number(wait)));
if (process.env.EVAL) {
  await page.evaluate(process.env.EVAL);
  await new Promise((r) => setTimeout(r, 1500));
}
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => {
        n++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else resolve(Math.round((n * 1000) / (performance.now() - t0)));
      };
      requestAnimationFrame(tick);
    }),
);
await page.screenshot({ path: out });
console.log(`saved ${out}, ${fps} fps`);
for (const l of logs.filter((l) => !l.includes("[vite]"))) console.log(l);
await browser.close();
