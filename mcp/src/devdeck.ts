/**
 * The bridge to `devdeck`, the Rust command that reads processes and kills them:
 * the same data and the same actions as the panel.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface Proc {
  pid: number;
  parent: number | null;
  runtime: string;
  tool: string | null;
  cmd: string;
  cwd: string | null;
  memory: number;
  cpu: number;
  run_time: number;
  ports: number[];
  depth: number;
  claude: boolean;
  launcher: string | null;
  parent_alive: boolean;
  claude_pid: number | null;
}

export interface Group {
  root: string | null;
  name: string;
  procs: Proc[];
  ports: number[];
  memory: number;
  cpu: number;
  run_time: number;
  by_claude: boolean;
}

/** Where `devdeck` is: DEVDECK_BIN, else the release build next door, else the debug one. */
export function devdeckBin(): string {
  if (process.env.DEVDECK_BIN) return process.env.DEVDECK_BIN;
  const exe = process.platform === "win32" ? "devdeck.exe" : "devdeck";
  for (const profile of ["release", "debug"]) {
    const p = resolve(HERE, "..", "..", "src-tauri", "target", profile, exe);
    if (existsSync(p)) return p;
  }
  throw new Error("devdeck not found: build it with `cargo build --release --bin devdeck` in src-tauri, or set DEVDECK_BIN");
}

function run(args: string[]): Promise<any> {
  return new Promise((ok, fail) => {
    execFile(devdeckBin(), args, { windowsHide: true, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      let body: any;
      try {
        body = JSON.parse(stdout);
      } catch {
        return fail(error ?? new Error(`devdeck: non-JSON response: ${stdout.slice(0, 200)}`));
      }
      if (!body.ok) return fail(new Error(body.error ?? "devdeck: error"));
      ok(body);
    });
  });
}

export async function list(): Promise<Group[]> {
  return (await run(["list"])).groups as Group[];
}

export async function kill(pids: number[]): Promise<number> {
  return (await run(["kill", ...pids.map(String)])).killed as number;
}

export async function restart(pid: number, title: string): Promise<void> {
  await run(["restart", String(pid), "--title", title]);
}

export interface Session {
  pid: number;
  kind: "terminal" | "vscode" | "background";
  cwd: string | null;
  project: string | null;
  run_time: number;
  session_id: string | null;
  transcript: string | null;
  match: "id" | "time" | "uncertain" | "none";
  title: string | null;
  last_prompt: string | null;
  last_activity: number | null;
  transcript_size: number | null;
  memory: number;
  children: number;
  children_memory: number;
}
export interface Description {
  text: string;
  at: number;
  fingerprint: string;
}
export interface SessionRow {
  session: Session;
  description: Description | null;
  description_fresh: boolean;
}

/** The open sessions, and whether descriptions are on (they are opt-in: claude -p costs tokens). */
export async function sessions(): Promise<{ rows: SessionRow[]; describeOn: boolean }> {
  const body = await run(["sessions"]);
  return { rows: body.sessions as SessionRow[], describeOn: body.describe_sessions === true };
}

/** Redoes the description with claude -p (a few seconds). Without force, from the cache if the transcript hasn't changed. */
export async function describe(id: string, force = false): Promise<Description> {
  return (await run(["describe", id, ...(force ? ["--force"] : [])])).description as Description;
}
