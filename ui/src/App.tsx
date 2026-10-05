/**
 * The shell: a sidebar with the pages (it folds to icons in a narrow window), a page
 * header with the summary and the filter, and the page. A number beside a page is how
 * many things it holds; a red one is something waiting for you.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Dropdown, Flex, Input, Layout, Menu, Tooltip, Typography, theme, type InputRef } from "antd";
import {
  AppstoreOutlined, ClearOutlined, DesktopOutlined, FieldTimeOutlined, FileSearchOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  MoonOutlined, RobotOutlined, SearchOutlined, SunOutlined,
} from "@ant-design/icons";
import { DEMO } from "./api";
import { MONO } from "./components/bits";
import { mb } from "./format";
import { useDeck } from "./store";
import { useLook, type ThemeMode } from "./theme";
import { inkOf } from "./palette";
import { SessionsPage } from "./pages/Sessions";
import { ProcessesPage } from "./pages/Processes";
import { CleanupPage } from "./pages/Cleanup";
import { JobsPage } from "./pages/Jobs";
import { HISTORY_WIDTH, HistoryPage } from "./pages/History";
import { FreeFigure, MemoryStrip } from "./components/weight";
import { broken } from "./format";

type Page = "sessions" | "history" | "processes" | "jobs" | "cleanup";
const PAGES: Page[] = ["sessions", "history", "processes", "jobs", "cleanup"];
const PAGE_KEY = "devdeck.page";
const SIDER_KEY = "devdeck.sider";
/** Below this window width the sidebar starts folded to icons. */
const FOLD_BELOW = 900;
/** Below this the page drops secondary columns. */
export const NARROW_BELOW = 600;
/** Past this the page stops growing: rows stay readable on a wide screen. */
const MAX_WIDTH = 1440;

function stored<T extends string>(key: string, ok: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    if (v && ok.includes(v)) return v;
  } catch { /* no storage: defaults */ }
  return fallback;
}
function store(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* remembered for this run only */ }
}

export function useWidth(): number {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

function ThemeMenu({ mode, setMode }: { mode: ThemeMode; setMode: (m: ThemeMode) => void }) {
  const { t } = useTranslation();
  const icons = { system: <DesktopOutlined aria-hidden />, light: <SunOutlined aria-hidden />, dark: <MoonOutlined aria-hidden /> };
  const items = (["system", "light", "dark"] as const).map((k) => ({ key: k, icon: icons[k], label: t(`theme.${k}`) }));
  return (
    <Dropdown trigger={["click"]} menu={{ items, selectable: true, selectedKeys: [mode], onClick: (e) => setMode(e.key as ThemeMode) }}>
      <Tooltip title={t("theme.label")} placement="right"><Button type="text" icon={icons[mode]} aria-label={t("theme.label")} /></Tooltip>
    </Dropdown>
  );
}

/** The mark: a deck, two cards, the front one with a live dot. */
function Mark() {
  const { dark } = useLook();
  const k = inkOf(dark);
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" style={{ flex: "none" }}>
      <rect x="6.5" y="2.5" width="13" height="13" rx="3.5" fill="none" stroke={k.ink} strokeWidth="1.6" opacity=".45" />
      <rect x="2" y="7" width="14" height="13" rx="3.5" fill={k.ink} />
      <circle cx="6.75" cy="15.25" r="2" fill={k.greenFill} />
    </svg>
  );
}

export function App({ themeMode, setThemeMode }: { themeMode: ThemeMode; setThemeMode: (m: ThemeMode) => void }) {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const deck = useDeck();
  const width = useWidth();
  const narrow = width < NARROW_BELOW;
  const [page, setPageState] = useState<Page>(() => stored(PAGE_KEY, PAGES, "sessions"));
  const [siderPref, setSiderPref] = useState(() => stored(SIDER_KEY, ["auto", "open", "folded"] as const, "auto"));
  const folded = siderPref === "auto" ? width < FOLD_BELOW : siderPref === "folded";
  const [filterText, setFilterText] = useState("");
  const filterRef = useRef<InputRef>(null);

  const setPage = (p: Page) => { setPageState(p); store(PAGE_KEY, p); };
  const toggleSider = () => { const v = folded ? "open" : "folded"; setSiderPref(v); store(SIDER_KEY, v); };
  const onFilter = (v: string) => { setFilterText(v); deck.setFilter(v); };

  useEffect(() => { document.body.style.background = token.colorBgLayout; }, [token.colorBgLayout]);

  // "/" jumps to the filter; Esc clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = /input|textarea/i.test((e.target as HTMLElement)?.tagName ?? "");
      if (e.key === "/" && !inField) { e.preventDefault(); filterRef.current?.focus(); }
      if (e.key === "Escape" && inField && filterText) onFilter("");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const nProcs = deck.groups.reduce((s, g) => s + g.procs.length, 0);
  const memory = deck.groups.reduce((s, g) => s + g.memory, 0);
  const allJobs = deck.jobs.flatMap((g) => g.jobs);
  const nBroken = allJobs.filter(broken).length;
  const recent = deck.sessions.filter((x) => x.session.last_activity && Date.now() / 1000 - x.session.last_activity < 3600).length;

  /** How many things a page holds: a quiet figure, none at zero. Something waiting for you: a red badge. */
  const count = (n: number, attention?: boolean) => attention
    ? <Badge count={n} size="small" />
    : n ? <span className="dd-num" style={{ fontSize: 12, color: token.colorTextTertiary }}>{n}</span> : null;
  const label = (text: string, n: number, attention?: boolean) => (
    <Flex justify="space-between" align="center" gap={8}>{text}{count(n, attention)}</Flex>
  );
  const dot = (on: boolean, icon: ReactNode) => <Badge dot={folded && on} offset={[2, 2]}>{icon}</Badge>;
  const items = [
    { key: "sessions", icon: <RobotOutlined aria-hidden />, label: label(t("nav.sessions"), deck.sessions.length) },
    { key: "history", icon: <FileSearchOutlined aria-hidden />, label: label(t("nav.history"), 0) },
    { key: "processes", icon: <AppstoreOutlined aria-hidden />, label: label(t("nav.processes"), deck.groups.length) },
    {
      key: "jobs",
      icon: dot(nBroken > 0, <FieldTimeOutlined aria-hidden style={{ color: "inherit" }} />),
      label: nBroken ? label(t("nav.jobs"), nBroken, true) : label(t("nav.jobs"), allJobs.length),
    },
    {
      key: "cleanup",
      icon: dot(deck.pending.length > 0, <ClearOutlined aria-hidden style={{ color: "inherit" }} />),
      label: label(t("nav.cleanup"), deck.pending.length, true),
    },
  ];

  // The summary is a phrase: what the page holds, in the words the page uses.
  const phrase = (...parts: (string | false)[]) => parts.filter(Boolean).join(", ");
  const headers: Record<Page, [string, string, string]> = {
    sessions: [t("nav.sessions"), phrase(t("header.open", { count: deck.sessions.length }), recent > 0 && t("header.recent", { count: recent })), t("header.filterSessions")],
    history: [
      t("nav.history"),
      phrase(t("count.session", { count: deck.past.length }), t("count.project", { count: new Set(deck.past.map((r) => r.past.project)).size })),
      t("header.filterHistory"),
    ],
    processes: [
      t("nav.processes"),
      phrase(t("count.project", { count: deck.groups.length }), t("count.process", { count: nProcs }), mb(memory)),
      t("header.filterProcesses"),
    ],
    jobs: [
      t("nav.jobs"),
      phrase(t("count.task", { count: allJobs.length }), t("count.project", { count: deck.jobs.length }), nBroken > 0 && t("header.jobsBroken", { count: nBroken })),
      t("header.filterJobs"),
    ],
    cleanup: [
      t("nav.cleanup"),
      deck.pending.length ? t("header.cleanupPending", { count: deck.pending.length }) : t("header.cleanupNone"),
      t("header.filterCleanup"),
    ],
  };
  const [title, summary, placeholder] = headers[page];
  // Room on both sides of the page: more as the window grows.
  const pad = narrow ? 16 : width >= 1280 ? 56 : 36;
  // Where the weight shows: the computer's memory, and what the sessions and processes hold of it.
  const weighed = (page === "sessions" || page === "processes") && deck.memory != null;

  let body: ReactNode;
  if (page === "sessions") body = <SessionsPage narrow={narrow} compact={!narrow && width < 1200} />;
  else if (page === "history") body = <HistoryPage narrow={narrow} />;
  // A project's "N scheduled" opens the Scheduled page filtered on that project.
  else if (page === "processes") body = <ProcessesPage narrow={narrow} compact={!narrow && width < 1100} showJobs={(root) => { setPage("jobs"); onFilter(root); }} />;
  else if (page === "jobs") body = <JobsPage narrow={narrow} />;
  else body = <CleanupPage narrow={narrow} />;

  // History is read like prose: a narrower column, header included, so the edges line up.
  const column = { maxWidth: page === "history" ? HISTORY_WIDTH : MAX_WIDTH, marginInline: "auto", width: "100%" } as const;

  return (
    <Layout hasSider style={{ height: "100%", background: token.colorBgLayout }}>
      <Layout.Sider theme="light" width={196} collapsedWidth={56} collapsed={folded} trigger={null}
        style={{ height: "100%", borderInlineEnd: `1px solid ${token.colorBorderSecondary}` }}>
        <Flex vertical style={{ height: "100%" }}>
          <Flex align="center" gap={10} style={{ height: 60, paddingInline: folded ? 17 : 20, flex: "none" }}>
            <Mark />
            {folded ? null : <Typography.Text strong style={{ fontSize: 15, whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>Dev Deck</Typography.Text>}
          </Flex>
          <nav aria-label={t("nav.pages")} style={{ flex: 1, overflow: "auto" }}>
            <Menu mode="inline" selectedKeys={[page]} items={items} onClick={(e) => setPage(e.key as Page)} style={{ borderInlineEnd: "none", background: "transparent" }} />
          </nav>
          <Flex vertical={folded} justify={folded ? "center" : "flex-start"} align="center" gap={2} style={{ padding: folded ? 8 : "8px 12px" }}>
            <ThemeMenu mode={themeMode} setMode={setThemeMode} />
            <Tooltip title={folded ? t("nav.expand") : t("nav.fold")} placement="right">
              <Button type="text" icon={folded ? <MenuUnfoldOutlined aria-hidden /> : <MenuFoldOutlined aria-hidden />} aria-label={folded ? t("nav.expand") : t("nav.fold")} onClick={toggleSider} />
            </Tooltip>
          </Flex>
        </Flex>
      </Layout.Sider>

      <Layout style={{ background: token.colorBgLayout, minWidth: 0 }}>
        <header style={{ padding: `${narrow ? 16 : 28}px ${pad}px ${narrow ? 12 : 18}px` }}>
          <div style={column}>
            <Flex justify="space-between" align="center" gap={16} wrap>
              <div style={{ minWidth: 0 }}>
                <Typography.Title level={4} style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.25 }}>{title}</Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {summary}{DEMO ? ` (${t("header.demo")})` : ""}
                </Typography.Text>
              </div>
              <Flex align="center" gap={28} style={narrow ? { width: "100%" } : undefined}>
                {weighed && !narrow ? <FreeFigure available={deck.memory!.available} total={deck.memory!.total} /> : null}
                <Input ref={filterRef} id="filter" allowClear placeholder={placeholder} aria-label={placeholder}
                  value={filterText} onChange={(e) => onFilter(e.target.value)}
                  prefix={<SearchOutlined aria-hidden style={{ color: token.colorTextTertiary }} />}
                  suffix={filterText ? null : <kbd aria-hidden="true" style={{ fontFamily: MONO, fontSize: 11, lineHeight: "16px", padding: "0 5px", border: `1px solid ${token.colorBorder}`, borderRadius: 4, color: token.colorTextTertiary }}>/</kbd>}
                  style={{ width: narrow ? "100%" : 260 }} />
              </Flex>
            </Flex>
            {weighed ? (
              <div style={{ marginTop: 18 }}>
                {narrow ? <div style={{ marginBottom: 10 }}><FreeFigure available={deck.memory!.available} total={deck.memory!.total} /></div> : null}
                <MemoryStrip sessions={deck.sessions} groups={deck.groups} total={deck.memory!.total} available={deck.memory!.available} />
              </div>
            ) : null}
          </div>
        </header>
        <Layout.Content style={{ padding: `0 ${pad}px ${pad}px`, overflow: "auto" }}>
          <div style={column}>{body}</div>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
