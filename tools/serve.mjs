/**
 * Serves the built panel (ui/dist, from `npm run ui:build`) with `vite preview`
 * for the Playwright checks, and waits until it answers. Outside Tauri the panel
 * runs on demo data.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const URL = "http://localhost:1421/";

export async function serve() {
  if (!existsSync(join(ROOT, "ui", "dist", "index.html"))) {
    throw new Error("ui/dist is missing: run `npm run ui:build` first");
  }
  const child = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "preview"], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(URL)).ok) return () => child.kill();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("vite preview did not start on " + URL);
}
