/** Demo data for a plain browser: the same shapes Rust sends, and actions that change them. */
import type { Group, Job, JobGroup, SessionRow, ShadowRecord } from "./types";

const now = () => Date.now() / 1000;
const B = "C:\\Users\\dev\\code\\";

let describe = false;

let groups: Group[] = [
  { root: B + "acme-shop\\backend", name: "backend", ports: [8792], memory: 210e6, cpu: 1.2, run_time: 5400, by_claude: false, procs: [
    { pid: 8364, parent: 1, runtime: "node", tool: "npm", cmd: "\"C:\\Program Files\\nodejs\\node.exe\" npm-cli.js start", cwd: B + "acme-shop\\backend", memory: 50e6, cpu: 0, run_time: 5400, ports: [], depth: 0, claude: false, launcher: null },
    { pid: 2164, parent: 8364, runtime: "node", tool: "tsx", cmd: "node node_modules\\tsx\\dist\\cli.mjs src/index.ts", cwd: null, memory: 40e6, cpu: 0.2, run_time: 5399, ports: [], depth: 1, claude: false, launcher: null },
    { pid: 33004, parent: 2164, runtime: "node", tool: "tsx", cmd: "node --import tsx/loader.mjs src/index.ts", cwd: B + "acme-shop\\backend", memory: 90e6, cpu: 1, run_time: 5398, ports: [8792], depth: 2, claude: false, launcher: null },
    { pid: 7001, parent: 3, runtime: "node", tool: "@playwright/mcp", cmd: "node @playwright/mcp", cwd: B + "acme-shop\\backend", memory: 30e6, cpu: 0, run_time: 3000, ports: [], depth: 0, claude: false, launcher: "claude" },
  ] },
  { root: B + "acme-shop\\web", name: "web", ports: [5173], memory: 140e6, cpu: 3.4, run_time: 5300, by_claude: false, procs: [
    { pid: 9120, parent: 1, runtime: "node", tool: "npm", cmd: "node npm-cli.js run dev", cwd: B + "acme-shop\\web", memory: 48e6, cpu: 0, run_time: 5300, ports: [], depth: 0, claude: false, launcher: null },
    { pid: 9188, parent: 9120, runtime: "node", tool: "vite", cmd: "node node_modules\\vite\\bin\\vite.js", cwd: B + "acme-shop\\web", memory: 92e6, cpu: 3.4, run_time: 5299, ports: [5173], depth: 1, claude: false, launcher: null },
  ] },
  { root: B + "blog", name: "blog", ports: [8765], memory: 52e6, cpu: 2.1, run_time: 86000, by_claude: false, procs: [
    { pid: 22008, parent: 1, runtime: "python", tool: null, cmd: "C:\\Python312\\python.exe tracker/serve.py 8765", cwd: B + "blog", memory: 12e6, cpu: 0, run_time: 86000, ports: [8765], depth: 0, claude: false, launcher: null },
    { pid: 22110, parent: 4, runtime: "node", tool: null, cmd: "node scripts/publish.mjs", cwd: B + "blog", memory: 40e6, cpu: 2.1, run_time: 40, ports: [], depth: 0, claude: false, launcher: "svchost", task: "blog publish" },
  ] },
  { root: B + "scraper", name: "scraper", ports: [], memory: 90e6, cpu: 0.4, run_time: 7200, by_claude: true, procs: [
    { pid: 19600, parent: 5, runtime: "node", tool: "npx", cmd: "node npx-cli.js chrome-devtools-mcp@latest", cwd: B + "scraper", memory: 45e6, cpu: 0.2, run_time: 7200, ports: [], depth: 0, claude: false, launcher: "claude" },
    { pid: 16836, parent: 19600, runtime: "node", tool: "chrome-devtools-mcp", cmd: "node chrome-devtools-mcp", cwd: B + "scraper", memory: 45e6, cpu: 0.2, run_time: 7199, ports: [], depth: 1, claude: false, launcher: "claude" },
  ] },
];

/** A local time as Rust sends it (`YYYY-MM-DDTHH:MM:SS`, no offset). */
function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}
const at = (hours: number) => iso(new Date(Date.now() + hours * 3600000));
/** The last or next `hour` o'clock on one of `days` (0 = Sunday; all days if empty), from now. */
function slot(hour: number, dir: 1 | -1, days: number[] = []): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  while ((dir > 0 ? d.getTime() <= Date.now() : d.getTime() > Date.now()) || (days.length && !days.includes(d.getDay()))) {
    d.setDate(d.getDate() + dir);
  }
  return iso(d);
}
const job = (j: Partial<Job> & Pick<Job, "path" | "cmd" | "runtime">): Job => ({
  name: j.path.split("\\").pop()!, folder: "\\", enabled: true, running: false, script: null, workdir: null, missing: null,
  triggers: [], last_run: null, next_run: null, last_result: 0, result: "ok", pids: [], author: null, description: null, ...j,
});

let jobs: JobGroup[] = [
  { root: B + "acme-shop\\backend", name: "backend", jobs: [
    job({ path: "\\Dev Deck\\acme-shop db backup", folder: "\\Dev Deck\\", runtime: "powershell",
      cmd: "powershell.exe -NoProfile -File " + B + "acme-shop\\backend\\scripts\\backup.ps1", script: B + "acme-shop\\backend\\scripts\\backup.ps1",
      workdir: B + "acme-shop\\backend", description: "Nightly dump of the dev database, keeps the last 14.",
      triggers: [{ kind: "daily", start: "2026-09-01T03:00:00", every: 1, days: [], repeat_minutes: null, enabled: true }],
      last_run: slot(3, -1), next_run: slot(3, 1) }),
  ] },
  { root: B + "blog", name: "blog", jobs: [
    job({ path: "\\blog publish", runtime: "node", cmd: "node scripts/publish.mjs", script: B + "blog\\scripts\\publish.mjs", workdir: B + "blog",
      triggers: [{ kind: "weekly", start: "2026-09-01T09:00:00", every: 1, days: [2, 5], repeat_minutes: null, enabled: true }],
      running: true, result: "running", last_result: 267009, last_run: at(0), next_run: slot(9, 1, [2, 5]), pids: [22110] }),
    job({ path: "\\blog links check", runtime: "python", cmd: "C:\\Python312\\python.exe tools\\links.py", script: B + "blog\\tools\\links.py", workdir: B + "blog",
      triggers: [{ kind: "daily", start: "2026-09-01T12:00:00", every: 2, days: [], repeat_minutes: null, enabled: true }],
      enabled: false, last_result: 1, result: "exit", last_run: slot(12, -1, [new Date(Date.now() - 3 * 86400000).getDay()]), next_run: null }),
  ] },
  { root: B + "money", name: "money", jobs: [
    job({ path: "\\Bank sync", runtime: "python", cmd: "C:\\Python312\\pythonw.exe " + B + "money\\sync.py", script: B + "money\\sync.py",
      workdir: B + "money", missing: B + "money",
      triggers: [{ kind: "daily", start: "2026-09-01T07:00:00", every: 1, days: [], repeat_minutes: 2880, enabled: true }],
      last_result: 2147942667, result: "folder-missing", last_run: slot(7, -1), next_run: slot(7, 1) }),
  ] },
];

const sessions: SessionRow[] = [
  { session: { pid: 2372, kind: "terminal", cwd: B + "dev-deck", project: "dev-deck", run_time: 27000, session_id: "401e68e7-18bf-46a4-a2a7-9ed7a48f31b2", transcript: "C:\\Users\\dev\\.claude\\projects\\x\\401e68e7.jsonl", match: "time", title: "MCP in the repo", last_prompt: "ok, I was thinking of also adding the open Claude Code processes", last_activity: now() - 30, transcript_size: 1, memory: 250e6, children: 8, children_memory: 69e6 }, description: null, description_fresh: false },
  { session: { pid: 16264, kind: "vscode", cwd: B + "acme-shop", project: "acme-shop", run_time: 170000, session_id: "7b621175-b63f-4ae5-9ffe-63482dd0bb92", transcript: "y.jsonl", match: "id", title: "Card-based onboarding", last_prompt: "yes, go ahead", last_activity: now() - 700, transcript_size: 1, memory: 200e6, children: 7, children_memory: 11e6 }, description: { text: "Testing the acme-shop onboarding cards against the real backend.", at: now() - 4000, fingerprint: "a" }, description_fresh: false },
  { session: { pid: 3856, kind: "vscode", cwd: B + "scraper", project: "scraper", run_time: 175000, session_id: "0da7952e", transcript: "z.jsonl", match: "uncertain", title: "Scraper with Playwright", last_prompt: "hi! in this repo we use Playwright", last_activity: now() - 127000, transcript_size: 1, memory: 180e6, children: 7, children_memory: 11e6 }, description: { text: "The scraper runs headless against the staging site; retries are next.", at: now() - 90000, fingerprint: "b" }, description_fresh: true },
];

const shadow: ShadowRecord[] = [
  { type: "proposal", id: "demo0001", at: new Date(Date.now() - 600000).toISOString(), source: "claude", session: 3844, projects: [],
    category: "duplicate", pid: 16836, pids: [16836], cmd: "node chrome-devtools-mcp", root: B + "scraper", ports: [],
    evidence: ["same command and same folder as pid 19600", "this one has been running for 2 h, the other for 2 h", "this one has no open ports"] },
];

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const later = <T>(x: T, ms = 60) => new Promise<T>((r) => setTimeout(() => r(x), ms));

export function demoCall(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "list":
      return later(copy(groups));
    case "kill": {
      const pids = args.pids as number[];
      groups = groups
        .map((g) => ({ ...g, procs: g.procs.filter((p) => !pids.includes(p.pid)) }))
        .filter((g) => g.procs.length);
      return later(pids.length);
    }
    case "sessions":
      return later(copy(sessions));
    case "describe_settings":
      return later({ enabled: describe, forced: false });
    case "set_describe":
      describe = args.on as boolean;
      return later(null);
    case "describe_session": {
      const row = sessions.find((s) => s.session.pid === args.pid);
      const d = { text: "Redesigning the Dev Deck panel on Ant Design: sidebar, tree tables, light and dark themes.", at: now(), fingerprint: "x" };
      if (row) { row.description = d; row.description_fresh = true; }
      return later(d, 800);
    }
    case "jobs":
      return later(copy(jobs));
    case "job_act": {
      const target = jobs.flatMap((g) => g.jobs).find((j) => j.path === args.path);
      if (target && args.act === "run") Object.assign(target, { running: true, result: "running", last_result: 267009, last_run: at(0) });
      if (target && args.act !== "run") Object.assign(target, { enabled: args.act === "enable" });
      return later(null);
    }
    case "job_delete":
      jobs = jobs.map((g) => ({ ...g, jobs: g.jobs.filter((j) => j.path !== args.path) })).filter((g) => g.jobs.length);
      return later("C:\\Users\\dev\\.dev-deck\\deleted-tasks\\" +String(args.path).split("\\").pop() + ".xml");
    case "shadow_read":
      return later(copy(shadow));
    case "shadow_append":
      shadow.push(args.record as ShadowRecord);
      return later(null);
    default:
      console.log("[demo]", cmd, args);
      return later(null);
  }
}
