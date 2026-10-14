import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; set VITE_BASE=/chicago-loop/ there.
  base: process.env.VITE_BASE ?? "/",
  envDir: "..",
  build: {
    target: "es2022",
    // three.js and its addons (post-processing, reflections, raycast acceleration) are about
    // 1 MB minified, 270 kB gzipped; the viewer is one page that needs all of it.
    chunkSizeWarningLimit: 1200,
  },
});
