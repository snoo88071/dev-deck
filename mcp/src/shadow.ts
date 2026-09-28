/**
 * The shadow file: `~/.dev-deck/shadow.jsonl`, one JSON line per event.
 *
 *   proposal  a cleanup proposal (from Claude Code or the panel), with its evidence
 *   verdict   your verdict on a proposal: close / keep / wrong
 *   action    a kill or restart actually done, with its reason
 *
 * It measures, per category, how often the proposal was right: the sample on
 * which to decide where Claude could act on its own. The panel writes to the
 * same file.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type Verdict = "close" | "keep" | "wrong";
export const VERDICTS: Verdict[] = ["close", "keep", "wrong"];

export interface ProposalRecord {
  type: "proposal";
  id: string;
  at: string;
  source: "claude" | "panel";
  session: number | null;
  projects: string[];
  category: string;
  pid: number;
  pids: number[];
  cmd: string;
  root: string | null;
  ports: number[];
  evidence: string[];
}
export interface VerdictRecord {
  type: "verdict";
  at: string;
  proposal: string;
  verdict: Verdict;
  note?: string;
}
export interface ActionRecord {
  type: "action";
  at: string;
  source: "claude" | "panel";
  action: "kill" | "restart";
  pids: number[];
  reason: string;
  proposal?: string;
  ok: boolean;
  error?: string;
}
export type ShadowRecord = ProposalRecord | VerdictRecord | ActionRecord;

export function shadowPath(): string {
  if (process.env.DEVDECK_SHADOW) return process.env.DEVDECK_SHADOW;
  const dir = join(homedir(), ".dev-deck");
  try {
    migrateShadow(dir);
  } catch {
    // best effort: the old file stays where it was, the new one starts empty
  }
  return join(dir, "shadow.jsonl");
}

const OLD_VALUES: Record<string, Record<string, string>> = {
  type: { proposta: "proposal", giudizio: "verdict", azione: "action" },
  verdict: { chiudi: "close", "giusta-lascia": "keep", sbagliata: "wrong" },
  source: { pannello: "panel" },
  category: { "mcp-orfano": "orphan-mcp", doppione: "duplicate", sessione: "session", fermo: "idle" },
};

/** One line of the old Italian file in the new names; a line that doesn't parse is kept as it is. */
export function convertLine(line: string): string {
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(line);
  } catch {
    return line;
  }
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return line;
  for (const [field, map] of Object.entries(OLD_VALUES)) {
    const v = rec[field];
    if (typeof v === "string" && v in map) rec[field] = map[v];
  }
  return JSON.stringify(rec);
}

/**
 * The file used to be `ombra.jsonl`, with Italian values. If it's there and
 * `shadow.jsonl` isn't, write the converted copy and keep the old one as
 * `ombra.jsonl.bak`. Never overwrites an existing shadow.jsonl.
 */
export function migrateShadow(dir: string): boolean {
  const old = join(dir, "ombra.jsonl");
  const now = join(dir, "shadow.jsonl");
  if (!existsSync(old) || existsSync(now)) return false;
  const lines = readFileSync(old, "utf8").split("\n").map((l) => (l.trim() ? convertLine(l.replace(/\r$/, "")) : l));
  writeFileSync(now, lines.join("\n"), { encoding: "utf8", flag: "wx" });
  renameSync(old, `${old}.bak`);
  return true;
}

export function readShadow(path = shadowPath()): ShadowRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as ShadowRecord];
      } catch {
        return []; // one broken line doesn't stop the others
      }
    });
}

export function append(record: ShadowRecord, path = shadowPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
}

/** Proposals still without a verdict. */
export function pending(records: ShadowRecord[]): ProposalRecord[] {
  const judged = new Set(records.filter((r): r is VerdictRecord => r.type === "verdict").map((r) => r.proposal));
  return records.filter((r): r is ProposalRecord => r.type === "proposal" && !judged.has(r.id));
}

/**
 * Proposals you already dismissed for that process: «keep» or «wrong». As long
 * as the process is the same (pid and command), it isn't proposed again.
 */
export function dismissed(records: ShadowRecord[]): ProposalRecord[] {
  const verdicts = new Map<string, Verdict>();
  for (const r of records) if (r.type === "verdict") verdicts.set(r.proposal, r.verdict);
  return records.filter(
    (r): r is ProposalRecord => r.type === "proposal" && (verdicts.get(r.id) === "keep" || verdicts.get(r.id) === "wrong"),
  );
}

/**
 * Records the new proposals. An identical proposal (same category, same pid,
 * same command) still without a verdict isn't duplicated: the earlier one is returned.
 * Those you already dismissed for the same process don't come back at all.
 */
export function recordProposals(
  proposals: Omit<ProposalRecord, "type" | "id" | "at">[],
  path = shadowPath(),
): ProposalRecord[] {
  const records = readShadow(path);
  const open = pending(records);
  const gone = dismissed(records);
  const same = (a: { category: string; pid: number; cmd: string }, b: { category: string; pid: number; cmd: string }) =>
    a.category === b.category && a.pid === b.pid && a.cmd === b.cmd;
  return proposals.filter((p) => !gone.some((d) => same(d, p))).map((p) => {
    const prev = open.find((o) => same(o, p));
    if (prev) return prev;
    const rec: ProposalRecord = { type: "proposal", id: randomUUID().slice(0, 8), at: new Date().toISOString(), ...p };
    append(rec, path);
    return rec;
  });
}

export function recordVerdict(proposal: string, verdict: Verdict, note?: string, path = shadowPath()): void {
  if (!VERDICTS.includes(verdict)) throw new Error(`unknown verdict: ${verdict}`);
  append({ type: "verdict", at: new Date().toISOString(), proposal, verdict, ...(note ? { note } : {}) }, path);
}

export interface CategoryStats {
  category: string;
  proposals: number;
  judged: number;
  /** Right diagnosis: «close» or «keep». */
  right: number;
  wrong: number;
  /** How many you would really have closed: this is what counts for autonomy. */
  closed: number;
  /** Right diagnoses over judged ones; null without verdicts. */
  precision: number | null;
  /** «Close» over judged ones: had Claude closed on its own, how often it would have been fine. */
  closeRate: number | null;
  /** The last 10 judged ones, with no wrong one. */
  cleanLast10: boolean;
  promotable: boolean;
}

/**
 * The rule for giving a category autonomy, written but switched off: at least
 * MIN_JUDGED verdicts, at least MIN_PRECISION of «close» (a right proposal you
 * keep, closed on its own, would have been a mistake), and no wrong one among
 * the last 10. Nothing uses it to act yet: only the report reads it.
 */
export const MIN_JUDGED = 20;
export const MIN_PRECISION = 0.95;

export function stats(records: ShadowRecord[]): CategoryStats[] {
  const verdicts = new Map<string, VerdictRecord>();
  for (const r of records) if (r.type === "verdict") verdicts.set(r.proposal, r); // the last one wins
  const byCat = new Map<string, ProposalRecord[]>();
  for (const r of records) if (r.type === "proposal") byCat.set(r.category, [...(byCat.get(r.category) ?? []), r]);
  return [...byCat.entries()].map(([category, props]) => {
    const judged = props.filter((p) => verdicts.has(p.id));
    const wrongs = judged.filter((p) => verdicts.get(p.id)!.verdict === "wrong");
    const last10 = judged
      .sort((a, b) => verdicts.get(a.id)!.at.localeCompare(verdicts.get(b.id)!.at))
      .slice(-10);
    const closed = judged.filter((p) => verdicts.get(p.id)!.verdict === "close").length;
    const precision = judged.length ? (judged.length - wrongs.length) / judged.length : null;
    const closeRate = judged.length ? closed / judged.length : null;
    const cleanLast10 = last10.every((p) => verdicts.get(p.id)!.verdict !== "wrong");
    return {
      category,
      proposals: props.length,
      judged: judged.length,
      right: judged.length - wrongs.length,
      wrong: wrongs.length,
      closed,
      precision,
      closeRate,
      cleanLast10,
      promotable: judged.length >= MIN_JUDGED && (closeRate ?? 0) >= MIN_PRECISION && cleanLast10,
    };
  });
}
