/**
 * Before `tauri build`: compiles `devdeck` (the CLI the MCP server uses) and puts
 * it where Tauri takes sidecars from, src-tauri/binaries/devdeck-cli-<target>.exe.
 * The installer then ships it next to the panel as devdeck-cli.exe.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TAURI = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");
const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1];
// Tauri tells before-build commands the target it builds for; outside it, this machine's.
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const ext = target.includes("windows") ? ".exe" : "";
// Building for this machine: the usual target/release, shared with the app build (no second compile).
const cross = target !== host;

execFileSync("cargo", ["build", "--release", "--bin", "devdeck", ...(cross ? ["--target", target] : [])], { cwd: TAURI, stdio: "inherit" });
mkdirSync(join(TAURI, "binaries"), { recursive: true });
const built = join(TAURI, "target", ...(cross ? [target] : []), "release", `devdeck${ext}`);
copyFileSync(built, join(TAURI, "binaries", `devdeck-cli-${target}${ext}`));
console.log(`sidecar: binaries/devdeck-cli-${target}${ext}`);
