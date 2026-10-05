/**
 * The scheduled tasks that run something in a project, as a tree table: project →
 * its tasks. Run now, disable or enable, open the script, delete (a copy of the
 * definition is kept). Everything that changes a task asks first, except enabling.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { App, Badge, Flex, Table, Tag, Tooltip, Typography, theme, type TableColumnsType } from "antd";
import { CaretRightOutlined, CodeOutlined, DeleteOutlined, FolderOpenOutlined, PauseCircleOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { api } from "../api";
import { IconButton, Mono, Nothing, shortPath } from "../components/bits";
import { useActions } from "../components/actions";
import { matches, outcome, schedule, when } from "../format";
import { useDeck } from "../store";
import type { Job, JobGroup } from "../types";

type Row =
  | { key: string; kind: "group"; g: JobGroup; children: Row[] }
  | { key: string; kind: "job"; g: JobGroup; j: Job };

const groupKey = (g: JobGroup) => `g:${g.root}`;

function useJobActions() {
  const { modal, message } = App.useApp();
  const { t } = useTranslation();
  const deck = useDeck();
  const reload = (ms = 0) => setTimeout(() => deck.loadJobs(), ms);

  const act = async (j: Job, what: "run" | "enable" | "disable") => {
    try {
      await api.jobAct(j.path, what);
      if (what === "run") message.success(t("jobs.started", { name: j.name }));
    } catch (e) {
      message.error(t("jobs.failed", { error: String(e) }));
    }
    // A task just started takes a moment to show as running.
    reload(what === "run" ? 1500 : 0);
  };

  const lines = (j: Job) => (
    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
      <li><Mono>{j.cmd}</Mono></li>
      {j.workdir ? <li>{t("actions.in", { path: j.workdir })}</li> : null}
    </ul>
  );

  const run = (j: Job) =>
    modal.confirm({
      title: t("jobs.runTitle", { name: j.name }),
      content: lines(j),
      okText: t("jobs.run"),
      cancelText: t("common.cancel"),
      onOk: () => act(j, "run"),
    });

  const toggle = (j: Job) =>
    j.enabled
      ? modal.confirm({
          title: t("jobs.disableTitle", { name: j.name }),
          content: t("jobs.disableText"),
          okText: t("jobs.disable"),
          cancelText: t("common.cancel"),
          onOk: () => act(j, "disable"),
        })
      : act(j, "enable");

  const remove = (j: Job) =>
    modal.confirm({
      title: t("jobs.deleteTitle", { name: j.name }),
      content: <Flex vertical gap={8}>{lines(j)}<Typography.Text type="secondary">{t("jobs.deleteText")}</Typography.Text></Flex>,
      okText: t("jobs.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          const file = await api.jobDelete(j.path);
          message.success(t("jobs.deleted", { file }), 6);
        } catch (e) {
          message.error(t("jobs.failed", { error: String(e) }));
        }
        reload();
      },
    });

  return { run, toggle, remove };
}

export function JobsPage({ narrow }: { narrow: boolean }) {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const deck = useDeck();
  const { openFolder } = useActions();
  const { run, toggle, remove } = useJobActions();
  // Projects start open: what is closed is remembered, not what is open.
  const [closed, setClosed] = useState<string[]>([]);

  const f = deck.filter;
  const groups = deck.jobs
    .map((g) => ({ ...g, jobs: g.jobs.filter((j) => matches(f, [g.name, g.root, j.name, j.cmd, j.script, j.description, j.runtime])) }))
    .filter((g) => g.jobs.length);
  const data: Row[] = groups.map((g) => ({
    key: groupKey(g), kind: "group", g,
    children: g.jobs.map((j) => ({ key: `j:${j.path}`, kind: "job", g, j })),
  }));

  if (deck.jobsLoaded && !groups.length) {
    return <Nothing text={f && deck.jobs.length ? t("jobs.noMatch") : t("jobs.none")} />;
  }

  const nameCell = (r: Row) => {
    if (r.kind === "group") {
      return (
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 1, verticalAlign: "middle", maxWidth: "calc(100% - 30px)", minWidth: 0 }}>
          <Flex gap={10} align="baseline" wrap style={{ rowGap: 0 }}>
            <Typography.Text strong>{r.g.name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("count.task", { count: r.g.jobs.length })}</Typography.Text>
          </Flex>
          <Mono type="secondary" ellipsis style={{ fontSize: 12 }}>{shortPath(r.g.root)}</Mono>
        </span>
      );
    }
    const j = r.j;
    const tip = [j.cmd, j.workdir ? t("actions.in", { path: j.workdir }) : "", j.description ?? "", j.folder !== "\\" ? `${t("jobs.schedulerFolder")}: ${j.folder}` : ""]
      .filter(Boolean).join("\n\n");
    return (
      <span title={tip} style={{ display: "inline-flex", flexDirection: "column", gap: 2, verticalAlign: "middle", maxWidth: "calc(100% - 44px)", minWidth: 0 }}>
        <Flex gap={8} align="center" wrap>
          <Typography.Text strong>{j.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{j.runtime}</Typography.Text>
          {!j.enabled ? <Tag style={{ marginInlineEnd: 0 }}>{t("jobs.disabled")}</Tag> : null}
          {j.missing
            ? <Tooltip title={j.missing}><Tag color="error" style={{ marginInlineEnd: 0 }}>{t(j.missing === j.workdir ? "jobs.missingFolder" : "jobs.missingScript")}</Tag></Tooltip>
            : null}
        </Flex>
        <Mono type="secondary" ellipsis style={{ minWidth: 0, fontSize: 12 }}>{shortPath(j.script ?? j.cmd)}</Mono>
        {narrow ? whenCell(j) : null}
        {narrow ? lastCell(j) : null}
      </span>
    );
  };

  const whenCell = (j: Job) => (
    <Flex vertical gap={0} style={{ minWidth: 0 }}>
      <Typography.Text type={narrow ? "secondary" : undefined} style={narrow ? { fontSize: token.fontSizeSM } : undefined}>{schedule(j)}</Typography.Text>
      {j.enabled && j.next_run
        ? <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>{t("jobs.nextAt", { when: when(j.next_run) })}</Typography.Text>
        : null}
    </Flex>
  );

  const lastCell = (j: Job) => {
    const o = outcome(j);
    return (
      <Flex vertical gap={0} style={{ minWidth: 0 }}>
        <Badge status={o.status} text={<Typography.Text style={{ fontSize: token.fontSizeSM }}>{o.text}</Typography.Text>} />
        {j.last_run && !(j.running || j.result === "running")
          ? <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, paddingInlineStart: 14 }}>{when(j.last_run)}</Typography.Text>
          : null}
      </Flex>
    );
  };

  const columns: TableColumnsType<Row> = [
    { title: t("jobs.task"), key: "name", onCell: () => ({ style: { overflow: "hidden" } }), render: (_, r) => nameCell(r) },
    ...(narrow ? [] : [
      { title: t("jobs.when"), key: "when", width: 190, render: (_: unknown, r: Row) => (r.kind === "job" ? whenCell(r.j) : null) },
      { title: t("jobs.last"), key: "last", width: 210, render: (_: unknown, r: Row) => (r.kind === "job" ? lastCell(r.j) : null) },
    ]),
    {
      title: <span className="sr-only">{t("common.actions")}</span>, key: "acts", width: narrow ? 84 : 132, align: "right",
      render: (_, r) => {
        if (r.kind === "group") {
          return <Flex justify="flex-end" className="dd-quiet"><IconButton title={t("common.openFolder")} icon={FolderOpenOutlined} onClick={() => openFolder(r.g.root, false)} /></Flex>;
        }
        const j = r.j;
        return (
          <Flex justify="flex-end" className="dd-quiet">
            {j.enabled && !j.missing ? <IconButton title={t("jobs.run")} icon={CaretRightOutlined} onClick={() => run(j)} /> : null}
            <IconButton title={j.enabled ? t("jobs.disable") : t("jobs.enable")} icon={j.enabled ? PauseCircleOutlined : PlayCircleOutlined} onClick={() => toggle(j)} />
            {j.script && !j.missing && !narrow ? <IconButton title={t("jobs.openScript")} icon={CodeOutlined} onClick={() => openFolder(j.script!, true)} /> : null}
            <IconButton danger title={t("jobs.delete")} icon={DeleteOutlined} onClick={() => remove(j)} />
          </Flex>
        );
      },
    },
  ];

  return (
    <Table<Row> size="small" pagination={false} className="dd-panel" columns={columns} dataSource={data} tableLayout="fixed"
      rowClassName={(r) => (r.kind === "group" ? "dd-group-row" : "")}
      locale
={{ emptyText: <Nothing text={t("jobs.none")} /> }}
      expandable={{
        indentSize: 14,
        expandedRowKeys: data.map((r) => r.key).filter((k) => !closed.includes(k)),
        onExpand: (open, r) => setClosed((cur) => (open ? cur.filter((k) => k !== r.key) : [...cur, r.key])),
      }} />
  );
}
