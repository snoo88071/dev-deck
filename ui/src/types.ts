/** The shapes Rust sends (src-tauri/src/procs.rs, sessions.rs, describe.rs, tasks.rs). */

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
  /** 0 = the root of a tree (the one that restarts). */
  depth: number;
  /** Claude Code itself: stopping it closes a session. */
  claude: boolean;
  /** "claude" for the MCP servers Claude Code launched. */
  launcher: string | null;
  parent_alive?: boolean;
  claude_pid?: number | null;
  /** The scheduled task that started it. */
  task?: string | null;
}

export interface Group {
  root: string | null;
  name: string;
  procs: Proc[];
  ports: number[];
  memory: number;
  cpu: number;
  run_time: number;
  /** Made only of processes Claude Code launched (MCP servers). */
  by_claude: boolean;
}

export interface Session {
  pid: number;
  /** `pid@start`: its key in the CPU history. */
  key: string;
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

/** The machine's RAM, in bytes. */
export interface Memory {
  total: number;
  available: number;
}

/** What closing gave back: the RAM available just before and 2 s after (measured, bytes). */
export interface Freed {
  killed: number;
  before: number;
  after: number;
}

/**
 * The last 24 hours of CPU, by session key or group key (its folder, else its name):
 * 48 half-hour slices, oldest first, as a share of the whole machine (100 = every core).
 * null = no sample (Dev Deck was off, or the process didn't exist yet).
 */
export type CpuHistory = Record<string, (number | null)[]>;

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

export interface DescribeSettings {
  enabled: boolean;
  /** DEVDECK_DESCRIBE decides it: the switch is locked. */
  forced: boolean;
}

export type Verdict = "close" | "keep" | "wrong";

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
  /** A scheduled task instead of a process (pid 0, no pids): its path in the Task Scheduler. */
  task?: string;
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
  action: "kill" | "restart" | "disable";
  pids: number[];
  /** For "disable": the task's path. */
  task?: string;
  reason: string;
  proposal?: string;
  ok: boolean;
  error?: string;
}
export type ShadowRecord = ProposalRecord | VerdictRecord | ActionRecord;

export interface Trigger {
  kind: "once" | "daily" | "weekly" | "monthly" | "logon" | "boot" | "idle" | "event" | "other";
  /** Local time, `YYYY-MM-DDTHH:MM:SS`: its time of day is the schedule's. */
  start: string | null;
  /** Every N days (daily) or weeks (weekly). */
  every: number;
  /** Weekly: 0 = Sunday. */
  days: number[];
  repeat_minutes: number | null;
  enabled: boolean;
}

export type JobResult =
  | "ok" | "running" | "not-run" | "terminated" | "folder-missing" | "file-missing"
  | "path-missing" | "denied" | "refused" | "exit" | "error";

/** A scheduled task that runs something in a project. `path` is its id in the Task Scheduler. */
export interface Job {
  path: string;
  name: string;
  folder: string;
  enabled: boolean;
  running: boolean;
  cmd: string;
  runtime: string;
  script: string | null;
  workdir: string | null;
  /** The folder or script that no longer exists. */
  missing: string | null;
  triggers: Trigger[];
  last_run: string | null;
  next_run: string | null;
  last_result: number;
  result: JobResult;
  pids: number[];
  author: string | null;
  description: string | null;
}

export interface JobGroup {
  root: string;
  name: string;
  jobs: Job[];
}
