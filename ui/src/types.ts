/** The shapes Rust sends (src-tauri/src/procs.rs, sessions.rs, describe.rs). */

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
