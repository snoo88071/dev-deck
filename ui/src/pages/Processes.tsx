/**
 * Processes as a tree table: project → root → its children. Claude Code's MCP
 * servers sit under their own row, and groups made only of them get a table of
 * their own below ("Launched by Claude Code"). Each project row carries its weight:
 * its memory with a meter against the heaviest project, its CPU over 24 hours;
 * amber when it belongs to an idle session, or to one that is gone.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, Table, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import { CloseOutlined, CodeOutlined, FieldTimeOutlined, FolderOpenOutlined, PoweroffOutlined, ReloadOutlined } from "@ant-design/icons";
import { IconButton, Mono, Nothing, PortTag, shortPath } from "../components/bits";
import { useActions } from "../components/actions";
import { MemCell, Sparkline, isDormant, useLeaving } from "../components/weight";
import { chainOf, matches, mb, serversOf, since } from "../format";
import { useDeck } from "../store";
import type { CpuHistory, Group, JobGroup, Proc, SessionRow } from "../types";

type Row =
  | { key: string; kind: "group"; g: Group; level: 0; children?: Row[]; leaving?: boolean }
  | { key: string; kind: "proc"; g: Group; p: Proc; level: number; children?: Row[] }
  | { key: string; kind: "mcp"; g: Group; count: number; level: 1; children: Row[] };

const byClaude = (p: Proc) => p.launcher === "claude";
const groupKey = (g: Group) => `g:${g.root ?? g.name}`;
/** Rust writes both roots the same way; only the case can differ on Windows. */
const sameRoot = (a: string | null, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

/** Rust sends each tree flat, every root followed by its descendants with their depth. */
function nest(g: Group, procs: Proc[], base: number): Row[] {
  const roots: Row[] = [];
  const stack: Row[] = [];
  for (const p of procs) {
    const row: Row = { key: `p:${p.pid}`, kind: "proc", g, p, level: base + p.depth };
    stack.length = p.depth;
    const parent = p.depth ? stack[p.depth - 1] : undefined;
    if (parent) (parent.children ??= []).push(row);
    else roots.push(row);
    stack[p.depth] = row;
  }
  return roots;
}

function rowsOf(g: Group): Row {
  const mine = g.by_claude ? g.procs : g.procs.filter((p) => !byClaude(p));
  const theirs = g.by_claude ? [] : g.procs.filter(byClaude);
  const children = nest(g, mine, 1);
  if (theirs.length) children.push({ key: `m:${g.root ?? g.name}`, kind: "mcp", g, count: theirs.length, level: 1, children: nest(g, theirs, 2) });
  return { key: groupKey(g), kind: "group", g, level: 0, children };
}

/**
 * Forgotten: every process belongs to an idle session, or to one that is gone
 * (an MCP server whose Claude Code closed). Servers started by hand have no session to tell.
 */
function isForgotten(g: Group, sessions: SessionRow[]): boolean {
  const live = new Map(sessions.map((r) => [r.session.pid, isDormant(r.session.last_activity, r.session.run_time)]));
  return g.procs.length > 0 && g.procs.every((p) =>
    p.claude_pid != null ? live.get(p.claude_pid) ?? true : byClaude(p) && p.parent_alive === false);
}

/** Every key under a row that has children: expanding a project opens its whole tree. */
function openKeys(row: Row): string[] {
  return row.children?.length ? [row.key, ...row.children.flatMap(openKeys)] : [];
}

function ProcessTable({ groups, narrow, compact, jobs, showJobs, max, sessions, history }: {
  groups: Group[]; narrow: boolean; jobs: JobGroup[]; showJobs: (root: string) => void;
  /** A mid-size window: the uptime goes, so the names keep their room. */
  compact: boolean;
  /** The heaviest project on the page: the scale of the bars. */
  max: number; sessions: SessionRow[]; history: CpuHistory;
}) {
  const { t } = useTranslation();
  const { stop, restart, openFolder } = useActions();
  const [expanded, setExpanded] = useState<string[]>([]);
  /** What a stop gave back, measured, by project: its row shows it in place of its memory. */
  const [gains, setGains] = useState<Record<string, number>>({});
  const freedIn = (key: string) => (bytes: number) => {
    setGains((g) => ({ ...g, [key]: bytes }));
    setTimeout(() => setGains((g) => { const rest = { ...g }; delete rest[key]; return rest; }), 2000);
  };
  const data = useLeaving(groups, groupKey, 2000).map(({ item, leaving }): Row => ({ ...rowsOf(item), leaving } as Row));
  const share = (g: Group) => Math.min(1, g.memory / max);

  const nameCell = (r: Row) => {
    // Leave room for the tree's indent and expand icon, so a deep row doesn't wrap.
    const room = `calc(100% - ${r.level * 14 + 30}px)`;
    if (r.kind === "group") {
      const mine = r.g.by_claude ? r.g.procs : r.g.procs.filter((p) => !byClaude(p));
      const nJobs = jobs.find((j) => sameRoot(r.g.root, j.root))?.jobs.length ?? 0;
      return (
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 1, verticalAlign: "middle", maxWidth: room, minWidth: 0 }}>
          <Flex gap={10} align="baseline" wrap style={{ rowGap: 0 }}>
            <Typography.Text strong>{r.g.name}</Typography.Text>
            <Mono type="secondary" style={{ fontSize: 12 }}>{r.g.by_claude ? serversOf(mine) : chainOf(mine)}</Mono>
            {nJobs ? (
              <Tag icon={<FieldTimeOutlined aria-hidden />} role="button" tabIndex={0} title={t("processes.jobsHint")}
                onClick={() => showJobs(r.g.root!)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && showJobs(r.g.root!)}
                style={{ cursor: "pointer", marginInlineEnd: 0, alignSelf: "center" }}>
                {t("processes.jobs", { count: nJobs })}
              </Tag>
            ) : null}
          </Flex>
          {r.g.root ? <Mono type="secondary" ellipsis style={{ fontSize: 12 }}>{shortPath(r.g.root)}</Mono> : <Typography.Text type="secondary" italic style={{ fontSize: 12 }}>{t("processes.unknownFolder")}</Typography.Text>}
        </span>
      );
    }
    if (r.kind === "mcp") {
      return <Typography.Text type="secondary" ellipsis style={{ maxWidth: room, verticalAlign: "middle" }}>{t("processes.mcpRow", { count: r.count })}</Typography.Text>;
    }
    const p = r.p;
    return (
      <span title={p.cmd + (p.cwd ? `\n\nin ${p.cwd}` : "")} style={{ display: "inline-flex", gap: 6, alignItems: "center", maxWidth: room, verticalAlign: "middle", minWidth: 0 }}>
        <Tag style={{ marginInlineEnd: 0 }}>{p.runtime}</Tag>
        {p.tool ? <Typography.Text strong style={{ whiteSpace: "nowrap" }}>{p.tool}</Typography.Text> : null}
        {p.claude ? <Tag color="warning" style={{ marginInlineEnd: 0 }}>{t("processes.claudeCode")}</Tag> : null}
        {p.task
          ? <Tooltip title={t("processes.byTask", { name: p.task })}><Tag icon={<FieldTimeOutlined aria-hidden />} style={{ marginInlineEnd: 0 }}>{p.task}</Tag></Tooltip>
          : null}
        <Mono type="secondary" ellipsis style={{ minWidth: 0 }}>{p.cmd}</Mono>
      </span>
    );
  };

  // Ports only when something here listens on one: an empty column is noise.
  const anyPorts = groups.some((g) => g.ports.length || g.procs.some((p) => p.ports.length));
  const columns: TableColumnsType<Row> = [
    { title: t("processes.name"), key: "name", onCell: () => ({ style: { whiteSpace: "nowrap", overflow: "hidden" } }), render: (_, r) => nameCell(r) },
    ...(anyPorts ? [{
      title: t("processes.ports"), key: "ports", width: 92,
      render: (_: unknown, r: Row) => {
        const ports = r.kind === "group" ? r.g.ports : r.kind === "proc" ? r.p.ports : [];
        return <Flex gap={4} wrap>{ports.map((x) => <PortTag key={x} port={x} />)}</Flex>;
      },
    }] : []),
    ...(narrow ? [] : [
      {
        title: t("processes.memory"), key: "mem", width: 112, align: "right" as const,
        render: (_: unknown, r: Row) => {
          if (r.kind === "mcp") return null;
          if (r.kind === "proc") return <Typography.Text type="secondary" className="dd-num" style={{ fontSize: 13 }}>{mb(r.p.memory)}</Typography.Text>;
          return <MemCell bytes={r.g.memory} share={share(r.g)} dormant={isForgotten(r.g, sessions)} gain={gains[groupKey(r.g)]} />;
        },
      },
      {
        // The CPU over time, never the instant figure: what keeps working while nobody looks.
        title: t("sessions.cpu24"), key: "cpu", width: 126,
        render: (_: unknown, r: Row) => (r.kind === "group"
          ? <Sparkline values={history[r.g.root ?? r.g.name]} dormant={isForgotten(r.g, sessions)} width={104} height={24} />
          : null),
      },
      ...(compact ? [] : [{
        title: t("processes.uptime"), key: "up", width: 104, align: "right" as const,
        render: (_: unknown, r: Row) => (r.kind === "mcp" ? null : <Typography.Text type="secondary" className="dd-num" style={{ fontSize: 13 }}>{since(r.kind === "group" ? r.g.run_time : r.p.run_time)}</Typography.Text>),
      }]),
    ]),
    {
      title: <span className="sr-only">{t("common.actions")}</span>, key: "acts", width: narrow ? 76 : 104, align: "right",
      render: (_, r) => {
        if (r.kind === "mcp") return null;
        if (r.kind === "group") {
          const g = r.g;
          if (r.leaving) return null;
          const mine = g.by_claude ? g.procs : g.procs.filter((p) => !byClaude(p));
          return (
            <Flex justify="flex-end" align="center">
              <span className="dd-quiet" style={{ display: "inline-flex" }}>
                {g.root ? <IconButton title={t("common.openFolder")} icon={FolderOpenOutlined} onClick={() => openFolder(g.root!, false)} /> : null}
                {g.root && !narrow ? <IconButton title={t("common.openInEditor")} icon={CodeOutlined} onClick={() => openFolder(g.root!, true)} /> : null}
              </span>
              <IconButton danger icon={PoweroffOutlined}
                title={g.by_claude ? t("processes.stopMcp") : t("processes.stopProject")}
                // Claude Code's MCP servers are kept aside: stopping them takes tools away from an open session.
                onClick={() => stop(g.by_claude ? t("processes.stopMcpTitle", { name: g.name }) : t("processes.stopProjectTitle", { name: g.name }), mine, freedIn(groupKey(g)))} />
            </Flex>
          );
        }
        const p = r.p;
        return (
          <Flex justify="flex-end" className="dd-quiet">
            {/* Restarting an MCP server outside Claude is pointless: Claude relaunches it itself. */}
            {p.depth === 0 && p.cwd && !byClaude(p)
              ? <IconButton title={t("processes.restartProc")} icon={ReloadOutlined} onClick={() => restart(r.g, p)} />
              : null}
            <IconButton danger title={t("processes.stopProc", { pid: p.pid })} icon={CloseOutlined} onClick={() => stop(t("processes.stopProcTitle", { pid: p.pid }), [p], freedIn(groupKey(r.g)))} />
          </Flex>
        );
      },
    },
  ];

  return (
    <Table<Row> size="small" pagination={false} className="dd-panel" columns={columns} dataSource={data} tableLayout="fixed"
      rowClassName={(r) => (r.kind === "group" && r.leaving ? "dd-row-leaving" : "")}
      expandable={{
        expandedRowKeys: expanded,
        indentSize: 14,
        onExpand: (open, r) => {
          const keys = r.kind === "group" ? openKeys(r) : [r.key];
          setExpanded((cur) => (open ? [...new Set([...cur, ...keys])] : cur.filter((k) => !keys.includes(k))));
        },
      }} />
  );
}

export function ProcessesPage({ narrow, compact, showJobs }: { narrow: boolean; compact: boolean; showJobs: (root: string) => void }) {
  const { t } = useTranslation();
  const deck = useDeck();
  const f = deck.filter;
  const visible = deck.groups.filter((g) =>
    matches(f, [g.name, g.root, g.ports.join(" "), ...g.procs.map((p) => `${p.cmd} ${p.tool ?? ""} ${p.pid}`)]));
  const mine = visible.filter((g) => !g.by_claude);
  const claude = visible.filter((g) => g.by_claude);
  const nClaude = claude.reduce((s, g) => s + g.procs.length, 0);
  const max = Math.max(1, ...deck.groups.map((g) => g.memory));
  const weigh = { max, sessions: deck.sessions, history: deck.history };

  if (deck.loaded && !visible.length) {
    return <Nothing text={f ? t("processes.noMatch") : t("processes.none")} />;
  }
  return (
    <Flex vertical gap={28}>

      {mine.length ? <ProcessTable groups={mine} narrow={narrow} compact={compact} jobs={deck.jobs} showJobs={showJobs} {...weigh} /> : null}
      {claude.length ? (
        <section aria-labelledby="claude-title">
          <Flex id="claude-title" align="baseline" gap={10} style={{ marginBottom: 6 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>{t("processes.launchedByClaude")}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("processes.launchedCount", { servers: t("count.mcpServer", { count: nClaude }), folders: t("count.folder", { count: claude.length }) })}
            </Typography.Text>
          </Flex>
          <ProcessTable groups={claude} narrow={narrow} compact={compact} jobs={deck.jobs} showJobs={showJobs} {...weigh} />
        </section>
      ) : null}
    </Flex>
  );
}
