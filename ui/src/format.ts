import i18n, { intlTag } from "./i18n";
import type { Job, Proc, Trigger } from "./types";

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

/* ---------- scheduled tasks ---------- */

/** Rust's local times (`YYYY-MM-DDTHH:MM:SS`, no offset) read as local, as they are. */
const local = (iso: string) => new Date(iso);
const clock = (d: Date) => new Intl.DateTimeFormat(intlTag(), { hour: "2-digit", minute: "2-digit" }).format(d);
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** "today at 13:00", "tomorrow at 07:00", "yesterday at 09:00", otherwise "Fri 3 Oct, 09:00". */
export function when(iso: string | null): string {
  if (!iso) return "";
  const d = local(iso);
  const day = (offset: number) => dayKey(new Date(Date.now() + offset * 86400000));
  for (const [offset, key] of [[0, "jobs.today"], [1, "jobs.tomorrow"], [-1, "jobs.yesterday"]] as const) {
    if (dayKey(d) === day(offset)) return t(key, { time: clock(d) });
  }
  return new Intl.DateTimeFormat(intlTag(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

/** "48 h", "2 days", "30 min". */
export function interval(minutes: number): string {
  if (minutes % 1440 === 0) return t("jobs.days", { count: minutes / 1440 });
  if (minutes % 60 === 0) return t("jobs.hours", { count: minutes / 60 });
  return t("jobs.minutes", { count: minutes });
}

/** Weekday names in the app's language, 0 = Sunday: "Tue and Fri". */
function weekdayList(days: number[]): string {
  // 2023-01-01 was a Sunday.
  const name = (d: number) => new Intl.DateTimeFormat(intlTag(), { weekday: "short" }).format(new Date(2023, 0, 1 + d));
  // Monday first, as calendars in these languages do.
  const ordered = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return new Intl.ListFormat(intlTag(), { type: "conjunction", style: "short" }).format(ordered.map(name));
}

/** One trigger in words: "every day at 07:00", "Tue and Fri at 09:00, then every 2 h". */
export function trigger(tr: Trigger): string {
  const time = tr.start ? clock(local(tr.start)) : "";
  let s: string;
  switch (tr.kind) {
    case "daily":
      s = tr.every > 1 ? t("jobs.everyNDays", { count: tr.every, time }) : t("jobs.everyDay", { time });
      break;
    case "weekly":
      s = tr.every > 1
        ? t("jobs.everyNWeeks", { count: tr.every, days: weekdayList(tr.days), time })
        : t("jobs.weekly", { days: weekdayList(tr.days), time });
      break;
    case "once":
      s = t("jobs.once", { when: tr.start ? when(tr.start) : "" });
      break;
    default:
      s = t(`jobs.trigger.${tr.kind}`);
  }
  if (tr.repeat_minutes) s += t("jobs.thenEvery", { interval: interval(tr.repeat_minutes) });
  if (!tr.enabled) s += t("jobs.triggerOff");
  return s;
}

export const schedule = (j: Job) => (j.triggers.length ? j.triggers.map(trigger).join("; ") : t("jobs.noTrigger"));

/** The last run's outcome in words, and how it reads: fine, running, never ran, or wrong. */
export function outcome(j: Job): { text: string; status: "success" | "processing" | "default" | "error" } {
  const code = `0x${j.last_result.toString(16).toUpperCase()}`;
  const text = t(`jobs.result.${j.result}`, { code: j.result === "exit" ? String(j.last_result) : code });
  if (j.running || j.result === "running") return { text: t("jobs.result.running"), status: "processing" };
  if (j.result === "ok") return { text, status: "success" };
  if (j.result === "not-run" || !j.last_run) return { text: t("jobs.result.not-run"), status: "default" };
  return { text, status: "error" };
}

/** Something to look at: its folder or script is gone, or its last run failed. */
export const broken = (j: Job) => !!j.missing || outcome(j).status === "error";
