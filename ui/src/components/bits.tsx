/** Small pieces every page uses: monospace text, port tags, icon buttons. */
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { App, Button, Tag, Tooltip, Typography } from "antd";
import { api } from "../api";

export const MONO = '"JetBrains Mono", ui-monospace, Consolas, monospace';
export const SANS = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';

export function Mono({ children, type, ellipsis, style }: { children: ReactNode; type?: "secondary"; ellipsis?: boolean; style?: CSSProperties }) {
  return (
    <Typography.Text type={type} ellipsis={ellipsis ? { tooltip: children } : false} style={{ fontFamily: MONO, fontSize: "0.9em", ...style }}>
      {children}
    </Typography.Text>
  );
}

export function PortTag({ port }: { port: number }) {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const label = t("common.openPort", { port });
  const open = () => api.openPort(port).catch((e) => message.error(t("common.openFailed", { error: String(e) })));
  return (
    <Tooltip title={label}>
      <Tag color="success" role="button" tabIndex={0} aria-label={label}
        onClick={open} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open()}
        style={{ fontFamily: MONO, cursor: "pointer", marginInlineEnd: 0 }}>
        :{port}
      </Tag>
    </Tooltip>
  );
}

/** `danger`: ink at rest, red only under the pointer (global.css), so a column of them doesn't alarm. */
export function IconButton({ title, icon: Icon, onClick, danger }: { title: string; icon: ComponentType<{ "aria-hidden"?: boolean }>; onClick?: () => void; danger?: boolean }) {
  return (
    <Tooltip title={title}>
      <Button type="text" size="small" icon={<Icon aria-hidden />} className={danger ? "dd-danger" : undefined} aria-label={title} onClick={onClick} />
    </Tooltip>
  );
}

/** A folder under the user's profile reads from `~`: C:\Users\me\code\x → ~\code\x. */
export function shortPath(path: string): string {
  return path.replace(/^[a-z]:\\users\\[^\\]+/i, "~");
}

/** Nothing to show: one quiet line where the rows would be, no illustration. */
export function Nothing({ text, style }: { text: ReactNode; style?: CSSProperties }) {
  return (
    <Typography.Paragraph type="secondary" style={{ margin: 0, padding: "40px 0", textAlign: "center", ...style }}>{text}</Typography.Paragraph>
  );
}
