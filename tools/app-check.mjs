/**
 * The real app, not the demo: launches the built dev-deck.exe with WebView2's
 * remote debugging on, drives it with Playwright, and checks what only Rust can
 * do: restart and stop real processes, write verdicts to the shadow file, and run,
 * disable, enable and delete a real scheduled task.
 *
 * It only touches what it starts itself: two tiny node servers in a temp folder,
 * a temp shadow file (DEVDECK_SHADOW), a temp CPU history (DEVDECK_CPU), a transcript of its own in
 * a temp Claude Code folder (DEVDECK_CLAUDE_PROJECTS, DEVDECK_HISTORY) reopened with a fake `claude`
 * (DEVDECK_CLAUDE) that only notes how it was called, and two scheduled tasks under \Dev Deck\
 * (the deleted one leaves its copy in a temp folder, DEVDECK_DELETED_TASKS). The app window
 * shows for a few seconds, and so does the `cmd` window a restart opens. Windows only, needs a desktop:
 * not part of CI.
 *
 *   npm run tauri build -- --no-bundle && npm run app-check
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const jobs = () => JSON.parse(execFileSync(CLI, ["jobs"], { encoding: "utf8" })).groups.flatMap((g) => g.jobs);
const ps = (script) => execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

for (const f of [APP, CLI]) if (!existsSync(f)) throw new Error(`${f} is missing: run \`npm run tauri build -- --no-bundle\` first`);

const tmp = mkdtempSync(join(tmpdir(), "devdeck-check-"));
const project = join(tmp, "devdeck-check-app");
const shadowFile = join(tmp, "shadow.jsonl");
const deletedDir = join(tmp, "deleted-tasks");
const TASK = `devdeck-check-${process.pid}`;
const GONE = `devdeck-check-gone-${process.pid}`;
let taskCreated = false;
let goneCreated = false;
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

  // A session's transcript, as Claude Code writes one from a terminal; and a `claude` that notes its call and leaves.
  const SESSION = "d0d0d0d0-1234-4abc-8def-0123456789ab";
  const projectsDir = join(tmp, "projects", "devdeck-check-app");
  execFileSync("cmd", ["/c", "mkdir", projectsDir]);
  writeFileSync(join(projectsDir, `${SESSION}.jsonl`), [
    { type: "user", entrypoint: "cli", sessionId: SESSION, cwd: project, gitBranch: "main", timestamp: new Date(Date.now() - 3600_000).toISOString(), message: { role: "user", content: "app-check: a session to reopen" } },
    { type: "ai-title", aiTitle: "devdeck app-check session", sessionId: SESSION },
  ].map((x) => JSON.stringify(x)).join("\n") + "\n");
  const resumedFile = join(tmp, "resumed.txt");
  writeFileSync(join(tmp, "fake-claude.cmd"), `@echo %CD% %*> "${resumedFile}"\r\n@exit\r\n`);

  app = spawn(APP, [], {
    stdio: "ignore",
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
      // Its own WebView2 data: no clash with a Dev Deck already open, and your stored settings stay untouched.
      WEBVIEW2_USER_DATA_FOLDER: join(tmp, "webview"),
      DEVDECK_SHADOW: shadowFile,
      DEVDECK_CPU: join(tmp, "cpu.jsonl"),
      DEVDECK_CLAUDE_PROJECTS: join(tmp, "projects"),
      DEVDECK_HISTORY: join(tmp, "history.json"),
      DEVDECK_CLAUDE: join(tmp, "fake-claude.cmd"),
      DEVDECK_DELETED_TASKS: deletedDir,
      DEVDECK_LANG: "en",
      DEVDECK_DESCRIBE: "0",
    },
  });
  browser = await until("WebView2 answers on the debugging port", () => chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`).catch(() => null));
  const page = await until("the panel page", () => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("tauri.localhost")));
  await page.waitForSelector(".ant-menu");

  // The bundled app must look like the dev one: the production CSP once blocked
  // antd's runtime styles (a nonce disables 'unsafe-inline'). Reload to see every message.
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.reload();
  await page.waitForSelector(".ant-menu");
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".ant-menu")).listStyleType), "none", "antd styles are not applied");
  assert.deepEqual(errors, [], "console errors in the real app");
  ok("antd styles apply, no console errors (CSP)");

  // Rust decides the language and the description setting.
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
  await page.getByRole("menuitem", { name: /^Sessions/ }).click();
  assert.equal(await page.locator("#describe-switch").isDisabled(), true);
  ok("language and the forced description setting come from Rust");

  // History: the transcript shows up; Reopen opens a terminal in its folder with `claude --resume <id>`.
  await page.getByRole("menuitem", { name: /^History/ }).click();
  const past = page.locator(".dd-past", { hasText: "devdeck app-check session" });
  await past.waitFor({ timeout: 15_000 });
  await past.getByRole("button", { name: /^Reopen/ }).click();
  const resumed = await until("the terminal ran claude --resume", () => existsSync(resumedFile) && readFileSync(resumedFile, "utf8").trim());
  assert.ok(resumed.toLowerCase().startsWith(project.toLowerCase()), `ran in ${resumed}`);
  assert.ok(resumed.endsWith(`--resume ${SESSION}`), resumed);
  ok("history lists a real transcript; Reopen runs claude --resume <id> in its folder");

  // The project shows up, with its ports.
  await page.getByRole("menuitem", { name: /^Processes/ }).click();
  const group = page.locator("tr.ant-table-row-level-0", { hasText: "devdeck-check-app" });
  await group.waitFor({ timeout: 15_000 });
  await group.locator(".ant-table-row-expand-icon").click();
  const rowOf = (port) => page.locator("tr", { hasText: `server.js ${port}` });
  await rowOf(portA).waitFor();
  ok(`a real project appears, its servers listed (:${portA}, :${portB})`);
  await page.getByRole("img", { name: /^The computer's memory: .*Available \d/ }).waitFor();
  ok("the memory strip reads the computer's RAM");


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

  // Scheduled: a task of its own, in the project, under \Dev Deck\ (the folder the skill asks Claude to use).
  // Run now, disable, enable and delete act on the real Task Scheduler.
  // It stays up for a minute, long enough for Processes to show whose it is.
  writeFileSync(join(project, "job.js"), 'require("fs").writeFileSync(require("path").join(__dirname, "ran.txt"), new Date().toISOString()); setTimeout(() => {}, 60000);\n');
  ps(`Register-ScheduledTask -TaskPath '\\Dev Deck\\' -TaskName '${TASK}' -Force `
    + `-Action (New-ScheduledTaskAction -Execute '${process.execPath}' -Argument 'job.js' -WorkingDirectory '${project}') `
    + `-Trigger (New-ScheduledTaskTrigger -Daily -At 3am) | Out-Null`);
  taskCreated = true;
  await page.getByRole("menuitem", { name: /^Scheduled/ }).click();
  const task = page.locator("tr.ant-table-row-level-1", { hasText: TASK });
  await task.waitFor({ timeout: 15_000 });
  await task.getByText(/^every day at 03:00/).waitFor();
  ok("a real scheduled task shows up under its project, with its schedule");

  await task.getByRole("button", { name: "Run now" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Run now" }).click();
  await until("the task ran (job.js wrote ran.txt)", () => existsSync(join(project, "ran.txt")));
  ok("\"Run now\" starts it");

  // Its process, in Processes, says which task started it; the project links to its tasks.
  const jobProc = await until("devdeck ties job.js to the task", () => procs().find((p) => p.cmd.includes("job.js") && p.task === TASK));
  await page.getByRole("menuitem", { name: /^Processes/ }).click();
  await group.waitFor();
  await until("the panel tags the process with the task", async () => {
    if (!(await page.locator("tr", { hasText: "job.js" }).count())) await group.locator(".ant-table-row-expand-icon").click().catch(() => {});
    return (await page.locator("tr", { hasText: "job.js" }).getByText(TASK).count()) > 0;
  });
  await group.getByRole("button", { name: "1 scheduled" }).click();
  await task.waitFor();
  ok(`the task's process (pid ${jobProc.pid}) is tagged in Processes; "1 scheduled" leads back`);

  const enabled = () => jobs().find((j) => j.name === TASK)?.enabled;
  await task.getByRole("button", { name: "Disable" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disable" }).click();
  await until("the task is disabled", () => enabled() === false);
  await task.getByRole("button", { name: "Enable" }).click();
  await until("the task is enabled again", () => enabled() === true);
  ok("disable and enable change it in the Task Scheduler");

  await task.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await until("the task is gone", () => !jobs().some((j) => j.name === TASK));
  const copies = await until("a copy of its definition was kept", () => {
    try { return readdirSync(deletedDir).filter((f) => f.endsWith(".xml")); } catch { return null; }
  });
  const xml = readFileSync(join(deletedDir, copies[0]), "utf16le");
  assert.ok(xml.includes("job.js"), "the copy holds the task's definition");
  taskCreated = false;
  ok("delete removes it and keeps its definition (UTF-16 XML, as schtasks wants it)");

  // Cleanup: a task whose folder doesn't exist is proposed by "Scan now"; "Disable" disables it.
  ps(`Register-ScheduledTask -TaskPath '\\Dev Deck\\' -TaskName '${GONE}' -Force `
    + `-Action (New-ScheduledTaskAction -Execute '${process.execPath}' -Argument 'job.js' -WorkingDirectory '${join(tmp, "gone")}') `
    + `-Trigger (New-ScheduledTaskTrigger -Daily -At 4am) | Out-Null`);
  goneCreated = true;
  await until("devdeck sees the task with its missing folder", () => jobs().find((j) => j.name === GONE && j.missing));
  // "1 scheduled" left the filter on the test project: the proposal is elsewhere.
  await page.locator("#filter").fill("");
  await page.getByRole("menuitem", { name: /^Cleanup/ }).click();
  await page.getByRole("button", { name: "Scan now" }).click();
  const goneRow = page.locator("tr", { hasText: GONE });
  await goneRow.getByText("Task pointing to a missing path").waitFor({ timeout: 15_000 });
  await goneRow.getByRole("button", { name: "Disable" }).click();
  await until("the task is disabled", () => jobs().find((j) => j.name === GONE)?.enabled === false);
  const rec = await until("the disable and the verdict are in the shadow file", () => {
    // The panel may be halfway through a line: skip what doesn't parse yet.
    const r = readFileSync(shadowFile, "utf8").trim().split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    const p = r.find((x) => x.type === "proposal" && x.task?.endsWith(GONE));
    return p && r.some((x) => x.type === "verdict" && x.proposal === p.id) ? { p, r } : null;
  });
  assert.ok(rec.r.some((x) => x.type === "action" && x.action === "disable" && x.ok && x.proposal === rec.p.id));
  assert.equal(rec.p.category, "task-gone");
  ok("a task pointing to a missing folder is proposed; \"Disable\" disables it and records the verdict");
} finally {
  if (taskCreated) try { ps(`Unregister-ScheduledTask -TaskPath '\\Dev Deck\\' -TaskName '${TASK}' -Confirm:$false`); } catch { /* already gone */ }
  if (goneCreated) try { ps(`Unregister-ScheduledTask -TaskPath '\\Dev Deck\\' -TaskName '${GONE}' -Confirm:$false`); } catch { /* already gone */ }
  // The \Dev Deck\ folder goes too if the check left it empty (DeleteFolder refuses a folder with tasks).
  try { ps("$s = New-Object -ComObject Schedule.Service; $s.Connect(); $s.GetFolder('\\').DeleteFolder('Dev Deck', 0)"); } catch { /* not empty, or not there */ }
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
