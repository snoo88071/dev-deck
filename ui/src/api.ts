/**
 * Every action goes through Rust, which re-checks the pids. Outside Tauri (a plain
 * browser, `npm run ui:dev`) the same calls answer from demo data.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { demoCall } from "./demo";
import type { CpuHistory, DescribeSettings, Description, Freed, Group, JobGroup, Memory, PastRow, SessionRow, ShadowRecord } from "./types";

export const DEMO = !isTauri();

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return DEMO ? (demoCall(cmd, args) as Promise<T>) : invoke<T>(cmd, args);
}

export const api = {
  list: () => call<Group[]>("list"),
  /** Resolves 2 s after the kill, with the RAM measured before and after. */
  kill: (pids: number[]) => call<Freed>("kill", { pids }),
  /** Closes a Claude Code session with its whole tree; resolves like `kill`. */
  closeSession: (pid: number) => call<Freed>("close_session", { pid }),
  memory: () => call<Memory>("memory"),
  /** Every session a person opened, most recent first. */
  history: () => call<PastRow[]>("history"),
  /** `force`: even if the cached description is still fresh. */
  describePast: (id: string, force: boolean) => call<Description>("describe_past", { id, force }),
  /** Opens a terminal in the session's folder with `claude --resume <id>`. */
  resume: (id: string) => call<void>("resume", { id }),
  cpuHistory: () => call<CpuHistory>("cpu_history"),
  restart: (pid: number, title: string) => call<void>("restart", { pid, title }),
  openPort: (port: number) => call<void>("open_port", { port }),
  openFolder: (path: string, editor: boolean) => call<void>("open_folder", { path, editor }),
  sessions: () => call<SessionRow[]>("sessions"),
  describeSession: (pid: number) => call<Description>("describe_session", { pid }),
  describeSettings: () => call<DescribeSettings>("describe_settings"),
  setDescribe: (on: boolean) => call<void>("set_describe", { on }),
  appLanguage: () => call<string>("app_language"),
  shadowRead: () => call<ShadowRecord[]>("shadow_read"),
  shadowAppend: (record: ShadowRecord) => call<void>("shadow_append", { record }),
  jobs: () => call<JobGroup[]>("jobs"),
  jobAct: (path: string, act: "run" | "enable" | "disable") => call<void>("job_act", { path, act }),
  /** Returns where the copy of the task's definition went. */
  jobDelete: (path: string) => call<string>("job_delete", { path }),
};
