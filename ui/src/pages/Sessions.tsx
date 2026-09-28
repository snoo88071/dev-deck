/**
 * The open Claude Code sessions. Read only: they aren't closed from here and
 * never enter cleanup. Descriptions are opt-in (claude -p costs tokens).
 */
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { App, Badge, Button, Descriptions, Empty, Flex, Switch, Table, Tag, Tooltip, Typography, theme, type TableColumnsType } from "antd";
import { FolderOpenOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { api } from "../api";
import { IconButton, Mono } from "../components/bits";
import { useActions } from "../components/actions";
import { agoSec, matches, mb, since } from "../format";
import { useDeck } from "../store";
import type { Session, SessionRow } from "../types";

const KIND_KEY = { terminal: "sessions.kindTerminal", vscode: "sessions.kindVscode", background: "sessions.kindBackground" } as const;
const MATCH_KEY = { id: "sessions.matchId", time: "sessions.matchTime", uncertain: "sessions.matchUncertain", none: "sessions.matchNone" } as const;

function statusOf(last: number | null): { status: "success" | "warning" | "default"; key: string } {
  if (!last) return { status: "default", key: "sessions.statusNone" };
  const age = Date.now() / 1000 - last;
  if (age < 300) return { status: "success", key: "sessions.statusNow" };
  if (age < 3600) return { status: "warning", key: "sessions.statusHour" };
  return { status: "default", key: "sessions.statusIdle" };
}

function DescribeSwitch() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const deck = useDeck();
  const { enabled, forced } = deck.describe;
  const toggle = async (on: boolean) => {
    try { await api.setDescribe(on); } catch (e) { message.error(t("sessions.saveFailed", { error: String(e) })); }
    await deck.loadDescribe();
  };
  return (
    <Flex vertical gap={2}>
      <Flex gap={8} align="center">
        <Tooltip title={forced ? t("sessions.switchForced") : undefined}>
          <Switch id="describe-switch" size="small" checked={enabled} disabled={forced} onChange={toggle} />
        </Tooltip>
        <label htmlFor="describe-switch" style={{ fontSize: token.fontSizeSM, fontWeight: 500 }}>{t("sessions.switch")}</label>
      </Flex>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        <Trans i18nKey="sessions.switchHint" components={{ code: <Mono>{""}</Mono> }} />
      </Typography.Text>
    </Flex>
  );
}

export function SessionsPage({ narrow }: { narrow: boolean }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const deck = useDeck();
  const { openFolder } = useActions();
  const [describing, setDescribing] = useState<number[]>([]);
  const on = deck.describe.enabled;
  const kind = (s: Session) => t(KIND_KEY[s.kind]);

  const describeNow = async (pid: number) => {
    setDescribing((d) => [...d, pid]);
    try { await api.describeSession(pid); } catch (e) { message.error(t("sessions.describeFailed", { error: String(e) })); }
    setDescribing((d) => d.filter((x) => x !== pid));
    await deck.loadSessions();
  };

  const rows = deck.sessions.filter(({ session: s, description: d }) =>
    matches(deck.filter, [s.project, s.title, s.cwd, s.last_prompt, kind(s), d?.text]));

  const columns: TableColumnsType<SessionRow> = [
    {
      title: t("sessions.session"), key: "s",
      render: (_, { session: s, description: d, description_fresh: fresh }) => {
        const st = statusOf(s.last_activity);
        return (
          <Flex vertical gap={2} style={{ minWidth: 0 }}>
            <Flex gap={8} align="center" wrap>
              <Badge status={st.status} title={t(st.key)} aria-label={t(st.key)} />
              <Typography.Text strong>{s.project ?? "?"}</Typography.Text>
              {narrow ? <Tag style={{ marginInlineEnd: 0 }}>{kind(s)}</Tag> : null}
              {s.match === "uncertain"
                ? <Tooltip title={t("sessions.uncertainHint")}><Tag color="warning" style={{ marginInlineEnd: 0 }}>{t("sessions.uncertain")}</Tag></Tooltip>
                : null}
            </Flex>
            {d
              ? <Typography.Text type={fresh ? undefined : "secondary"}>{d.text}</Typography.Text>
              : <Typography.Text type="secondary" italic>
                  {!s.transcript ? t("sessions.nothingWritten") : on ? t("sessions.noDescription") : t("sessions.descriptionsOff")}
                </Typography.Text>}
            {s.last_prompt
              ? <Typography.Text type="secondary" ellipsis={{ tooltip: s.last_prompt }} style={{ fontSize: token.fontSizeSM }}>» {s.last_prompt}</Typography.Text>
              : null}
          </Flex>
        );
      },
    },
    ...(narrow ? [] : [
      { title: t("sessions.kind"), key: "k", width: 110, render: (_: unknown, r: SessionRow) => <Tag>{kind(r.session)}</Tag> },
      { title: t("sessions.active"), key: "a", width: 130, render: (_: unknown, r: SessionRow) => <Typography.Text type="secondary">{agoSec(r.session.last_activity)}</Typography.Text> },
    ]),
    {
      title: <span className="sr-only">{t("common.actions")}</span>, key: "acts", width: on && !narrow ? 140 : on ? 76 : 48, align: "right",
      render: (_, { session: s }) => (
        <Flex justify="flex-end" gap={2}>
          {on && s.transcript ? (
            <Tooltip title={t("sessions.describeHint")}>
              <Button size="small" type="text" icon={<ThunderboltOutlined aria-hidden />} loading={describing.includes(s.pid)}
                aria-label={t("sessions.describe")} onClick={() => describeNow(s.pid)}>{narrow ? null : t("sessions.describe")}</Button>
            </Tooltip>
          ) : null}
          {s.cwd ? <IconButton title={t("common.openFolder")} icon={FolderOpenOutlined} onClick={() => openFolder(s.cwd!, false)} /> : null}
        </Flex>
      ),
    },
  ];

  return (
    <Flex vertical gap={12}>
      <DescribeSwitch />
      {deck.sessions.length && !rows.length
        ? <Empty description={t("sessions.noMatch")} />
        : (
          <Table<SessionRow> size="small" rowKey={(r) => r.session.pid} pagination={false} columns={columns} dataSource={rows} tableLayout="fixed"
            locale={{ emptyText: <Empty description={t("sessions.none")} /> }}
            expandable={{
              expandedRowRender: ({ session: s, description: d, description_fresh: fresh }) => (
                <Descriptions size="small" column={narrow ? 1 : 2} items={[
                  { key: "t", label: t("sessions.title"), children: s.title ?? "-" },
                  { key: "p", label: t("sessions.process"), children: t("sessions.processValue", { pid: s.pid, time: since(s.run_time), memory: mb(s.memory) }) },
                  { key: "f", label: t("sessions.folder"), span: narrow ? 1 : 2, children: <Mono>{s.cwd ?? "-"}</Mono> },
                  { key: "c", label: t("sessions.children"), children: s.children ? `${t("count.process", { count: s.children })} · ${mb(s.children_memory)}` : t("sessions.childrenNone") },
                  { key: "m", label: t("sessions.match"), children: t(MATCH_KEY[s.match]) },
                  { key: "s", label: t("sessions.session"), span: narrow ? 1 : 2, children: <Mono>{s.session_id ?? "-"}</Mono> },
                  {
                    key: "d", label: t("sessions.description"), span: narrow ? 1 : 2,
                    children: d ? t(fresh ? "sessions.descriptionFresh" : "sessions.descriptionOld", { ago: agoSec(d.at) }) : t("sessions.descriptionNone"),
                  },
                ]} />
              ),
            }} />
        )}
    </Flex>
  );
}
