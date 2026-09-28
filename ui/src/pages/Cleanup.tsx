/**
 * Cleanup, in shadow mode: proposals (from Claude Code or from "Scan now") wait
 * for your verdict in ~/.dev-deck/shadow.jsonl. Nothing closes by itself; "Close"
 * is you closing it.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, App, Button, Empty, Flex, Input, Table, Tag, Typography, theme, type TableColumnsType } from "antd";
import { CheckOutlined, PoweroffOutlined, ScanOutlined, StopOutlined } from "@ant-design/icons";
import { api } from "../api";
import { cleanup } from "../cleanup";
import { Mono } from "../components/bits";
import { agoIso, matches } from "../format";
import { useDeck } from "../store";
import type { ProposalRecord, Verdict } from "../types";

const COLORS: Record<string, string> = { "orphan-mcp": "purple", duplicate: "warning", session: "blue", idle: "default" };

const newId = () => crypto.randomUUID().slice(0, 8);
const nowIso = () => new Date().toISOString();

export function CleanupPage({ narrow }: { narrow: boolean }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { t } = useTranslation();
  const deck = useDeck();
  const label = (c: string) => t(`cleanup.category.${c}`, { defaultValue: c });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string[]>([]);
  const [folded, setFolded] = useState<string[]>([]);

  /** The proposal's process is still the same one: same pid, same command. */
  const alive = (r: ProposalRecord) => deck.groups.some((g) => g.procs.some((p) => p.pid === r.pid && p.cmd === r.cmd));

  const judge = async (r: ProposalRecord, verdict: Verdict, kill: boolean) => {
    setBusy((b) => [...b, r.id]);
    const note = notes[r.id]?.trim() || undefined;
    try {
      if (kill && alive(r)) {
        let ok = true;
        let error: string | undefined;
        try { await api.kill([r.pid]); } catch (e) { ok = false; error = String(e); }
        await api.shadowAppend({ type: "action", at: nowIso(), source: "panel", action: "kill", pids: [r.pid], reason: `cleanup: ${r.category}`, proposal: r.id, ok, error });
        if (!ok) message.error(t("actions.notStopped", { error }));
      }
      await api.shadowAppend({ type: "verdict", at: nowIso(), proposal: r.id, verdict, note });
    } catch (e) {
      message.error(t("cleanup.notSaved", { error: String(e) }));
    }
    setBusy((b) => b.filter((x) => x !== r.id));
    await deck.loadShadow();
    await deck.refresh();
  };

  /** From the panel: the whole machine, no session. Identical proposals, or ones already dismissed, are not repeated. */
  const scan = async () => {
    setScanning(true);
    try {
      await deck.refresh();
      const groups = await api.list();
      const shadow = await api.shadowRead();
      const verdicts = new Map(shadow.flatMap((r) => (r.type === "verdict" ? [[r.proposal, r.verdict] as const] : [])));
      const known = shadow.filter((r): r is ProposalRecord => r.type === "proposal" && (!verdicts.has(r.id) || verdicts.get(r.id) !== "close"));
      const found = cleanup.propose(groups, {});
      let added = 0;
      for (const p of found) {
        if (known.some((o) => o.category === p.category && o.pid === p.pid && o.cmd === p.cmd)) continue;
        await api.shadowAppend({
          type: "proposal", id: newId(), at: nowIso(), source: "panel", session: null, projects: [],
          category: p.category, pid: p.pid, pids: p.pids, cmd: p.cmd, root: p.root, ports: p.ports, evidence: p.evidence,
        });
        added++;
      }
      await deck.loadShadow();
      if (!found.length) message.info(t("cleanup.scanNothing"));
      else if (!added) message.info(t("cleanup.scanNoNew"));
      else message.success(t("count.newProposal", { count: added }));
    } catch (e) {
      message.error(t("cleanup.scanFailed", { error: String(e) }));
    }
    setScanning(false);
  };

  const scanButton = (
    <Button type="primary" icon={<ScanOutlined aria-hidden />} loading={scanning} onClick={scan} block={narrow} size={narrow ? "middle" : "small"}>{t("cleanup.scan")}</Button>
  );

  const order = (c: string) => { const i = cleanup.CATEGORIES.indexOf(c); return i < 0 ? 99 : i; };
  const rows = deck.pending
    .filter((r) => matches(deck.filter, [r.cmd, r.root, r.category, label(r.category), r.pid]))
    .sort((a, b) => order(a.category) - order(b.category));

  const columns: TableColumnsType<ProposalRecord> = [
    {
      title: t("cleanup.proposal"), key: "p",
      render: (_, r) => {
        const from = r.source === "claude" ? (r.session ? t("cleanup.fromClaudeSession", { session: r.session }) : t("cleanup.fromClaude")) : t("cleanup.fromPanel");
        return (
          <Flex vertical gap={4} style={{ minWidth: 0 }}>
            <Flex gap={8} align="center" wrap>
              <Tag color={COLORS[r.category] ?? "default"} style={{ marginInlineEnd: 0 }}>{label(r.category)}</Tag>
              <Typography.Text strong>{r.root ? r.root.split(/[\\/]/).pop() : "?"}</Typography.Text>
              <Mono type="secondary">pid {r.pid}{r.pids.length > 1 ? ` +${r.pids.length - 1}` : ""}</Mono>
              {alive(r) ? null : <Tag style={{ marginInlineEnd: 0 }}>{t("cleanup.gone")}</Tag>}
            </Flex>
            <Mono type="secondary" ellipsis>{r.cmd}</Mono>
            {narrow ? <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>{from} · {agoIso(r.at)}</Typography.Text> : null}
          </Flex>
        );
      },
    },
    ...(narrow ? [] : [{
      title: t("cleanup.proposed"), key: "at", width: 150,
      render: (_: unknown, r: ProposalRecord) => (
        <Flex vertical>
          <Typography.Text type="secondary">{agoIso(r.at)}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.source === "claude" ? t("cleanup.byClaude") : t("cleanup.byPanel")}</Typography.Text>
        </Flex>
      ),
    }]),
    {
      title: t("cleanup.verdict"), key: "v", width: narrow ? 116 : 290, align: "right",
      render: (_, r) => {
        const live = alive(r);
        const loading = busy.includes(r.id);
        return (
          <Flex gap={6} wrap justify="flex-end">
            {live ? <Button size="small" danger type="primary" icon={<PoweroffOutlined aria-hidden />} disabled={loading} onClick={() => judge(r, "close", true)}>{t("cleanup.close")}</Button> : null}
            <Button size="small" icon={<CheckOutlined aria-hidden />} disabled={loading} onClick={() => judge(r, live ? "keep" : "close", false)}>
              {live ? (narrow ? t("cleanup.keepShort") : t("cleanup.keep")) : t("cleanup.alreadyClosed")}
            </Button>
            <Button size="small" type="text" icon={<StopOutlined aria-hidden />} disabled={loading} onClick={() => judge(r, "wrong", false)}>{t("cleanup.wrong")}</Button>
          </Flex>
        );
      },
    },
  ];

  return (
    <Flex vertical gap={12}>
      <Alert type="info" showIcon title={t("cleanup.shadowTitle")}
        description={t("cleanup.shadowText")}
        action={narrow ? undefined : scanButton} />
      {narrow ? scanButton : null}
      <Table<ProposalRecord> size="small" rowKey="id" pagination={false} columns={columns} dataSource={rows} tableLayout="fixed"
        locale={{ emptyText: <Empty description={deck.filter ? t("cleanup.noMatch") : t("cleanup.none")} /> }}
        expandable={{
          // Open by default, new proposals included: the evidence is what you judge.
          expandedRowKeys: rows.map((r) => r.id).filter((id) => !folded.includes(id)),
          onExpand: (open, r) => setFolded((f) => (open ? f.filter((x) => x !== r.id) : [...f, r.id])),
          expandedRowRender: (r) => (
            <Flex vertical gap={8}>
              <ul style={{ margin: 0, paddingInlineStart: 18, color: token.colorTextSecondary }}>
                {r.evidence.map((e) => <li key={e}>{e}</li>)}
              </ul>
              <Input size="small" placeholder={t("cleanup.why")} aria-label={t("cleanup.why")}
                value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} style={{ maxWidth: 420 }} />
            </Flex>
          ),
        }} />
    </Flex>
  );
}
