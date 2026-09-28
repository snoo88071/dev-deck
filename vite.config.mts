import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The panel lives in ui/. Tauri loads the dev server in `npm run dev` and ui/dist in builds.
export default defineConfig({
  root: "ui",
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  preview: { port: 1421, strictPort: true },
  // A desktop app loads its bundle from disk: one big chunk is fine.
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 4000 },
});
