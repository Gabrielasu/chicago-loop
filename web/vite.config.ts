import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; set VITE_BASE=/chicago-loop/ there.
  base: process.env.VITE_BASE ?? "/",
  envDir: "..",
  build: {
    target: "es2022",
    // three.js alone is about 700 kB minified; the viewer is one page that needs all of it.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        viewer: resolve(import.meta.dirname, "viewer.html"),
      },
    },
  },
});
