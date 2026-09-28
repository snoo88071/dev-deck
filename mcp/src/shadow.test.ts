import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { append, migrateShadow, pending, readShadow, recordProposals, recordVerdict, stats } from "./shadow.ts";

const tmp = () => join(mkdtempSync(join(tmpdir(), "shadow-")), "shadow.jsonl");
const prop = (category: string, pid: number) => ({
  source: "claude" as const, session: 1, projects: [], category, pid, pids: [pid], cmd: `node ${pid}.js`, root: null, ports: [], evidence: ["evidence"],
});

test("an identical proposal still pending is not duplicated", () => {
  const f = tmp();
  const [a] = recordProposals([prop("duplicate", 10)], f);
  const [b] = recordProposals([prop("duplicate", 10)], f);
  assert.equal(a.id, b.id);
  assert.equal(readShadow(f).length, 1);
  recordVerdict(a.id, "close", undefined, f);
  assert.equal(pending(readShadow(f)).length, 0);
  // Judged: if it comes back, it's a new proposal.
  const [c] = recordProposals([prop("duplicate", 10)], f);
  assert.notEqual(c.id, a.id);
});

test("a kept or wrong proposal doesn't come back for the same process", () => {
  const f = tmp();
  const [a] = recordProposals([prop("duplicate", 10)], f);
  recordVerdict(a.id, "keep", undefined, f);
  assert.deepEqual(recordProposals([prop("duplicate", 10)], f), []);
  // Another process (different pid) is proposed.
  assert.equal(recordProposals([prop("duplicate", 11)], f).length, 1);
});

test("per category: right diagnoses, how many you'd have closed, and the autonomy rule", () => {
  const f = tmp();
  const ids = recordProposals(Array.from({ length: 22 }, (_, i) => prop("orphan-mcp", 100 + i)), f).map((r) => r.id);
  ids.forEach((id, i) => recordVerdict(id, i === 0 ? "keep" : "close", undefined, f));
  const [d] = recordProposals([prop("duplicate", 1), prop("duplicate", 2)], f);
  recordVerdict(d.id, "wrong", "it was the good server", f);
  append({ type: "action", at: new Date().toISOString(), source: "claude", action: "kill", pids: [5], reason: "test", ok: true }, f);
  const s = Object.fromEntries(stats(readShadow(f)).map((x) => [x.category, x]));
  assert.equal(s["orphan-mcp"].judged, 22);
  assert.equal(s["orphan-mcp"].precision, 1);
  assert.equal(s["orphan-mcp"].closeRate, 21 / 22);
  assert.equal(s["orphan-mcp"].promotable, true);
  assert.equal(s["duplicate"].proposals, 2);
  assert.equal(s["duplicate"].judged, 1);
  assert.equal(s["duplicate"].wrong, 1);
  assert.equal(s["duplicate"].promotable, false);
});

test("the old Italian file is converted once, and an existing shadow file is never overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "shadow-migrate-"));
  // Records as the Italian version wrote them.
  const proposal = (id: string, category: string, source = "claude") =>
    ({ type: "proposta", id, at: "2026-01-01T00:00:00Z", source, session: 1, projects: [], category, pid: 1, pids: [1], cmd: id, root: null, ports: [], evidence: [] });
  const verdict = (proposal: string, verdict: string, note?: string) =>
    ({ type: "giudizio", at: "2026-01-01T00:00:01Z", proposal, verdict, ...(note ? { note } : {}) });
  const old = [
    proposal("a1", "mcp-orfano", "pannello"),
    proposal("a2", "doppione"),
    verdict("a1", "chiudi"),
    verdict("a2", "giusta-lascia", "keep it"),
    proposal("a3", "sessione"),
    verdict("a3", "sbagliata"),
    proposal("a4", "fermo"),
    { type: "azione", at: "2026-01-01T00:00:03Z", source: "pannello", action: "kill", pids: [1], reason: "r", ok: true },
  ];
  const lines = [...old.map((r) => JSON.stringify(r)), "{broken", ""];
  writeFileSync(join(dir, "ombra.jsonl"), lines.join("\n"));

  assert.equal(migrateShadow(dir), true);
  assert.ok(!existsSync(join(dir, "ombra.jsonl")));
  assert.ok(existsSync(join(dir, "ombra.jsonl.bak")));
  const text = readFileSync(join(dir, "shadow.jsonl"), "utf8");
  assert.ok(text.includes("{broken"), "an unparseable line is copied as it is");
  const recs = readShadow(join(dir, "shadow.jsonl"));
  assert.deepEqual(recs.map((r) => r.type), ["proposal", "proposal", "verdict", "verdict", "proposal", "verdict", "proposal", "action"]);
  const props = recs.filter((r) => r.type === "proposal");
  assert.deepEqual(props.map((r) => r.category), ["orphan-mcp", "duplicate", "session", "idle"]);
  assert.equal(props[0].source, "panel");
  assert.deepEqual(recs.filter((r) => r.type === "verdict").map((r) => r.verdict), ["close", "keep", "wrong"]);
  const action = recs.find((r) => r.type === "action")!;
  assert.equal(action.source, "panel");
  assert.equal(recs.filter((r) => r.type === "verdict")[1].note, "keep it");

  // Idempotent: nothing more to do.
  assert.equal(migrateShadow(dir), false);

  // An old file next to an existing shadow.jsonl is left alone.
  writeFileSync(join(dir, "ombra.jsonl"), JSON.stringify(old[0]));
  assert.equal(migrateShadow(dir), false);
  assert.equal(readFileSync(join(dir, "shadow.jsonl"), "utf8"), text);
  assert.ok(existsSync(join(dir, "ombra.jsonl")));
});
