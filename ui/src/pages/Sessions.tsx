/**
 * The open Claude Code sessions, with their weight: a bar behind each row as long as the
 * memory it holds (with what runs under it), the CPU of the last 24 hours, and "Close"
 * for the whole session. Sessions never enter cleanup: they close only when asked.
 * Descriptions are opt-in (claude -p costs tokens).
 */
import { useState, type CSSProperties } from "react";
import { Trans, useTranslation } from "react-i18next";
import { App, Button, Descriptions, Empty, Flex, Switch, Tag, Tooltip, Typography, theme } from "antd";
import { FolderOpenOutlined, MinusOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { api } from "../api";
import { IconButton, Mono } from "../components/bits";
import { useActions } from "../components/actions";
import { GainFigure, MemFigure, Sparkline, WeightBar, isDormant, useLeaving, useWeight } from "../components/weight";
import { agoSec, matches, mb, since } from "../format";
import { useDeck } from "../store";
import type { Session, SessionRow } from "../types";

const KIND_KEY = { terminal: "sessions.kindTerminal", vscode: "sessions.kindVscode", background: "sessions.kindBackground" } as const;
const MATCH_KEY = { id: "sessions.matchId", time: "sessions.matchTime", uncertain: "sessions.matchUncertain", none: "sessions.matchNone" } as const;

function statusOf(last: number | null): { color: "success" | "warning" | "default"; key: string } {
  if (!last) return { color: "default", key: "sessions.statusNone" };
  const age = Date.now() / 1000 - last;
  if (age < 300) return { color: "success", key: "sessions.statusNow" };
  if (age < 3600) return { color: "warning", key: "sessions.statusHour" };
  return { color: "default", key: "sessions.statusIdle" };
}

const weightOf = (s: Session) => s.memory + s.children_memory;

function DescribeSwitch() {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const deck = useDeck();
  const { enabled, forced } = deck.describe;
  const toggle = async (on: boolean) => {
    try { await api.setDescribe(on); } catch (e) { message.error(t("sessions.saveFailed", { error: String(e) })); }
    await deck.loadDescribe();
  };
  return (
    <Flex gap={8} align="center" wrap style={{ fontSize: 12 }}>
      <Tooltip title={forced ? t("sessions.switchForced") : undefined}>
        <Switch id="describe-switch" size="small" checked={enabled} disabled={forced} onChange={toggle} />
      </Tooltip>
      <label htmlFor="describe-switch" style={{ fontWeight: 500 }}>{t("sessions.switch")}</label>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        <Trans i18nKey="sessions.switchHint" components={{ code: <Mono>{""}</Mono> }} />
      </Typography.Text>
    </Flex>
  );
}

/** `compact`: a mid-size window; the last activity joins the name and "Describe" keeps only its icon. */
export function SessionsPage({ narrow, compact }: { narrow: boolean; compact: boolean }) {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();
  const deck = useDeck();
  const { c } = useWeight();
  const { openFolder } = useActions();
  const [describing, setDescribing] = useState<number[]>([]);
  const [closing, setClosing] = useState<number[]>([]);
  const [open, setOpen] = useState<number[]>([]);
  /** What each closing gave back, measured: the row shows it before folding. */
  const [gains, setGains] = useState<Record<number, number>>({});
  const on = deck.describe.enabled;
  const kind = (s: Session) => t(KIND_KEY[s.kind]);

  const describeNow = async (pid: number) => {
    setDescribing((d) => [...d, pid]);
    try { await api.describeSession(pid); } catch (e) { message.error(t("sessions.describeFailed", { error: String(e) })); }
    setDescribing((d) => d.filter((x) => x !== pid));
    await deck.loadSessions();
  };

  // The row stays, dimmed, until the RAM is measured (2 s). Then, at once: the row shows what came back
  // while its bar drains, the strip gives the memory back, the free figure counts up; then the row folds.
  const closeNow = async (s: Session) => {
    setClosing((x) => [...x, s.pid]);
    let ok = true;
    let error: string | undefined;
    try {
      const f = await api.closeSession(s.pid);
      setGains((g) => ({ ...g, [s.pid]: Math.max(0, f.after - f.before) }));
      deck.applyFreed(f, [s.pid]);
      // Its description where it got to, for the History (only with descriptions on: claude -p costs).
      if (on && s.session_id) api.describePast(s.session_id, false).then(() => deck.loadSessions(), () => {});
    } catch (e) {
      ok = false;
      error = String(e);
      message.error(t("sessions.closeFailed", { error }));
    }
    await api.shadowAppend({ type: "action", at: new Date().toISOString(), source: "panel", action: "kill", pids: [s.pid], reason: "session: close", ok, error }).catch(() => {});
    setClosing((x) => x.filter((p) => p !== s.pid));
    deck.loadSessions();
    deck.refresh();
  };

  const askClose = (s: Session) =>
    modal.confirm({
      title: t("sessions.closeTitle", { project: s.project ?? "?" }),
      content: (
        <Flex vertical gap={8}>
          <span>{t("sessions.closeWhat", { pid: s.pid, processes: t("count.process", { count: s.children + 1 }), memory: mb(weightOf(s)) })}</span>
          <Typography.Text type="secondary"><Trans i18nKey="sessions.closeResume" components={{ code: <Mono>{""}</Mono> }} /></Typography.Text>
        </Flex>
      ),
      okText: t("sessions.close"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: () => { closeNow(s); },
    });

  const rows = deck.sessions.filter(({ session: s, description: d }) =>
    matches(deck.filter, [s.project, s.title, s.cwd, s.last_prompt, kind(s), d?.text]));
  const shown = useLeaving(rows, (r) => String(r.session.pid), 2000);
  // The scale is the heaviest open session, filtered or not: a filter doesn't change the weights.
  const max = Math.max(1, ...deck.sessions.map((r) => weightOf(r.session)));

  // Fixed, so the header lines up with the rows: Describe (when on), Close, the folder.
  const actions = on ? (compact ? 136 : 200) : 104;
  const cols = narrow ? "28px minmax(0,1fr) auto"
    : compact ? `28px minmax(0,1fr) 128px 120px ${actions}px`
    : `28px minmax(0,1fr) 128px 120px 112px ${actions}px`;
  const agoInName = narrow || compact;
  const grid: CSSProperties = { display: "grid", gridTemplateColumns: cols, alignItems: "center", columnGap: narrow ? 12 : 20 };
  const head: CSSProperties = { fontSize: 12, fontWeight: 500, color: token.colorTextTertiary };

  return (
    <Flex vertical gap={12}>
      <DescribeSwitch />
      {deck.sessions.length && !rows.length ? <Empty description={t("sessions.noMatch")} /> : null}
      {!deck.sessions.length && !shown.length ? <Empty description={t("sessions.none")} /> : null}
      {shown.length ? (
        <section aria-label={t("nav.sessions")}
          style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, overflow: "hidden" }}>
          {narrow ? null : (
            <div aria-hidden="true" style={{ ...grid, ...head, padding: "10px 16px" }}>
              <span /><span>{t("sessions.session")}</span><span style={{ textAlign: "right" }}>{t("sessions.memory")}</span>
              <span>{t("sessions.cpu24")}</span>{compact ? null : <span>{t("sessions.active")}</span>}<span />
            </div>
          )}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map(({ item: { session: s, description: d, description_fresh: fresh }, leaving }) => {
              const dormant = isDormant(s.last_activity, s.run_time);
              const share = weightOf(s) / max;
              const expanded = open.includes(s.pid);
              const st = statusOf(s.last_activity);
              const gain = leaving ? gains[s.pid] : undefined;
              const gained = gain != null;
              const busy = closing.includes(s.pid) && !gained;
              const dot = dormant ? c.dormant : st.color === "success" ? token.colorSuccess : st.color === "warning" ? token.colorWarning : token.colorTextQuaternary;
              return (
                <li key={s.pid} className={`dd-fold dd-session${leaving ? " gone" : ""}${gained ? " late" : ""}`} style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                  <div>
                    <div style={{ ...grid, position: "relative", zIndex: 0, padding: "12px 16px", opacity: busy ? 0.55 : 1, transition: "opacity .2s" }}>
                      <WeightBar share={share} dormant={dormant} drain={gained} />
                      <Button type="text" size="small" aria-expanded={expanded} aria-label={t("sessions.details")} className="dd-expand"
                        icon={expanded ? <MinusOutlined aria-hidden /> : <PlusOutlined aria-hidden />}
                        onClick={() => setOpen((o) => (expanded ? o.filter((p) => p !== s.pid) : [...o, s.pid]))} style={{ position: "relative" }} />
                      <Flex vertical gap={3} style={{ minWidth: 0, position: "relative" }}>
                        <Flex gap={8} align="center" wrap>
                          <span role="img" aria-label={t(st.key)} title={t(st.key)} style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flex: "none" }} />
                          <Typography.Text strong style={{ color: dormant ? token.colorTextSecondary : undefined }}>{s.project ?? "?"}</Typography.Text>
                          <Tag style={{ marginInlineEnd: 0 }}>{kind(s)}</Tag>
                          {s.match === "uncertain"
                            ? <Tooltip title={t("sessions.uncertainHint")}><Tag color="warning" style={{ marginInlineEnd: 0 }}>{t("sessions.uncertain")}</Tag></Tooltip>
                            : null}
                          {agoInName && s.last_activity
                            ? <Typography.Text style={{ fontSize: 12, color: dormant ? c.dormantText : token.colorTextSecondary }}>{agoSec(s.last_activity)}</Typography.Text>
                            : null}
                        </Flex>
                        {d
                          ? <Typography.Text type={fresh && !dormant ? undefined : "secondary"} ellipsis={{ tooltip: d.text }} style={{ maxWidth: "100%" }}>{d.text}</Typography.Text>
                          : <Typography.Text type="secondary" italic>
                              {!s.transcript ? t("sessions.nothingWritten") : on ? t("sessions.noDescription") : t("sessions.descriptionsOff")}
                            </Typography.Text>}
                        {narrow && gained ? <GainFigure bytes={gain} /> : narrow ? (
                          <Flex align="baseline" gap={8}>
                            <MemFigure bytes={weightOf(s)} share={share} dormant={dormant} />
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("count.process", { count: s.children + 1 })}</Typography.Text>
                          </Flex>
                        ) : null}
                      </Flex>
                      {narrow ? null : gained ? (
                        <Flex justify="flex-end" style={{ position: "relative" }}><GainFigure bytes={gain} size={Math.max(24, 14 + 10 * share)} /></Flex>
                      ) : (
                        <Flex vertical align="flex-end" gap={2} style={{ position: "relative" }}>
                          <MemFigure bytes={weightOf(s)} share={share} dormant={dormant} />
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("count.process", { count: s.children + 1 })}</Typography.Text>
                        </Flex>
                      )}
                      {narrow ? null : <div style={{ position: "relative" }}><Sparkline values={deck.history[s.key]} dormant={dormant} /></div>}
                      {agoInName ? null : (
                        <Typography.Text style={{ position: "relative", fontSize: 13, color: dormant ? c.dormantText : token.colorTextSecondary }}>
                          {agoSec(s.last_activity)}
                        </Typography.Text>
                      )}
                      <Flex justify="flex-end" align="center" gap={4} style={{ position: "relative", visibility: gained ? "hidden" : undefined }}>
                        {on && s.transcript ? (
                          <Tooltip title={t("sessions.describeHint")}>
                            <Button size="small" type="text" icon={<ThunderboltOutlined aria-hidden />} loading={describing.includes(s.pid)}
                              aria-label={t("sessions.describe")} onClick={() => describeNow(s.pid)}>{agoInName ? null : t("sessions.describe")}</Button>
                          </Tooltip>
                        ) : null}
                        <Button size="small" loading={busy} onClick={() => askClose(s)} aria-label={`${t("sessions.close")} ${s.project ?? ""}`.trim()}
                          className={dormant ? "dd-close-idle" : undefined}
                          style={dormant ? { background: c.closeBg, borderColor: c.closeBg, color: c.closeFg } : undefined}>
                          {t("sessions.close")}
                        </Button>
                        {s.cwd ? <IconButton title={t("common.openFolder")} icon={FolderOpenOutlined} onClick={() => openFolder(s.cwd!, false)} /> : null}
                      </Flex>
                    </div>
                    {expanded ? (
                      <div style={{ padding: narrow ? "0 12px 12px" : "0 16px 14px 64px" }}>
                        <Descriptions size="small" column={narrow ? 1 : 2} items={[
                          { key: "l", label: t("sessions.lastPrompt"), span: narrow ? 1 : 2, children: s.last_prompt ?? "-" },
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
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </Flex>
  );
}
