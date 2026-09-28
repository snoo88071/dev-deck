/** Small pieces every page uses: monospace text, port tags, icon buttons. */
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { App, Button, Tag, Tooltip, Typography } from "antd";
import { api } from "../api";

export const MONO = '"JetBrains Mono", ui-monospace, Consolas, monospace';

export function Mono({ children, type, ellipsis, style }: { children: ReactNode; type?: "secondary"; ellipsis?: boolean; style?: CSSProperties }) {
  return (
    <Typography.Text type={type} ellipsis={ellipsis ? { tooltip: children } : false} style={{ fontFamily: MONO, fontSize: "0.92em", ...style }}>
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

export function IconButton({ title, icon: Icon, onClick, danger }: { title: string; icon: ComponentType<{ "aria-hidden"?: boolean }>; onClick?: () => void; danger?: boolean }) {
  return (
    <Tooltip title={title}>
      <Button type="text" size="small" icon={<Icon aria-hidden />} danger={danger} aria-label={title} onClick={onClick} />
    </Tooltip>
  );
}
