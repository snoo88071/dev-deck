/**
 * Dev Deck for Claude Code: the development processes of the session and its
 * projects, and a cleanup that for now runs «in shadow mode».
 *
 *   dev_processes  what's running: the session's and its projects', or the whole machine's
 *   dev_cleanup    cleanup proposals, with category and evidence; closes NOTHING,
 *                  writes them to the shadow file for you to judge (panel or here)
 *   dev_verdict    the user's verdict on a proposal, to record
 *   dev_sessions   the open Claude Code sessions and what they're working on (read only)
 *   dev_jobs       the Windows scheduled tasks that run something in a project (read only)
 *   dev_kill       kills processes, with a reason (also in the shadow file)
 *   dev_restart    restarts a process with its command, folder and environment, with a reason
 *
 * The session is the Claude Code that launched this server: its pid is found
 * by walking up from this process. The projects are the folder Claude Code
 * started it in, plus those the tool passes.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// The panel's cleanup rules (plain CommonJS): a static import, so the plugin bundle carries them.
import cleanupRules from "../../ui/cleanup.js";
import * as devdeck from "./devdeck.ts";
import type { Group, Job, JobGroup, Proc, Trigger } from "./devdeck.ts";
import { append, recordProposals, recordVerdict, VERDICTS, type Verdict } from "./shadow.ts";

const cleanup = cleanupRules as unknown as {
  propose(groups: Group[], ctx: { session?: number | null; projects?: string[] }): Proposal[];
  proposeTasks(jobs: JobGroup[], ctx: { projects?: string[] }): Proposal[];
  isMcp(p: Proc): boolean;
  inProjects(path: string | null, projects: string[]): boolean;
  LABELS: Record<string, string>;
};

interface Proposal {
  id: string;
  category: string;
  pid: number;
  pids: number[];
  root: string | null;
  project: string;
  cmd: string;
  ports: number[];
  evidence: string[];
  /** Task proposals: the task's path, and its name. */
  task?: string;
  name?: string;
}

/** This session's Claude Code: the claude_pid of this process in the list. */
function sessionOf(groups: Group[]): number | null {
  for (const g of groups) for (const p of g.procs) if (p.pid === process.pid) return p.claude_pid;
  return null;
}

function projectsOf(extra?: string[]): string[] {
  return [process.cwd(), ...(extra ?? [])];
}

function mb(bytes: number) {
  return `${Math.round(bytes / 1048576)} MB`;
}
function age(sec: number) {
  return sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`;
}

function procLine(p: Proc) {
  const who = [p.runtime, p.tool].filter(Boolean).join("/");
  const ports = p.ports.length ? ` :${p.ports.join(" :")}` : "";
  const tag = (p.claude ? " [Claude Code]" : p.launcher === "claude" ? " [from Claude Code]" : "") + (p.task ? ` [scheduled task "${p.task}"]` : "");
  return `${"  ".repeat(p.depth)}- pid ${p.pid} ${who}${ports} · ${mb(p.memory)} · up ${age(p.run_time)}${tag}\n${"  ".repeat(p.depth)}  ${p.cmd.slice(0, 160)}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const stamp = (iso: string) => iso.replace("T", " ").slice(0, 16);

/** A trigger in words: "every day at 07:00", "Tue, Fri at 09:00, then every 2 h". */
function triggerText(t: Trigger): string {
  const time = t.start ? t.start.slice(11, 16) : "";
  let s: string;
  if (t.kind === "daily") s = t.every > 1 ? `every ${t.every} days at ${time}` : `every day at ${time}`;
  else if (t.kind === "weekly") s = `${t.every > 1 ? `every ${t.every} weeks, ` : ""}${[...t.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d]).join(", ")} at ${time}`;
  else if (t.kind === "once") s = `once, ${t.start ? stamp(t.start) : "?"}`;
  else s = ({ monthly: "monthly", logon: "at sign-in", boot: "at startup", idle: "when the PC is idle", event: "on a system event" } as Record<string, string>)[t.kind] ?? "on another trigger";
  if (t.repeat_minutes) s += `, then every ${t.repeat_minutes % 60 ? `${t.repeat_minutes} min` : `${t.repeat_minutes / 60} h`}`;
  return t.enabled ? s : `${s} (trigger off)`;
}

/** The last run's outcome in words. */
function outcomeText(j: Job): string {
  if (j.running || j.result === "running") return "running now";
  if (!j.last_run || j.result === "not-run") return "never ran";
  const code = `0x${(j.last_result >>> 0).toString(16).toUpperCase()}`;
  const words: Record<string, string> = {
    ok: "succeeded", exit: `ended with exit code ${j.last_result}`, terminated: "stopped before the end",
    "folder-missing": `failed: the folder doesn't exist (${code})`, "file-missing": `failed: file not found (${code})`,
    "path-missing": `failed: path not found (${code})`, denied: `failed: access denied (${code})`, refused: `refused by Windows (${code})`,
  };
  return `${stamp(j.last_run)}, ${words[j.result] ?? `failed (${code})`}`;
}

function jobLines(j: Job): string {
  const when = j.triggers.length ? j.triggers.map(triggerText).join("; ") : "only when started by hand";
  const next = !j.enabled ? "DISABLED" : j.next_run ? `next: ${stamp(j.next_run)}` : "no next run";
  return [
    `- "${j.name}" (${j.path}) · ${j.runtime} · ${when} · ${next}`,
    `  runs: ${j.cmd.slice(0, 200)}`,
    j.workdir ? `  in: ${j.workdir}` : null,
    `  last run: ${outcomeText(j)}`,
    j.missing ? `  MISSING: ${j.missing} no longer exists, so every run fails` : null,
    j.description ? `  about: ${j.description.slice(0, 200)}` : null,
  ].filter(Boolean).join("\n");
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

const server = new McpServer({ name: "dev-deck", version: "0.1.0" });

server.registerTool(
  "dev_processes",
  {
    title: "Development processes",
    description:
      "Lists the running development processes (node, bun, deno, python, cargo, java, dotnet...), grouped by project, with pid, command, ports, memory and how long they've been running. By default only those of this Claude Code session and its projects; with scope 'all', the whole machine. The MCP servers of Claude Code sessions are counted separately, not listed.",
    inputSchema: {
      scope: z.enum(["session", "all"]).default("session").describe("session: this session and its projects; all: the whole machine"),
      projects: z.array(z.string()).optional().describe("other project folders this session is working on"),
    },
  },
  async ({ scope, projects }) => {
    const groups = await devdeck.list();
    const session = sessionOf(groups);
    const dirs = projectsOf(projects);
    const shown = groups.filter(
      (g) => scope === "all" || cleanup.inProjects(g.root, dirs) || g.procs.some((p) => session && p.claude_pid === session && !cleanup.isMcp(p)),
    );
    const lines: string[] = [];
    let mcpHidden = 0;
    for (const g of shown) {
      const procs = g.procs.filter((p) => !(p.launcher === "claude" && cleanup.isMcp(p)));
      mcpHidden += g.procs.length - procs.length;
      if (!procs.length) continue;
      lines.push(`## ${g.name}${g.ports.length ? ` :${g.ports.join(" :")}` : ""}\n${g.root ?? "(unknown folder)"}`);
      for (const p of procs) lines.push(procLine(p));
    }
    const head = `Claude Code session: pid ${session ?? "?"} · projects: ${dirs.join(", ")} · ${scope}`;
    const tail = mcpHidden ? `\n(${mcpHidden} processes are MCP servers of Claude Code sessions: not listed)` : "";
    return text(`${head}\n\n${lines.join("\n") || "No development processes running here."}${tail}`);
  },
);

server.registerTool(
  "dev_sessions",
  {
    title: "Claude Code sessions",
    description:
      "Lists the Claude Code sessions open on the machine (terminal, VS Code, background jobs): folder, title, last prompt, how long ago it was active, how many child processes it keeps running, and a short description of what it's doing (written by claude -p and cached). To find out what other sessions are working on, use this, not agent lists: only this has the description of the work. Also useful before touching a process that might belong to another session. Read only: sessions are not closed from here. Descriptions are opt-in (the user turns them on in the Dev Deck panel, or with DEVDECK_DESCRIBE=1); when they are off, do not suggest turning them on unless the user asks. With describe: true and descriptions on, it first redoes the stale descriptions (a few seconds each).",
    inputSchema: {
      describe: z.boolean().default(false).describe("redo the stale descriptions before answering"),
    },
  },
  async ({ describe }) => {
    const [{ rows, describeOn }, groups] = await Promise.all([devdeck.sessions(), devdeck.list()]);
    const me = sessionOf(groups);
    if (describe && describeOn) {
      for (const r of rows.filter((r) => r.session.session_id && !r.description_fresh).slice(0, 6)) {
        try {
          r.description = await devdeck.describe(r.session.session_id!);
          r.description_fresh = true;
        } catch {
          // one description that fails doesn't stop the others
        }
      }
    }
    if (!rows.length) return text("No Claude Code sessions open.");
    const now = Date.now() / 1000;
    const lines = rows.map(({ session: s, description: d, description_fresh: fresh }) => {
      const active = s.last_activity ? `active ${age(Math.max(0, now - s.last_activity))} ago` : "no transcript";
      const who = s.pid === me ? " ← this session" : "";
      const desc = d ? `${d.text}${fresh ? "" : " (description out of date)"}` : describeOn ? "(no description yet)" : "(descriptions are off)";
      return `- pid ${s.pid} · ${s.kind} · ${s.project ?? "?"} · ${active} · open for ${age(s.run_time)}${who}\n  ${s.cwd ?? ""}\n  title: ${s.title ?? "-"}\n  doing: ${desc}\n  last prompt: ${(s.last_prompt ?? "-").slice(0, 160)}\n  child processes: ${s.children} (${mb(s.children_memory)})${s.match === "uncertain" ? "\n  (transcript matched by time, uncertain)" : ""}`;
    });
    return text(`${rows.length} Claude Code sessions open:\n\n${lines.join("\n")}`);
  },
);

server.registerTool(
  "dev_jobs",
  {
    title: "Scheduled tasks",
    description:
      "Lists the Windows scheduled tasks (Task Scheduler) that run something in a project: scripts that run on a schedule (every day at 7, every 48 hours...), grouped by project, with what they run, when, the last run and its outcome, the next run, and whether their folder or script is gone. By default only this session's projects; with scope 'all', every project on the machine. Check it BEFORE creating a scheduled task (to update one that exists instead of adding a duplicate) and when the user asks what runs on a schedule. Read only: running, disabling or deleting a task is done by the user in the Dev Deck panel (Scheduled page).",
    inputSchema: {
      scope: z.enum(["session", "all"]).default("session").describe("session: this session's projects; all: every project on the machine"),
      projects: z.array(z.string()).optional().describe("other project folders this session is working on"),
    },
  },
  async ({ scope, projects }) => {
    const dirs = projectsOf(projects);
    const groups = (await devdeck.jobs()).filter((g) => scope === "all" || cleanup.inProjects(g.root, dirs));
    const where = scope === "all" ? "on this machine" : `in ${dirs.join(", ")}`;
    if (!groups.length) return text(`No scheduled task runs anything ${where}.`);
    const n = groups.reduce((s, g) => s + g.jobs.length, 0);
    const blocks = groups.map((g) => `## ${g.name}\n${g.root}\n${g.jobs.map(jobLines).join("\n")}`);
    return text(`${n} scheduled task${n === 1 ? "" : "s"} ${where}:\n\n${blocks.join("\n\n")}`);
  },
);

server.registerTool(
  "dev_cleanup",
  {
    title: "Cleanup (shadow mode)",
    description:
      "Proposes which development processes to close, by category (orphan-mcp, duplicate, session, idle) and with the evidence for each, within the scope of this session and its projects; and which scheduled tasks of those projects look broken (task-gone: their folder or script no longer exists; task-failing: their last run failed). It runs IN SHADOW MODE: it closes nothing. The proposals are recorded in the shadow file to measure where Claude could later act on its own. Show the proposals to the user and ask what to do; if they decide, record their verdict with dev_verdict and close with dev_kill only what they said to close.",
    inputSchema: {
      projects: z.array(z.string()).optional().describe("other project folders this session is working on"),
    },
  },
  async ({ projects }) => {
    const groups = await devdeck.list();
    const session = sessionOf(groups);
    const dirs = projectsOf(projects);
    // The Task Scheduler may be unreadable (another OS, a policy): the processes still count.
    const jobGroups = await devdeck.jobs().catch(() => [] as JobGroup[]);
    const proposals = [...cleanup.propose(groups, { session, projects: dirs }), ...cleanup.proposeTasks(jobGroups, { projects: dirs })];
    const recorded = recordProposals(
      proposals.map((p) => ({
        source: "claude" as const,
        session,
        projects: dirs,
        category: p.category,
        pid: p.pid,
        pids: p.pids,
        cmd: p.cmd,
        root: p.root,
        ports: p.ports,
        evidence: p.evidence,
        ...(p.task ? { task: p.task } : {}),
      })),
    );
    if (!recorded.length) return text(`Nothing to clean up in scope (session ${session ?? "?"}, projects: ${dirs.join(", ")}).`);
    const lines = recorded.map((r) => {
      const what = r.task ? `scheduled task "${r.task.split("\\").pop()}" (${r.task})` : `pid ${r.pid}${r.pids.length > 1 ? ` (+${r.pids.length - 1} children)` : ""}`;
      return `- [${r.id}] ${cleanup.LABELS[r.category] ?? r.category} · ${what} · ${r.root ?? "?"}\n  ${r.cmd.slice(0, 160)}\n  evidence: ${r.evidence.join("; ")}`;
    });
    const tasks = recorded.some((r) => r.task)
      ? " For a scheduled task, closing means disabling it: the user does that in the Dev Deck panel (Cleanup or Scheduled page); dev_kill doesn't apply."
      : "";
    return text(
      `SHADOW MODE: nothing was closed. ${recorded.length} proposals, recorded for the user's verdict:\n\n${lines.join("\n")}\n\nAsk the user, for each one: close / right but keep / wrong. Then call dev_verdict with the id in brackets, and dev_kill only for the processes to close.${tasks}`,
    );
  },
);

server.registerTool(
  "dev_verdict",
  {
    title: "Verdict on a proposal",
    description:
      "Records in the shadow file THE USER'S verdict on a dev_cleanup proposal: 'close' (right, close it), 'keep' (right diagnosis, but they keep it), 'wrong'. Use it only with a verdict the user expressed, never with your own.",
    inputSchema: {
      proposal: z.string().describe("the proposal id, in square brackets in the dev_cleanup output"),
      verdict: z.enum(VERDICTS as [Verdict, ...Verdict[]]),
      note: z.string().optional().describe("why, in the user's words"),
    },
  },
  async ({ proposal, verdict, note }) => {
    recordVerdict(proposal, verdict, note);
    return text(`Verdict recorded: ${proposal} → ${verdict}.`);
  },
);

server.registerTool(
  "dev_kill",
  {
    title: "Kill processes",
    description:
      "Kills development processes along with their whole process tree. Requires a reason, which is written to the shadow file. Refuses MCP servers belonging to other Claude Code sessions that are still alive, unless force is set (only if the user explicitly asked for it).",
    inputSchema: {
      pids: z.array(z.number().int().positive()).min(1),
      reason: z.string().min(3).describe("why, in one line (e.g. «the user said to close the duplicate»)"),
      proposal: z.string().optional().describe("the dev_cleanup proposal id, if it comes from there"),
      force: z.boolean().default(false),
    },
  },
  async ({ pids, reason, proposal, force }) => {
    const groups = await devdeck.list();
    const session = sessionOf(groups);
    const all = groups.flatMap((g) => g.procs);
    const blocked = pids.filter((pid) => {
      const p = all.find((x) => x.pid === pid);
      return p && cleanup.isMcp(p) && p.claude_pid && p.claude_pid !== session;
    });
    if (blocked.length && !force) {
      return text(`Not killing ${blocked.join(", ")}: they are MCP servers of another Claude Code session that is still open. If the user really wants it, call again with force.`);
    }
    try {
      const killed = await devdeck.kill(pids);
      append({ type: "action", at: new Date().toISOString(), source: "claude", action: "kill", pids, reason, ...(proposal ? { proposal } : {}), ok: true });
      return text(`Killed ${killed} process trees (${pids.join(", ")}).`);
    } catch (e) {
      const error = (e as Error).message;
      append({ type: "action", at: new Date().toISOString(), source: "claude", action: "kill", pids, reason, ...(proposal ? { proposal } : {}), ok: false, error });
      return { ...text(`Not killed: ${error}`), isError: true };
    }
  },
);

server.registerTool(
  "dev_restart",
  {
    title: "Restart a process",
    description:
      "Restarts the root of a process tree: kills it and relaunches it with the same command, the same folder and the same environment, in a new window (where the user sees the output). Requires a reason, which is written to the shadow file.",
    inputSchema: {
      pid: z.number().int().positive(),
      reason: z.string().min(3),
    },
  },
  async ({ pid, reason }) => {
    const groups = await devdeck.list();
    const g = groups.find((x) => x.procs.some((p) => p.pid === pid));
    try {
      await devdeck.restart(pid, `${g?.name ?? "Dev Deck"} (Dev Deck)`);
      append({ type: "action", at: new Date().toISOString(), source: "claude", action: "restart", pids: [pid], reason, ok: true });
      return text(`Restarted ${pid}${g ? ` (${g.name})` : ""}: it runs in a new window.`);
    } catch (e) {
      const error = (e as Error).message;
      append({ type: "action", at: new Date().toISOString(), source: "claude", action: "restart", pids: [pid], reason, ok: false, error });
      return { ...text(`Not restarted: ${error}`), isError: true };
    }
  },
);

await server.connect(new StdioServerTransport());
