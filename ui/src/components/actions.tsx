/**
 * Stop, restart, open: always behind a confirmation that lists the processes,
 * with a warning when Claude Code is among them.
 */
import { useTranslation } from "react-i18next";
import { Alert, App, Flex } from "antd";
import { api } from "../api";
import { useDeck } from "../store";
import type { Group, Proc } from "../types";
import { MONO } from "./bits";

function procLine(p: Proc) {
  return `${p.pid}  ${p.runtime}${p.tool ? ` · ${p.tool}` : ""}  ${p.cmd.slice(0, 90)}`;
}

function Lines({ lines, warn }: { lines: string[]; warn?: string | null }) {
  return (
    <Flex vertical gap={12}>
      {warn ? <Alert type="warning" showIcon title={warn} /> : null}
      <ul style={{ margin: 0, paddingInlineStart: 18, fontFamily: MONO, fontSize: 12 }}>
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </Flex>
  );
}

export function useActions() {
  const { modal, message } = App.useApp();
  const { t } = useTranslation();
  const deck = useDeck();
  const claudeWarn = t("actions.claudeWarn");

  const stop = (title: string, procs: Proc[]) =>
    modal.confirm({
      title,
      content: <Lines lines={procs.map(procLine)} warn={procs.some((p) => p.claude) ? claudeWarn : null} />,
      okText: t("actions.stop"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await api.kill(procs.map((p) => p.pid));
        } catch (e) {
          message.error(t("actions.notStopped", { error: String(e) }));
        }
        await deck.refresh();
      },
    });

  const restart = (group: Group, p: Proc) =>
    modal.confirm({
      title: t("actions.restartTitle"),
      content: (
        <Lines lines={[procLine(p), t("actions.in", { path: p.cwd ?? "?" })]}
          warn={p.claude ? claudeWarn : null} />
      ),
      okText: t("actions.restart"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await api.restart(p.pid, `${group.name} (Dev Deck)`);
          message.success(t("actions.restarted"));
        } catch (e) {
          message.error(t("actions.notRestarted", { error: String(e) }));
        }
        setTimeout(() => deck.refresh(), 1500);
      },
    });

  const openFolder = (path: string, editor: boolean) =>
    api.openFolder(path, editor).catch((e) => message.error(t("common.openFailed", { error: String(e) })));

  return { stop, restart, openFolder };
}
