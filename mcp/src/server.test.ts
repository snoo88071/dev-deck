/**
 * The server started the way Claude Code starts it (stdio), on the machine's
 * real processes, with a temporary shadow file. Checks that dev_cleanup closes
 * nothing and records the proposals.
 *
 * DEVDECK_TEST_CWD: the folder to start from (a project with processes to clean up).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readShadow } from "./shadow.ts";
import * as devdeck from "./devdeck.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

// The source, and the bundle the Claude Code plugin runs (npm run bundle).
for (const entry of ["src/server.ts", "dist/server.mjs"]) test(`${entry}: dev_processes and dev_cleanup, shadow mode, nothing closed, proposals in the file`, async () => {
  const shadow = join(mkdtempSync(join(tmpdir(), "shadow-")), "shadow.jsonl");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(HERE, "..", entry)],
    cwd: process.env.DEVDECK_TEST_CWD ?? process.cwd(),
    env: { ...process.env, DEVDECK_SHADOW: shadow } as Record<string, string>,
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ["dev_cleanup", "dev_kill", "dev_processes", "dev_restart", "dev_sessions", "dev_verdict"]);

    const before = (await devdeck.list()).flatMap((g) => g.procs).map((p) => p.pid);
    const listed = await client.callTool({ name: "dev_processes", arguments: {} });
    const listedText = (listed.content as any)[0].text as string;
    assert.match(listedText, /Claude Code session: pid/);

    const sess = ((await client.callTool({ name: "dev_sessions", arguments: {} })).content as any)[0].text as string;
    assert.match(sess, /Claude Code sessions open|No Claude Code sessions/);
    console.log(sess.split("\n").slice(0, 8).join("\n"));

    const res = await client.callTool({ name: "dev_cleanup", arguments: {} });
    const out = (res.content as any)[0].text as string;
    console.log(out);
    const after = (await devdeck.list()).flatMap((g) => g.procs).map((p) => p.pid);
    const proposals = readShadow(shadow).filter((r) => r.type === "proposal");
    if (proposals.length) {
      assert.match(out, /SHADOW MODE: nothing was closed/);
      // Nothing closed: the proposed pids are still there.
      for (const p of proposals) if (p.type === "proposal") assert.ok(after.includes(p.pid), `pid ${p.pid} is gone`);
    } else {
      assert.match(out, /Nothing to clean up/);
    }
    assert.ok(before.length > 0);
  } finally {
    await client.close();
  }
});
