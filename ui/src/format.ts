import i18n, { intlTag } from "./i18n";
import type { Proc } from "./types";

const t = i18n.t.bind(i18n);
const num = (x: number, digits = 0) =>
  new Intl.NumberFormat(intlTag(), { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(x);

export function mb(bytes: number): string {
  const m = bytes / 1048576;
  return m >= 1024 ? `${num(m / 1024, 1)} GB` : `${num(m)} MB`;
}

export function since(sec: number): string {
  if (sec < 60) return t("time.s", { s: Math.round(sec) });
  const m = Math.floor(sec / 60);
  if (m < 60) return t("time.min", { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("time.h", { h, m: m % 60 });
  return t("time.d", { d: Math.floor(h / 24), h: h % 24 });
}

export function agoSec(epoch: number | null | undefined): string {
  if (!epoch) return "";
  const sec = Math.max(0, Math.round(Date.now() / 1000 - epoch));
  return sec < 60 ? t("time.justNow") : t("time.ago", { time: since(sec) });
}

export const agoIso = (iso: string) => agoSec(Date.parse(iso) / 1000);

export const cpu = (x: number) => `${num(x, x < 10 ? 1 : 0)}%`;

/** A project's tool chain: "npm → tsx", without consecutive repeats. */
export function chainOf(procs: Proc[]): string {
  const out: string[] = [];
  for (const p of procs) {
    const tool = p.tool || p.runtime;
    if (out[out.length - 1] !== tool) out.push(tool);
  }
  return out.slice(0, 4).join(" → ") + (out.length > 4 ? " …" : "");
}

/** The MCP servers of a Claude Code group: "chrome-devtools-mcp, @playwright/mcp", without npx and repeats. */
export function serversOf(procs: Proc[]): string {
  const out: string[] = [];
  for (const p of procs) {
    const tool = p.tool || p.runtime;
    if (!["npx", "npm", "node", "cmd"].includes(tool) && !out.includes(tool)) out.push(tool);
  }
  return out.join(", ");
}

/** Every word of the filter appears somewhere in the parts. */
export function matches(filter: string, parts: (string | number | null | undefined)[]): boolean {
  if (!filter) return true;
  const hay = parts.filter((x) => x != null).join(" ").toLowerCase();
  return filter.split(/\s+/).every((w) => hay.includes(w));
}
