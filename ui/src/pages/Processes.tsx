/**
 * Processes as a tree table: project → root → its children. Claude Code's MCP
 * servers sit under their own row, and groups made only of them get a table of
 * their own below ("Launched by Claude Code").
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Empty, Flex, Table, Tag, Tooltip, Typography, theme, type TableColumnsType } from "antd";
import { CloseOutlined, CodeOutlined, FieldTimeOutlined, FolderOpenOutlined, PoweroffOutlined, ReloadOutlined } from "@ant-design/icons";
import { IconButton, Mono, PortTag } from "../components/bits";
import { useActions } from "../components/actions";
import { chainOf, cpu, matches, mb, serversOf, since } from "../format";
import { useDeck } from "../store";
import type { Group, JobGroup, Proc } from "../types";

type Row =
  | { key: string; kind: "group"; g: Group; level: 0; children?: Row[] }
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

/** Every key under a row that has children: expanding a project opens its whole tree. */
function openKeys(row: Row): string[] {
  return row.children?.length ? [row.key, ...row.children.flatMap(openKeys)] : [];
}

function ProcessTable({ groups, narrow, jobs, showJobs }: { groups: Group[]; narrow: boolean; jobs: JobGroup[]; showJobs: (root: string) => void }) {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { stop, restart, openFolder } = useActions();
  const [expanded, setExpanded] = useState<string[]>([]);
  const data = groups.map(rowsOf);

  const nameCell = (r: Row) => {
    // Leave room for the tree's indent and expand icon, so a deep row doesn't wrap.
    const room = `calc(100% - ${r.level * 14 + 30}px)`;
    if (r.kind === "group") {
      const mine = r.g.by_claude ? r.g.procs : r.g.procs.filter((p) => !byClaude(p));
      const nJobs = jobs.find((j) => sameRoot(r.g.root, j.root))?.jobs.length ?? 0;
      return (
        <span style={{ display: "inline-flex", flexDirection: "column", verticalAlign: "middle", maxWidth: room, minWidth: 0 }}>
          <Flex gap={6} align="center" wrap>
            <Typography.Text strong>{r.g.name}</Typography.Text>
            <Mono type="secondary">{r.g.by_claude ? serversOf(mine) : chainOf(mine)}</Mono>
            {nJobs ? (
              <Tag icon={<FieldTimeOutlined aria-hidden />} role="button" tabIndex={0} title={t("processes.jobsHint")}
                onClick={() => showJobs(r.g.root!)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && showJobs(r.g.root!)}
                style={{ cursor: "pointer", marginInlineEnd: 0 }}>
                {t("processes.jobs", { count: nJobs })}
              </Tag>
            ) : null}
          </Flex>
          {r.g.root ? <Mono type="secondary" ellipsis style={{ fontSize: 12 }}>{r.g.root}</Mono> : <Typography.Text type="secondary" italic>{t("processes.unknownFolder")}</Typography.Text>}
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

  const columns: TableColumnsType<Row> = [
    { title: t("processes.name"), key: "name", onCell: () => ({ style: { whiteSpace: "nowrap", overflow: "hidden" } }), render: (_, r) => nameCell(r) },
    {
      title: t("processes.ports"), key: "ports", width: 92,
      render: (_, r) => {
        const ports = r.kind === "group" ? r.g.ports : r.kind === "proc" ? r.p.ports : [];
        return <Flex gap={4} wrap>{ports.map((x) => <PortTag key={x} port={x} />)}</Flex>;
      },
    },
    ...(narrow ? [] : [
      { title: t("processes.memory"), key: "mem", width: 84, align: "right" as const, render: (_: unknown, r: Row) => (r.kind === "mcp" ? null : mb(r.kind === "group" ? r.g.memory : r.p.memory)) },
      { title: t("processes.cpu"), key: "cpu", width: 60, align: "right" as const, render: (_: unknown, r: Row) => (r.kind === "proc" ? cpu(r.p.cpu) : r.kind === "group" ? cpu(r.g.cpu) : null) },
      {
        title: t("processes.uptime"), key: "up", width: 104, align: "right" as const,
        render: (_: unknown, r: Row) => (r.kind === "mcp" ? null : <Typography.Text type="secondary">{since(r.kind === "group" ? r.g.run_time : r.p.run_time)}</Typography.Text>),
      },
    ]),
    {
      title: <span className="sr-only">{t("common.actions")}</span>, key: "acts", width: narrow ? 76 : 104, align: "right",
      render: (_, r) => {
        if (r.kind === "mcp") return null;
        if (r.kind === "group") {
          const g = r.g;
          const mine = g.by_claude ? g.procs : g.procs.filter((p) => !byClaude(p));
          return (
            <Flex justify="flex-end">
              {g.root ? <IconButton title={t("common.openFolder")} icon={FolderOpenOutlined} onClick={() => openFolder(g.root!, false)} /> : null}
              {g.root && !narrow ? <IconButton title={t("common.openInEditor")} icon={CodeOutlined} onClick={() => openFolder(g.root!, true)} /> : null}
              <IconButton danger icon={PoweroffOutlined}
                title={g.by_claude ? t("processes.stopMcp") : t("processes.stopProject")}
                // Claude Code's MCP servers are kept aside: stopping them takes tools away from an open session.
                onClick={() => stop(g.by_claude ? t("processes.stopMcpTitle", { name: g.name }) : t("processes.stopProjectTitle", { name: g.name }), mine)} />
            </Flex>
          );
        }
        const p = r.p;
        return (
          <Flex justify="flex-end">
            {/* Restarting an MCP server outside Claude is pointless: Claude relaunches it itself. */}
            {p.depth === 0 && p.cwd && !byClaude(p)
              ? <IconButton title={t("processes.restartProc")} icon={ReloadOutlined} onClick={() => restart(r.g, p)} />
              : null}
            <IconButton danger title={t("processes.stopProc", { pid: p.pid })} icon={CloseOutlined} onClick={() => stop(t("processes.stopProcTitle", { pid: p.pid }), [p])} />
          </Flex>
        );
      },
    },
  ];

  return (
    <Table<Row> size="small" pagination={false} columns={columns} dataSource={data} tableLayout="fixed"
      style={{ borderRadius: token.borderRadiusLG, overflow: "hidden" }}
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

export function ProcessesPage({ narrow, showJobs }: { narrow: boolean; showJobs: (root: string) => void }) {
  const { t } = useTranslation();
  const deck = useDeck();
  const f = deck.filter;
  const visible = deck.groups.filter((g) =>
    matches(f, [g.name, g.root, g.ports.join(" "), ...g.procs.map((p) => `${p.cmd} ${p.tool ?? ""} ${p.pid}`)]));
  const mine = visible.filter((g) => !g.by_claude);
  const claude = visible.filter((g) => g.by_claude);
  const nClaude = claude.reduce((s, g) => s + g.procs.length, 0);

  if (deck.loaded && !visible.length) {
    return <Empty description={f ? t("processes.noMatch") : t("processes.none")} />;
  }
  return (
    <Flex vertical gap={20}>
      {mine.length ? <ProcessTable groups={mine} narrow={narrow} jobs={deck.jobs} showJobs={showJobs} /> : null}
      {claude.length ? (
        <section aria-labelledby="claude-title">
          <Typography.Text id="claude-title" type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase" }}>
            {t("processes.launchedByClaude", { servers: t("count.mcpServer", { count: nClaude }), folders: t("count.folder", { count: claude.length }) })}
          </Typography.Text>
          <ProcessTable groups={claude} narrow={narrow} jobs={deck.jobs} showJobs={showJobs} />
        </section>
      ) : null}
    </Flex>
  );
}
