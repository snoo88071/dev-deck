/**
 * The panel's state: processes and the machine's RAM every 3 s, scheduled tasks every 10 s,
 * sessions, the CPU history and the sessions' history every 15 s, only while the window is visible (closing it
 * hides it to the tray), plus the shadow file and the description setting. Pages read it
 * through `useDeck()`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { CpuHistory, DescribeSettings, Freed, Group, JobGroup, Memory, PastRow, ProposalRecord, SessionRow, ShadowRecord } from "./types";

const PROCESSES_MS = 3000;
const SESSIONS_MS = 15000;
/** A read of the Task Scheduler takes about a tenth of a second; tasks change rarely. */
const JOBS_MS = 10000;

interface Deck {
  groups: Group[];
  sessions: SessionRow[];
  jobs: JobGroup[];
  jobsLoaded: boolean;
  shadow: ShadowRecord[];
  pending: ProposalRecord[];
  describe: DescribeSettings;
  memory: Memory | null;
  history: CpuHistory;
  /** Every session a person opened, most recent first (the History page). */
  past: PastRow[];
  /** After a closing: the RAM measured 2 s later, and the pids to drop from the lists until the next read. */
  applyFreed: (f: Freed, gone: number[]) => void;
  loaded: boolean;
  filter: string;
  setFilter: (f: string) => void;
  refresh: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadJobs: () => Promise<void>;
  loadShadow: () => Promise<void>;
  loadDescribe: () => Promise<void>;
}

const Ctx = createContext<Deck | null>(null);

/** Proposals still without a verdict, most recent first. */
function pendingOf(shadow: ShadowRecord[]): ProposalRecord[] {
  const judged = new Set(shadow.flatMap((r) => (r.type === "verdict" ? [r.proposal] : [])));
  return shadow.filter((r): r is ProposalRecord => r.type === "proposal" && !judged.has(r.id)).reverse();
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

export function DeckProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [jobs, setJobs] = useState<JobGroup[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [shadow, setShadow] = useState<ShadowRecord[]>([]);
  const [describe, setDescribe] = useState<DescribeSettings>({ enabled: false, forced: false });
  const [memory, setMemory] = useState<Memory | null>(null);
  const [history, setHistory] = useState<CpuHistory>({});
  const [past, setPast] = useState<PastRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilterRaw] = useState("");
  const visible = useVisible();
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const [g, m] = await Promise.all([api.list(), api.memory().catch(() => null)]);
      setGroups(g);
      if (m) setMemory(m);
      setLoaded(true);
    } catch {
      // A failed read keeps the last list; the next tick tries again.
    } finally {
      busy.current = false;
    }
  }, []);
  const loadSessions = useCallback(async () => {
    try { setSessions(await api.sessions()); } catch { setSessions([]); }
    try { setHistory(await api.cpuHistory()); } catch { /* keep the last one */ }
    try { setPast(await api.history()); } catch { /* keep the last one */ }
  }, []);
  const applyFreed = useCallback((f: Freed, gone: number[]) => {
    setMemory((m) => (m ? { ...m, available: f.after } : m));
    // Out of the lists now, so the strip and the rows move with the measured figure.
    setSessions((xs) => xs.filter((r) => !gone.includes(r.session.pid)));
    setGroups((gs) => gs.map((g) => ({ ...g, procs: g.procs.filter((p) => !gone.includes(p.pid)) })).filter((g) => g.procs.length));
  }, []);
  const loadJobs = useCallback(async () => {
    // A failed read keeps the last list, as for processes.
    try { setJobs(await api.jobs()); setJobsLoaded(true); } catch { /* next tick */ }
  }, []);
  const loadShadow = useCallback(async () => {
    try { setShadow(await api.shadowRead()); } catch { setShadow([]); }
  }, []);
  const loadDescribe = useCallback(async () => {
    try { setDescribe(await api.describeSettings()); } catch { /* keep them off */ }
  }, []);

  useEffect(() => {
    loadShadow();
    loadDescribe();
  }, [loadShadow, loadDescribe]);

  useEffect(() => {
    if (!visible) return;
    refresh();
    loadSessions();
    loadJobs();
    const a = setInterval(refresh, PROCESSES_MS);
    const b = setInterval(loadSessions, SESSIONS_MS);
    const c = setInterval(loadJobs, JOBS_MS);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
  }, [visible, refresh, loadSessions, loadJobs]);

  const value = useMemo<Deck>(() => ({
    groups, sessions, jobs, jobsLoaded, shadow, pending: pendingOf(shadow), describe, memory, history, past, applyFreed, loaded,
    filter, setFilter: (f: string) => setFilterRaw(f.trim().toLowerCase()),
    refresh, loadSessions, loadJobs, loadShadow, loadDescribe,
  }), [groups, sessions, jobs, jobsLoaded, shadow, describe, memory, history, past, applyFreed, loaded, filter, refresh, loadSessions, loadJobs, loadShadow, loadDescribe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeck(): Deck {
  const d = useContext(Ctx);
  if (!d) throw new Error("useDeck outside DeckProvider");
  return d;
}
