/**
 * The real app, not the demo: launches the built dev-deck.exe with WebView2's
 * remote debugging on, drives it with Playwright, and checks what only Rust can
 * do: restart and stop real processes, and write verdicts to the shadow file.
 *
 * It only touches what it starts itself: two tiny node servers in a temp folder,
 * and a temp shadow file (DEVDECK_SHADOW). The app window shows for a few seconds,
 * and so does the `cmd` window a restart opens. Windows only, needs a desktop:
 * not part of CI.
 *
 *   npm run tauri build -- --no-bundle && npm run app-check
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "src-tauri", "target", "release", "dev-deck.exe");
const CLI = join(ROOT, "src-tauri", "target", "release", "devdeck.exe");
const CDP_PORT = 9333;
const ok = (what) => console.log("ok  " + what);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(250);
  }
}
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const listening = (port) => new Promise((r) => { const c = net.connect(port, "127.0.0.1", () => { c.destroy(); r(true); }).on("error", () => r(false)); });
const procs = () => JSON.parse(execFileSync(CLI, ["list"], { encoding: "utf8" })).groups.flatMap((g) => g.procs);

for (const f of [APP, CLI]) if (!existsSync(f)) throw new Error(`${f} is missing: run \`npm run tauri build -- --no-bundle\` first`);

const tmp = mkdtempSync(join(tmpdir(), "devdeck-check-"));
const project = join(tmp, "devdeck-check-app");
const shadowFile = join(tmp, "shadow.jsonl");
const children = [];
let app;
let browser;

try {
  // A project with two servers: A gets restarted then stopped, B gets closed from Cleanup.
  execFileSync("cmd", ["/c", "mkdir", project]);
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "devdeck-check-app", private: true }));
  writeFileSync(join(project, "server.js"), 'require("http").createServer((q, s) => s.end("ok")).listen(+process.argv[2]);\n');
  const portA = await freePort();
  const portB = await freePort();
  for (const port of [portA, portB]) children.push(spawn(process.execPath, ["server.js", String(port)], { cwd: project, stdio: "ignore" }));
  await until("the two servers listen", async () => (await listening(portA)) && (await listening(portB)));
  const [a, b] = children;
  const bProc = await until("devdeck sees server B", () => procs().find((p) => p.pid === b.pid));

  // A proposal for B, as if a scan had made it: Cleanup must show it and "Close" must act on it.
  writeFileSync(shadowFile, JSON.stringify({
    type: "proposal", id: "appcheck", at: new Date().toISOString(), source: "panel", session: null, projects: [],
    category: "idle", pid: b.pid, pids: [b.pid], cmd: bProc.cmd, root: project, ports: [portB], evidence: ["app-check"],
  }) + "\n");

  app = spawn(APP, [], {
    stdio: "ignore",
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
      // Its own WebView2 data: no clash with a Dev Deck already open, and your stored settings stay untouched.
      WEBVIEW2_USER_DATA_FOLDER: join(tmp, "webview"),
      DEVDECK_SHADOW: shadowFile,
      DEVDECK_LANG: "en",
      DEVDECK_DESCRIBE: "0",
    },
  });
  browser = await until("WebView2 answers on the debugging port", () => chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`).catch(() => null));
  const page = await until("the panel page", () => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("tauri.localhost")));
  await page.waitForSelector(".ant-menu");

  // Rust decides the language and the description setting.
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
  await page.getByRole("menuitem", { name: /^Sessions/ }).click();
  assert.equal(await page.locator("#describe-switch").isDisabled(), true);
  ok("language and the forced description setting come from Rust");

  // The project shows up, with its ports.
  await page.getByRole("menuitem", { name: /^Processes/ }).click();
  const group = page.locator("tr.ant-table-row-level-0", { hasText: "devdeck-check-app" });
  await group.waitFor({ timeout: 15_000 });
  await group.locator(".ant-table-row-expand-icon").click();
  const rowOf = (port) => page.locator("tr", { hasText: `server.js ${port}` });
  await rowOf(portA).waitFor();
  ok(`a real project appears, its servers listed (:${portA}, :${portB})`);

  // Restart A: a new process, same command and folder, listening on the same port.
  await rowOf(portA).getByRole("button", { name: /^Restart/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Restart" }).click();
  const a2 = await until("A is back with a new pid", () => procs().find((p) => p.cmd.includes(`server.js ${portA}`) && p.pid !== a.pid));
  await until("A listens again", () => listening(portA));
  assert.equal(a2.cwd?.toLowerCase().replace(/\\$/, ""), project.toLowerCase());
  ok(`restart relaunches it (pid ${a.pid} → ${a2.pid}) in the same folder, on the same port`);

  // Stop the restarted A from its row.
  await until("the new pid shows in the panel", async () => (await page.getByRole("button", { name: `Stop process ${a2.pid} and its children` }).count()) > 0);
  await page.getByRole("button", { name: `Stop process ${a2.pid} and its children` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Stop" }).click();
  await until("A is gone", async () => !procs().some((p) => p.pid === a2.pid) && !(await listening(portA)));
  ok("stop kills it and frees the port");

  // Cleanup: "Close" on the proposal kills B and writes the action and the verdict.
  await page.getByRole("menuitem", { name: /^Cleanup/ }).click();
  const proposal = page.locator("tr", { hasText: `pid ${b.pid}` });
  await proposal.waitFor();
  await proposal.getByRole("button", { name: "Close" }).click();
  await until("B is gone", async () => !procs().some((p) => p.pid === b.pid));
  const records = await until("the verdict is in the shadow file", () => {
    const r = readFileSync(shadowFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    return r.some((x) => x.type === "verdict") ? r : null;
  });
  assert.ok(records.some((r) => r.type === "action" && r.action === "kill" && r.ok && r.pids[0] === b.pid && r.proposal === "appcheck"));
  assert.ok(records.some((r) => r.type === "verdict" && r.proposal === "appcheck" && r.verdict === "close"));
  ok("\"Close\" in Cleanup kills the process and records the action and the verdict");
} finally {
  await browser?.close().catch(() => {});
  if (app?.pid) try { execFileSync("taskkill", ["/T", "/F", "/PID", String(app.pid)], { stdio: "ignore" }); } catch { /* already gone */ }
  for (const c of children) try { c.kill(); } catch { /* already gone */ }
  // Anything still running from the temp project (the restarted server, if a step failed), and
  // the cmd window the restart opened (it stays at the prompt once its server is stopped).
  try { for (const p of procs()) if (p.cwd?.toLowerCase().startsWith(tmp.toLowerCase())) execFileSync("taskkill", ["/T", "/F", "/PID", String(p.pid)], { stdio: "ignore" }); } catch { /* none */ }
  try { execFileSync("taskkill", ["/F", "/FI", `WINDOWTITLE eq ${basename(project)} (Dev Deck)*`], { stdio: "ignore" }); } catch { /* no window */ }
  await sleep(500);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* a handle still open: the OS temp cleanup takes it */ }
}
