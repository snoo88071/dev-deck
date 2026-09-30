/**
 * The shell: a sidebar with the four pages (it folds to icons in a narrow
 * window), a page header with the summary and the filter, and the page.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Dropdown, Flex, Input, Layout, Menu, Tooltip, Typography, theme, type InputRef } from "antd";
import {
  AppstoreOutlined, ClearOutlined, DesktopOutlined, FieldTimeOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  MoonOutlined, RobotOutlined, SearchOutlined, SunOutlined,
} from "@ant-design/icons";
import { DEMO } from "./api";
import { MONO } from "./components/bits";
import { mb } from "./format";
import { useDeck } from "./store";
import type { ThemeMode } from "./theme";
import { SessionsPage } from "./pages/Sessions";
import { ProcessesPage } from "./pages/Processes";
import { CleanupPage } from "./pages/Cleanup";
import { JobsPage } from "./pages/Jobs";
import { broken } from "./format";

type Page = "sessions" | "processes" | "jobs" | "cleanup";
const PAGES: Page[] = ["sessions", "processes", "jobs", "cleanup"];
const PAGE_KEY = "devdeck.page";
const SIDER_KEY = "devdeck.sider";
/** Below this window width the sidebar starts folded to icons. */
const FOLD_BELOW = 900;
/** Below this the page drops secondary columns. */
export const NARROW_BELOW = 600;

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

  const mine = deck.groups.filter((g) => !g.by_claude);
  const nProcs = deck.groups.reduce((s, g) => s + g.procs.length, 0);
  const memory = deck.groups.reduce((s, g) => s + g.memory, 0);
  const allJobs = deck.jobs.flatMap((g) => g.jobs);
  const nBroken = allJobs.filter(broken).length;
  const recent = deck.sessions.filter((x) => x.session.last_activity && Date.now() / 1000 - x.session.last_activity < 3600).length;

  const count = (n: number, attention?: boolean) => (
    <Badge count={n} showZero={!attention} size="small"
      style={attention ? undefined : { backgroundColor: token.colorFillSecondary, color: token.colorTextSecondary, boxShadow: "none" }} />
  );
  const label = (text: string, n: number, attention?: boolean) => (
    <Flex justify="space-between" align="center" gap={8}>{text}{count(n, attention)}</Flex>
  );
  const items = [
    { key: "sessions", icon: <RobotOutlined aria-hidden />, label: label(t("nav.sessions"), deck.sessions.length) },
    { key: "processes", icon: <AppstoreOutlined aria-hidden />, label: label(t("nav.processes"), mine.length) },
    { key: "jobs", icon: <FieldTimeOutlined aria-hidden />, label: label(t("nav.jobs"), allJobs.length) },
    {
      key: "cleanup",
      icon: <Badge dot={folded && deck.pending.length > 0} offset={[2, 2]}><ClearOutlined aria-hidden style={{ color: "inherit" }} /></Badge>,
      label: label(t("nav.cleanup"), deck.pending.length, true),
    },
  ];

  const headers: Record<Page, [string, string, string]> = {
    sessions: [t("nav.sessions"), `${t("header.open", { count: deck.sessions.length })} · ${t("header.recent", { count: recent })}`, t("header.filterSessions")],
    processes: [
      t("nav.processes"),
      `${t("count.project", { count: mine.length })} · ${t("count.process", { count: nProcs })} · ${mb(memory)}`,
      t("header.filterProcesses"),
    ],
    jobs: [
      t("nav.jobs"),
      `${t("count.task", { count: allJobs.length })} · ${t("count.project", { count: deck.jobs.length })}`
        + (nBroken ? ` · ${t("header.jobsBroken", { count: nBroken })}` : ""),
      t("header.filterJobs"),
    ],
    cleanup: [
      t("nav.cleanup"),
      deck.pending.length ? t("header.cleanupPending", { count: deck.pending.length }) : t("header.cleanupNone"),
      t("header.filterCleanup"),
    ],
  };
  const [title, summary, placeholder] = headers[page];
  const pad = narrow ? 12 : 20;

  let body: ReactNode;
  if (page === "sessions") body = <SessionsPage narrow={narrow} />;
  // A project's "N scheduled" opens the Scheduled page filtered on that project.
  else if (page === "processes") body = <ProcessesPage narrow={narrow} showJobs={(root) => { setPage("jobs"); onFilter(root); }} />;
  else if (page === "jobs") body = <JobsPage narrow={narrow} />;
  else body = <CleanupPage narrow={narrow} />;

  return (
    <Layout hasSider style={{ height: "100%", background: token.colorBgLayout }}>
      <Layout.Sider theme="light" width={184} collapsedWidth={56} collapsed={folded} trigger={null}
        style={{ height: "100%", borderInlineEnd: `1px solid ${token.colorBorderSecondary}` }}>
        <Flex vertical style={{ height: "100%" }}>
          <Flex align="center" gap={10} style={{ height: 56, paddingInline: folded ? 16 : 18, flex: "none" }}>
            <div aria-hidden="true" style={{
              width: 24, height: 24, borderRadius: 6, background: token.colorPrimary, color: "#fff", flex: "none",
              display: "grid", placeItems: "center", fontFamily: MONO, fontSize: 12, fontWeight: 500,
            }}>dd</div>
            {folded ? null : <Typography.Text strong style={{ fontSize: 15, whiteSpace: "nowrap" }}>Dev Deck</Typography.Text>}
          </Flex>
          <nav aria-label={t("nav.pages")} style={{ flex: 1, overflow: "auto" }}>
            <Menu mode="inline" selectedKeys={[page]} items={items} onClick={(e) => setPage(e.key as Page)} style={{ borderInlineEnd: "none" }} />
          </nav>
          <Flex vertical={folded} justify="center" align="center" gap={4} style={{ padding: 8, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
            <ThemeMenu mode={themeMode} setMode={setThemeMode} />
            <Tooltip title={folded ? t("nav.expand") : t("nav.fold")} placement="right">
              <Button type="text" icon={folded ? <MenuUnfoldOutlined aria-hidden /> : <MenuFoldOutlined aria-hidden />} aria-label={folded ? t("nav.expand") : t("nav.fold")} onClick={toggleSider} />
            </Tooltip>
          </Flex>
        </Flex>
      </Layout.Sider>

      <Layout style={{ background: token.colorBgLayout, minWidth: 0 }}>
        <header style={{ padding: `16px ${pad}px 12px` }}>
          <Flex justify="space-between" align="flex-start" gap={12} wrap>
            <div style={{ minWidth: 0 }}>
              <Typography.Title level={4} style={{ margin: 0 }}>{title}</Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {summary}{DEMO ? ` · ${t("header.demo")}` : ""}
              </Typography.Text>
            </div>
            <Input ref={filterRef} id="filter" allowClear placeholder={placeholder} aria-label={placeholder}
              value={filterText} onChange={(e) => onFilter(e.target.value)}
              prefix={<SearchOutlined aria-hidden style={{ color: token.colorTextTertiary }} />}
              suffix={filterText ? null : <kbd aria-hidden="true" style={{ fontFamily: MONO, fontSize: 11, padding: "0 5px", border: `1px solid ${token.colorBorder}`, borderRadius: 4, color: token.colorTextTertiary }}>/</kbd>}
              style={{ width: narrow ? "100%" : 240 }} />
          </Flex>
        </header>
        <Layout.Content style={{ padding: `0 ${pad}px ${pad}px`, overflow: "auto" }}>
          {body}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
