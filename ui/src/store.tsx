/**
 * The panel's state: processes every 3 s and sessions every 15 s, only while the
 * window is visible (closing it hides it to the tray), plus the shadow file and
 * the description setting. Pages read it through `useDeck()`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { DescribeSettings, Group, ProposalRecord, SessionRow, ShadowRecord } from "./types";

const PROCESSES_MS = 3000;
const SESSIONS_MS = 15000;

interface Deck {
  groups: Group[];
  sessions: SessionRow[];
  shadow: ShadowRecord[];
  pending: ProposalRecord[];
  describe: DescribeSettings;
  loaded: boolean;
  filter: string;
  setFilter: (f: string) => void;
  refresh: () => Promise<void>;
  loadSessions: () => Promise<void>;
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
  const [shadow, setShadow] = useState<ShadowRecord[]>([]);
  const [describe, setDescribe] = useState<DescribeSettings>({ enabled: false, forced: false });
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilterRaw] = useState("");
  const visible = useVisible();
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      setGroups(await api.list());
      setLoaded(true);
    } catch {
      // A failed read keeps the last list; the next tick tries again.
    } finally {
      busy.current = false;
    }
  }, []);
  const loadSessions = useCallback(async () => {
    try { setSessions(await api.sessions()); } catch { setSessions([]); }
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
    const a = setInterval(refresh, PROCESSES_MS);
    const b = setInterval(loadSessions, SESSIONS_MS);
    return () => { clearInterval(a); clearInterval(b); };
  }, [visible, refresh, loadSessions]);

  const value = useMemo<Deck>(() => ({
    groups, sessions, shadow, pending: pendingOf(shadow), describe, loaded,
    filter, setFilter: (f: string) => setFilterRaw(f.trim().toLowerCase()),
    refresh, loadSessions, loadShadow, loadDescribe,
  }), [groups, sessions, shadow, describe, loaded, filter, refresh, loadSessions, loadShadow, loadDescribe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeck(): Deck {
  const d = useContext(Ctx);
  if (!d) throw new Error("useDeck outside DeckProvider");
  return d;
}
