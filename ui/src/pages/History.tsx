/**
 * Every Claude Code session a person opened, open or closed, most recent first and by day:
 * found by what it was about (its description, title, prompts, project) instead of its id,
 * and reopened with a click (a terminal in its folder with `claude --resume <id>`).
 * The automated ones (`claude -p`, the SDK) are not here.
 *
 * A row is one line, read like an inbox: the project, what it was about, when. A click opens
 * the rest in place: what is left, the person's last words, branch, origin and dates,
 * Describe. Reopen shows under the pointer, and always on an open row.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Flex, Select, Tooltip, Typography, theme } from "antd";
import { CheckOutlined, CodeOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { api } from "../api";
import { Mono, Nothing } from "../components/bits";
import { agoSec, capital, matches, splitDescription } from "../format";
import { intlTag } from "../i18n";
import { useDeck } from "../store";
import { useLook } from "../theme";
import { inkOf } from "../palette";
import type { Past, PastRow } from "../types";

const KIND_KEY = { terminal: "sessions.kindTerminal", vscode: "sessions.kindVscode" } as const;
/** The reading column: past this a line of prose is too long to follow. */
export const HISTORY_WIDTH = 1080;

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
  const { dark } = useLook();
  const k = inkOf(dark);
  const deck = useDeck();
  const [project, setProject] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
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

  const toggle = (id: string) => setExpanded((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

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
    return capital(new Intl.DateTimeFormat(intlTag(), { weekday: "long", day: "numeric", month: "long" }).format(new Date(y, m - 1, d)));
  };
  const days: [string, PastRow[]][] = [];
  for (const r of rows) {
    const day = dayOf(r.past.ended);
    if (days[days.length - 1]?.[0] === day) days[days.length - 1][1].push(r);
    else days.push([day, [r]]);
  }
  const clock = new Intl.DateTimeFormat(intlTag(), { hour: "2-digit", minute: "2-digit" });
  const longDate = new Intl.DateTimeFormat(intlTag(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  // dot · project · what it was about · time, then the action column (Reopen), fixed so it never moves.
  const line: CSSProperties = narrow
    ? { gridTemplateColumns: "8px minmax(0,1fr) auto", columnGap: 10, rowGap: 2 }
    : { gridTemplateColumns: "8px 168px minmax(0,1fr) 72px", columnGap: 16 };
  const inset = narrow ? 8 : 12;
  /** Where the details start: under "what it was about". */
  const indent = narrow ? 18 : 8 + 16 + 168 + 16;

  if (!deck.past.length) return <Nothing text={t("history.none")} />;
  return (
    <div style={{ maxWidth: HISTORY_WIDTH, marginInline: "auto" }}>
      <Flex align="center" gap={12} wrap style={{ marginBottom: 6 }}>
        <Select allowClear showSearch value={project} onChange={(v) => setProject(v ?? null)} placeholder={t("history.allProjects")}
          variant="filled" aria-label={t("history.project")} options={projects.map((p) => ({ value: p, label: p }))} style={{ width: narrow ? "100%" : 220 }} />
        {project || deck.filter ? <Typography.Text type="secondary" style={{ fontSize: 13 }}>{t("count.session", { count: rows.length })}</Typography.Text> : null}
      </Flex>
      {!rows.length ? <Nothing text={t("history.noMatch")} style={{ marginTop: 32 }} /> : null}
      {days.map(([day, list]) => (
        <section key={day} aria-label={dayLabel(day)} style={{ marginInline: -inset }}>
          <div className="dd-day" style={{ paddingInline: inset }}>
            <Typography.Text strong style={{ fontSize: 13 }}>{dayLabel(day)}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("count.session", { count: list.length })}</Typography.Text>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {list.map(({ past: p, description: d, description_fresh: fresh }) => {
              const id = p.session_id;
              const isOpen = open.has(id);
              const unfolded = expanded.includes(id);
              const start = startedSec(p);
              const done = opened.includes(id);
              const said = !!(d || p.title || p.first_prompt || p.last_prompt);
              const [state, next] = d ? splitDescription(d.text) : [p.title ?? p.first_prompt ?? t("history.empty"), null];
              const time = isOpen && Date.now() / 1000 - p.ended < 3600 ? agoSec(p.ended) : clock.format(new Date(p.ended * 1000));
              const meta: ReactNode[] = [
                p.branch ? <Mono key="b" style={{ fontSize: 12 }}>{p.branch}</Mono> : null,
                <span key="k">{t(KIND_KEY[p.kind])}</span>,
                start ? <span key="s">{t("history.started", { when: longDate.format(new Date(start * 1000)) })}</span> : null,
                <span key="e">{t("history.lastActive", { when: longDate.format(new Date(p.ended * 1000)) })}</span>,
              ].filter(Boolean);
              return (
                <li key={id} className={`dd-past dd-row${unfolded ? " dd-unfolded" : ""}`}
                  style={{ borderBottom: `1px solid ${token.colorBorderSecondary}`, background: unfolded ? token.colorFillTertiary : undefined }}>
                  <div style={{ display: "grid", gridTemplateColumns: `minmax(0,1fr) ${narrow ? "auto" : "92px"}`, alignItems: "center", columnGap: 12, padding: `11px ${inset}px` }}>
                    <button type="button" className="dd-bare" aria-expanded={unfolded} onClick={() => toggle(id)} style={line}>
                      <span aria-label={isOpen ? t("history.open") : undefined} role={isOpen ? "img" : undefined}
                        style={{ width: 7, height: 7, borderRadius: "50%", background: isOpen ? k.greenFill : "transparent", alignSelf: "center" }} />
                      <Typography.Text strong ellipsis style={{ minWidth: 0 }}>{p.project ?? "?"}</Typography.Text>
                      {narrow ? <Typography.Text type="secondary" className="dd-num" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{time}</Typography.Text> : null}
                      <Typography.Text ellipsis={!unfolded} type={said ? undefined : "secondary"}
                        style={{ minWidth: 0, gridColumn: narrow ? "2 / 4" : undefined, color: said ? (unfolded ? token.colorText : token.colorTextSecondary) : undefined, fontStyle: said ? undefined : "italic" }}>
                        {state}
                      </Typography.Text>
                      {narrow ? null : <Typography.Text type="secondary" className="dd-num" style={{ fontSize: 13, textAlign: "right", whiteSpace: "nowrap" }}>{time}</Typography.Text>}
                    </button>
                    <span style={{ display: "inline-flex", justifyContent: "flex-end" }}>
                      {isOpen ? null : (
                        <Tooltip title={t("history.resumeHint")}>
                          <Button size="small" loading={opening.includes(id)} onClick={() => reopen(id)}
                            className={unfolded || done || opening.includes(id) ? undefined : "dd-quiet"}
                            icon={done ? <CheckOutlined aria-hidden /> : <CodeOutlined aria-hidden />}
                            aria-label={`${done ? t("history.resumed") : t("history.resume")} ${p.project ?? ""}`.trim()}
                            style={done ? { color: token.colorSuccess, borderColor: token.colorSuccess } : undefined}>
                            {narrow && !done ? null : done ? t("history.resumed") : t("history.resume")}
                          </Button>
                        </Tooltip>
                      )}
                    </span>
                  </div>
                  {unfolded ? (
                    <Flex vertical gap={10} style={{ padding: `2px ${inset}px 16px ${inset + indent}px`, maxWidth: 760 + inset + indent }}>
                      {/* The line above now shows in full; what is left gets its own line. */}
                      {next ? <Typography.Paragraph type={fresh ? undefined : "secondary"} style={{ margin: 0, fontWeight: 500 }}>{next}</Typography.Paragraph> : null}
                      {p.last_prompt ? (
                        <Typography.Paragraph type="secondary" ellipsis={{ rows: 3, expandable: true, symbol: t("history.more") }}
                          style={{ margin: 0, fontSize: 13, paddingInlineStart: 10, borderInlineStart: `2px solid ${token.colorBorder}` }}>
                          {p.last_prompt}
                        </Typography.Paragraph>
                      ) : null}
                      <Flex gap={16} wrap style={{ fontSize: 12.5, color: token.colorTextTertiary, rowGap: 2 }}>{meta}</Flex>
                      {on && said ? (
                        <div>
                          <Button size="small" type="text" icon={<ThunderboltOutlined aria-hidden />} loading={describing.includes(id)}
                            onClick={() => describeNow(id)} style={{ marginInlineStart: -7 }}>{d ? t("history.redescribe") : t("sessions.describe")}</Button>
                        </div>
                      ) : null}
                    </Flex>
                  ) : null}
                  {failed[id] ? (
                    <Typography.Text type="danger" role="alert" style={{ display: "block", padding: `0 ${inset}px 12px ${inset + indent}px`, fontSize: 13 }}>{failed[id]}</Typography.Text>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
