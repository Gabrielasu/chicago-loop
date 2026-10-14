// Copies the Draco decoder into public/ (always) and, with --model, the Blender
// export build/loop.glb into public/model/ (committed, so the viewer runs
// without Blender).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(web, "..");

const dracoSrc = join(root, "node_modules/three/examples/jsm/libs/draco/gltf");
const dracoDst = join(web, "public/draco");
mkdirSync(dracoDst, { recursive: true });
for (const f of readdirSync(dracoSrc)) copyFileSync(join(dracoSrc, f), join(dracoDst, f));

if (process.argv.includes("--model")) {
  const glb = join(root, "build/loop.glb");
  if (!existsSync(glb)) {
    console.error("build/loop.glb is missing. Run: .venv/bin/python blender/build_loop.py --render none");
    process.exit(1);
  }
  mkdirSync(join(web, "public/model"), { recursive: true });
  copyFileSync(glb, join(web, "public/model/loop.glb"));
  console.log("copied build/loop.glb to web/public/model/loop.glb");
}
