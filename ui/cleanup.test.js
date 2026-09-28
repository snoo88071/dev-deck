// node --test ui/cleanup.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { propose, isMcp, inProjects } = require("./cleanup.js");

function p(pid, o = {}) {
  return Object.assign({
    pid, parent: 1, runtime: "node", tool: null, cmd: "node x.js", cwd: "C:\\d\\app", memory: 1, cpu: 0,
    run_time: 600, ports: [], depth: 0, claude: false, launcher: null, parent_alive: true, claude_pid: null
  }, o);
}
function g(root, procs) { return { root, name: root.split("\\").pop(), procs, ports: [], memory: 0, cpu: 0, run_time: 0, by_claude: false }; }

const SESSION = 500;

test("recognizes MCP servers", () => {
  assert.ok(isMcp(p(1, { tool: "@playwright/mcp" })));
  assert.ok(isMcp(p(1, { cmd: "node npx-cli.js chrome-devtools-mcp@latest" })));
  assert.ok(!isMcp(p(1, { cmd: "node src/index.ts", tool: "tsx" })));
});

test("projects: folder inside, equal or containing, case-insensitive", () => {
  assert.ok(inProjects("C:\\d\\acme-shop\\backend", ["c:/d/acme-shop"]));
  assert.ok(inProjects("C:\\d\\acme-shop", ["C:\\d\\acme-shop\\backend\\"]));
  assert.ok(!inProjects("C:\\d\\acme-shop-2", ["C:\\d\\acme-shop"]));
});

test("never the MCP servers of a live session, never Claude Code", () => {
  const groups = [g("C:\\d\\app", [
    p(10, { tool: "@playwright/mcp", launcher: "claude", claude_pid: SESSION, run_time: 99999 }),
    p(11, { tool: "@playwright/mcp", launcher: "claude", claude_pid: SESSION, run_time: 99999 }),
    p(12, { claude: true, run_time: 99999 }),
  ])];
  assert.deepEqual(propose(groups, { session: SESSION }), []);
});

test("orphan MCP: dead parent and no live session above; children go with it", () => {
  const groups = [g("C:\\d\\app", [
    p(20, { tool: "npx", cmd: "node npx-cli.js chrome-devtools-mcp", parent: 999, parent_alive: false }),
    p(21, { tool: "chrome-devtools-mcp", cmd: "node chrome-devtools-mcp", parent: 20, depth: 1 }),
  ])];
  const [x, ...rest] = propose(groups, {});
  assert.equal(rest.length, 0);
  assert.equal(x.category, "orphan-mcp");
  assert.deepEqual(x.pids, [20, 21]);
});

test("duplicate: the one with the port stays, the other is proposed", () => {
  const groups = [g("C:\\d\\acme-shop\\backend", [
    p(30, { cmd: "node npm-cli.js start", cwd: "C:\\d\\acme-shop\\backend", run_time: 100 }),
    p(31, { cmd: "node src/index.ts", parent: 30, depth: 1, ports: [8792] }),
    p(40, { cmd: "node  npm-cli.js start", cwd: "c:\\d\\acme-shop\\backend\\", run_time: 5000 }),
  ])];
  const props = propose(groups, {});
  assert.equal(props.length, 1);
  assert.equal(props[0].category, "duplicate");
  assert.equal(props[0].pid, 40);
  assert.match(props[0].evidence[0], /pid 30 \(which has port :8792\)/);
});

test("the tree skips the cmd.exe between npm and tsx: the grandchild's port counts", () => {
  const old = 20 * 3600;
  const groups = [g("C:\\d\\acme-shop\\backend", [
    p(15584, { tool: "npm", run_time: old }),
    p(11428, { tool: "tsx", parent: 9999, depth: 1, run_time: old }),   // the parent is a cmd.exe not in the list
    p(32812, { tool: "tsx", parent: 11428, depth: 2, ports: [8792], run_time: old }),
  ])];
  assert.deepEqual(propose(groups, {}), []);
});

test("session: servers started by this session; not those of another one", () => {
  const groups = [g("C:\\d\\app", [
    p(50, { cmd: "node vite", launcher: "claude", claude_pid: SESSION, ports: [5173] }),
    p(51, { cmd: "node other.js", launcher: "claude", claude_pid: 777 }),
  ])];
  const props = propose(groups, { session: SESSION, projects: ["C:\\d\\app"] });
  assert.deepEqual(props.map((x) => [x.category, x.pid]), [["session", 50]]);
  assert.match(props[0].evidence[1], /:5173/);
});

test("idle: old, zero CPU, no ports; within the project scope", () => {
  const old = 20 * 3600;
  const groups = [
    g("C:\\d\\app", [p(60, { run_time: old }), p(61, { run_time: old, ports: [3000], cmd: "node server.js" })]),
    g("C:\\d\\other", [p(70, { run_time: old, cwd: "C:\\d\\other" })]),
  ];
  const props = propose(groups, { projects: ["C:\\d\\app"] });
  assert.deepEqual(props.map((x) => [x.category, x.pid]), [["idle", 60]]);
  // Without a scope (from the panel): all of them.
  assert.deepEqual(propose(groups, {}).map((x) => x.pid).sort(), [60, 70]);
});
