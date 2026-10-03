/**
 * Every Claude Code session a person opened, open or closed, most recent first and by day:
 * found by what it was about (its description, title, prompts, project) instead of its id,
 * and reopened with a click (a terminal in its folder with `claude --resume <id>`).
 * The automated ones (`claude -p`, the SDK) are not here.
 */
import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Button, Empty, Flex, Select, Tag, Tooltip, Typography, theme } from "antd";
import { BranchesOutlined, CheckOutlined, CodeOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { api } from "../api";
import { Mono } from "../components/bits";
import { matches, since } from "../format";
import { intlTag } from "../i18n";
import { useDeck } from "../store";
import type { Past, PastRow } from "../types";

const KIND_KEY = { terminal: "sessions.kindTerminal", vscode: "sessions.kindVscode" } as const;

/** The local day a session was last written, as `YYYY-MM-DD`: the groups. */
function dayOf(epoch: number): string {
  const d = new Date(epoch * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startedSec(p: Past): number | null {
  const t = p.started ? Date.parse(p.started) : NaN;
  return Number.isNaN(t) ? null : t / 1000;
}

export function HistoryPage({ narrow }: { narrow: boolean }) {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const deck = useDeck();
  const [project, setProject] = useState<string | null>(null);
  const [describing, setDescribing] = useState<string[]>([]);
  const [opening, setOpening] = useState<string[]>([]);
  /** Reopened just now: the button says so for a moment, where it was pressed. */
  const [opened, setOpened] = useState<string[]>([]);
  /** Why a reopen failed, shown in its own row. */
  const [failed, setFailed] = useState<Record<string, string>>({});
  const on = deck.describe.enabled;

  const reopen = async (id: string) => {
    setOpening((x) => [...x, id]);
    setFailed((f) => { const rest = { ...f }; delete rest[id]; return rest; });
    try {
      await api.resume(id);
      setOpened((x) => [...x, id]);
      setTimeout(() => setOpened((x) => x.filter((y) => y !== id)), 3000);
    } catch (e) {
      setFailed((f) => ({ ...f, [id]: t("history.resumeFailed", { error: String(e) }) }));
    }
    setOpening((x) => x.filter((y) => y !== id));
  };

  const describeNow = async (id: string) => {
    setDescribing((d) => [...d, id]);
    try { await api.describePast(id, true); } catch (e) { setFailed((f) => ({ ...f, [id]: t("sessions.describeFailed", { error: String(e) }) })); }
    setDescribing((d) => d.filter((x) => x !== id));
    await deck.loadSessions();
  };

  const open = new Set(deck.sessions.map((r) => r.session.session_id).filter(Boolean));
  // The projects, most recently used first.
  const projects = [...new Set(deck.past.map((r) => r.past.project).filter((x): x is string => !!x))];
  const rows = deck.past.filter(({ past: p, description: d }) =>
    (!project || p.project === project)
    && matches(deck.filter, [p.project, d?.text, p.title, p.first_prompt, p.last_prompt, p.branch, p.cwd]));

  const today = dayOf(Date.now() / 1000);
  const yesterday = dayOf(Date.now() / 1000 - 86400);
  const dayLabel = (day: string) => {
    if (day === today) return t("history.today");
    if (day === yesterday) return t("history.yesterday");
    const [y, m, d] = day.split("-").map(Number);
    return new Intl.DateTimeFormat(intlTag(), { weekday: "long", day: "numeric", month: "long" }).format(new Date(y, m - 1, d));
  };
  const days: [string, PastRow[]][] = [];
  for (const r of rows) {
    const day = dayOf(r.past.ended);
    if (days[days.length - 1]?.[0] === day) days[days.length - 1][1].push(r);
    else days.push([day, [r]]);
  }
  const clock = new Intl.DateTimeFormat(intlTag(), { hour: "2-digit", minute: "2-digit" });

  const actions = narrow ? "auto" : `${on ? 200 : 112}px`;
  const grid: CSSProperties = {
    display: "grid", alignItems: "center", columnGap: narrow ? 12 : 20,
    gridTemplateColumns: narrow ? `minmax(0,1fr) ${actions}` : `minmax(0,1fr) 140px ${actions}`,
  };
  const dayHead: CSSProperties = { display: "block", margin: "0 0 8px", fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: token.colorTextSecondary };

  if (!deck.past.length) return <Empty description={t("history.none")} />;
  return (
    <Flex vertical gap={16}>
      <Select allowClear showSearch value={project} onChange={(v) => setProject(v ?? null)} placeholder={t("history.allProjects")}
        aria-label={t("history.project")} options={projects.map((p) => ({ value: p, label: p }))} style={{ width: narrow ? "100%" : 260 }} />
      {!rows.length ? <Empty description={t("history.noMatch")} /> : null}
      {days.map(([day, list]) => (
        <section key={day} aria-label={dayLabel(day)}>
          <Typography.Text style={dayHead}>{dayLabel(day)}</Typography.Text>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, overflow: "hidden" }}>
            {list.map(({ past: p, description: d, description_fresh: fresh }, i) => {
              const isOpen = open.has(p.session_id);
              const start = startedSec(p);
              const done = opened.includes(p.session_id);
              const headline = d?.text ?? p.title ?? p.first_prompt ?? t("history.untitled");
              return (
                <li key={p.session_id} className="dd-past" style={{ padding: "12px 16px", borderTop: i ? `1px solid ${token.colorBorderSecondary}` : undefined }}>
                  <div style={grid}>
                    <Flex vertical gap={3} style={{ minWidth: 0 }}>
                      <Flex gap={8} align="center" wrap>
                        <Typography.Text strong>{p.project ?? "?"}</Typography.Text>
                        <Tag style={{ marginInlineEnd: 0 }}>{t(KIND_KEY[p.kind])}</Tag>
                        {p.branch ? <Mono type="secondary" style={{ fontSize: 12 }}><BranchesOutlined aria-hidden /> {p.branch}</Mono> : null}
                        {isOpen ? <Tag color="success" style={{ marginInlineEnd: 0 }}>{t("history.open")}</Tag> : null}
                        {narrow ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{clock.format(new Date(p.ended * 1000))}</Typography.Text> : null}
                      </Flex>
                      <Typography.Text type={d && !fresh ? "secondary" : undefined} ellipsis={{ tooltip: headline }} style={{ maxWidth: "100%" }}>{headline}</Typography.Text>
                      {p.last_prompt ? (
                        <Typography.Text type="secondary" ellipsis={{ tooltip: p.last_prompt }} style={{ fontSize: token.fontSizeSM, maxWidth: "100%" }}>» {p.last_prompt}</Typography.Text>
                      ) : null}
                    </Flex>
                    {narrow ? null : (
                      <Flex vertical align="flex-end" gap={2}>
                        <Typography.Text style={{ fontVariantNumeric: "tabular-nums" }}>{clock.format(new Date(p.ended * 1000))}</Typography.Text>
                        {start && p.ended > start ? (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("history.lasted", { time: since(p.ended - start) })}</Typography.Text>
                        ) : null}
                      </Flex>
                    )}
                    <Flex justify="flex-end" align="center" gap={4}>
                      {on ? (
                        <Tooltip title={t("sessions.describeHint")}>
                          <Button size="small" type="text" icon={<ThunderboltOutlined aria-hidden />} loading={describing.includes(p.session_id)}
                            aria-label={t("sessions.describe")} onClick={() => describeNow(p.session_id)}>{narrow ? null : t("sessions.describe")}</Button>
                        </Tooltip>
                      ) : null}
                      {isOpen ? null : (
                        <Tooltip title={t("history.resumeHint")}>
                          <Button size="small" loading={opening.includes(p.session_id)} onClick={() => reopen(p.session_id)}
                            icon={done ? <CheckOutlined aria-hidden /> : <CodeOutlined aria-hidden />}
                            aria-label={`${done ? t("history.resumed") : t("history.resume")} ${p.project ?? ""}`.trim()}
                            style={done ? { color: token.colorSuccess, borderColor: token.colorSuccess } : undefined}>
                            {done ? t("history.resumed") : t("history.resume")}
                          </Button>
                        </Tooltip>
                      )}
                    </Flex>
                  </div>
                  {failed[p.session_id] ? (
                    <Typography.Text type="danger" role="alert" style={{ display: "block", marginTop: 6, fontSize: token.fontSizeSM }}>{failed[p.session_id]}</Typography.Text>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Flex>
  );
}
