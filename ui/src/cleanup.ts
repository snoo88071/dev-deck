/**
 * The cleanup rules live in ui/cleanup.js, shared with the MCP server (which
 * requires it from Node). It is UMD: the build bundles it as CommonJS (so it arrives
 * as the default export), while the dev server serves it as-is (so it sets
 * `self.DevDeckCleanup`).
 */
import * as mod from "../cleanup.js";
import type { Group, JobGroup } from "./types";

export interface Proposal {
  id: string;
  category: string;
  pid: number;
  pids: number[];
  root: string | null;
  project: string;
  cmd: string;
  ports: number[];
  evidence: string[];
  /** Task proposals: the task's path in the Task Scheduler, and its name. */
  task?: string;
  name?: string;
}

interface CleanupApi {
  propose(groups: Group[], ctx?: { session?: number | null; projects?: string[]; idleHours?: number }): Proposal[];
  proposeTasks(jobs: JobGroup[], ctx?: { projects?: string[] }): Proposal[];
  isMcp(p: { tool: string | null; cmd: string }): boolean;
  inProjects(path: string | null, projects: string[]): boolean;
  CATEGORIES: string[];
  LABELS: Record<string, string>;
  IDLE_HOURS: number;
}

export const cleanup: CleanupApi =
  (mod as unknown as { default?: CleanupApi }).default ?? (globalThis as unknown as { DevDeckCleanup: CleanupApi }).DevDeckCleanup;
