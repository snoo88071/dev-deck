/**
 * The MCP server in one file, dist/server.mjs, with its dependencies and the
 * panel's cleanup rules inside: what the Claude Code plugin runs, so installing
 * the plugin needs no `npm install`. Committed; CI checks it is up to date.
 *
 *   npm run bundle
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  // Some dependencies are CommonJS and call require(): give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
console.log("dist/server.mjs");
