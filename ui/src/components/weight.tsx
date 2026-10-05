/**
 * Weight: what the processes hold is drawn in proportion, never said. A meter under each
 * memory figure, the CPU of the last 24 hours as a line, and the free RAM counting up
 * when something closes.
 */
import { useEffect, useRef, useState } from "react";
import type { Group, SessionRow } from "../types";
import { useTranslation } from "react-i18next";
import { theme } from "antd";
import { freeTone, weightColors } from "../palette";
import { useLook } from "../theme";
import { cpu, gb, mb } from "../format";

/** After this long without activity a session is still: its weight turns amber. */
export const DORMANT_SECS = 2 * 3600;

/** Idle for longer than DORMANT_SECS; without a transcript, idle since it started. */
export function isDormant(lastActivity: number | null, runTime: number): boolean {
  const idle = lastActivity ? Date.now() / 1000 - lastActivity : runTime;
  return idle > DORMANT_SECS;
}

/** Full height of the CPU line: 8% of the machine, about one busy core on a 12-core PC. */
const FULL = 8;
/** Still yet working: the last two hours average at least this share of the machine. */
const AWAKE = 0.5;

export function isAwake(values: (number | null)[] | undefined): boolean {
  const recent = (values ?? []).slice(-4).filter((v): v is number => v != null);
  return recent.length > 0 && recent.reduce((a, v) => a + v, 0) / recent.length >= AWAKE;
}

export function useWeight() {
  const { dark, reducedMotion } = useLook();
  return { c: weightColors(dark), reducedMotion, dark };
}

/** A memory figure: the same size everywhere, so a column of them reads down; the meter under it carries the proportion. */
export function MemFigure({ bytes, dormant }: { bytes: number; dormant: boolean }) {
  const { c } = useWeight();
  const { token } = theme.useToken();
  return (
    <span className="dd-num" style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3, color: dormant ? c.dormantText : token.colorText, whiteSpace: "nowrap" }}>
      {mb(bytes)}
    </span>
  );
}

/**
 * How much a row holds against the heaviest one on the page: a short meter under its figure.
 * `drain`: what it held goes back, and the meter empties in the free color.
 */
export function Meter({ share, dormant, drain, width = 72 }: { share: number; dormant: boolean; drain?: boolean; width?: number }) {
  const { c, reducedMotion } = useWeight();
  const k = Math.max(0, Math.min(1, share));
  return (
    <span aria-hidden="true" style={{ display: "flex", justifyContent: "flex-end", width, height: 3, borderRadius: 2, background: c.meterTrack, overflow: "hidden" }}>
      <span style={{
        display: "block", height: "100%", borderRadius: 2,
        width: `${(drain ? 0 : Math.max(0.04, k)) * 100}%`,
        background: drain ? c.freeText : dormant ? c.dormant : c.meter,
        transition: reducedMotion ? "none" : drain ? "width 1.1s cubic-bezier(.4,0,.2,1), background .2s" : "width .5s ease",
      }} />
    </span>
  );
}

/** The memory cell of a row: the figure (or what closing gave back), the meter, and what the figure is made of. */
export function MemCell({ bytes, share, dormant, gain, sub, inline }: { bytes: number; share: number; dormant: boolean; gain?: number; sub?: string; inline?: boolean }) {
  const { token } = theme.useToken();
  // In a narrow window it follows the text, on one line: figure, meter, what it is made of.
  if (inline) return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {gain != null ? <GainFigure bytes={gain} /> : <MemFigure bytes={bytes} dormant={dormant} />}
      <Meter share={share} dormant={dormant} drain={gain != null} width={48} />
      {sub ? <span style={{ fontSize: 12, color: token.colorTextTertiary, whiteSpace: "nowrap" }}>{sub}</span> : null}
    </span>
  );
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4, verticalAlign: "middle" }}>
      {gain != null ? <GainFigure bytes={gain} /> : <MemFigure bytes={bytes} dormant={dormant} />}
      <Meter share={share} dormant={dormant} drain={gain != null} />
      {sub ? <span style={{ fontSize: 12, lineHeight: 1.2, color: token.colorTextTertiary, whiteSpace: "nowrap" }}>{sub}</span> : null}
    </span>
  );
}

/** The CPU of the last 24 hours. Gaps (Dev Deck off, process not there yet) break the line. */
export function Sparkline({ values, dormant, width = 112, height = 24 }: {
  values: (number | null)[] | undefined; dormant: boolean; width?: number; height?: number;
}) {
  const { c } = useWeight();
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const vs = values ?? [];
  const known = vs.filter((v): v is number => v != null);
  const awake = dormant && isAwake(vs);
  const still = known.length > 0 && known.every((v) => v < 0.05);
  const step = vs.length > 1 ? width / (vs.length - 1) : 0;
  const y = (v: number) => height - 1.5 - (Math.min(v, FULL) / FULL) * (height - 4);

  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  vs.forEach((v, i) => {
    if (v == null) { if (cur.length) runs.push(cur); cur = []; }
    else cur.push([i * step, y(v)]);
  });
  if (cur.length) runs.push(cur);

  const color = awake ? c.dormant : dormant || still ? c.lineStill : c.line;
  const fill = awake ? "rgba(208,138,52,.16)" : dormant || still ? "transparent" : c.area;
  const last = vs[vs.length - 1];
  const peak = known.length ? Math.max(...known) : 0;
  const label = !known.length ? t("weight.cpuNone") : awake ? t("weight.cpuBusy") : still ? t("weight.cpuStill") : t("weight.cpuRecent");
  const pts = (r: [number, number][]) => r.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ display: "block", overflow: "visible" }}>
      <title>{known.length && !still ? `${label} (max ${cpu(peak)})` : label}</title>
      <line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke={token.colorBorderSecondary} strokeWidth={1} />
      {runs.map((r, i) => r.length > 1 ? (
        <g key={i}>
          <polygon points={`${r[0][0].toFixed(1)},${height} ${pts(r)} ${r[r.length - 1][0].toFixed(1)},${height}`} fill={fill} />
          <polyline points={pts(r)} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ) : <circle key={i} cx={r[0][0]} cy={r[0][1]} r={1.2} fill={color} />)}
      {awake && last != null ? <circle className="dd-pulse" cx={width} cy={y(last)} r={3} fill={c.dormant} /> : null}
    </svg>
  );
}

/** Counts from the last value to `target` (ease-out); jumps when motion is reduced or the change is small. */
export function useCountUp(target: number, reduced: boolean, ms = 1100): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (reduced || Math.abs(target - start) < 64 * 1048576) {
      from.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const v = start + (target - start) * (1 - (1 - k) ** 3);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, ms]);
  return shown;
}

/**
 * The free RAM, large, counting when it changes. Its color is how much is left:
 * green with room, amber when tight, red when short. What a closing gave shows in its own row (GainFigure).
 */
export function FreeFigure({ available, total }: { available: number; total: number }) {
  const { reducedMotion, dark } = useWeight();
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const shown = useCountUp(available, reducedMotion);
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, whiteSpace: "nowrap" }}>
      <span className="dd-num" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.03em", color: freeTone(available, total, dark) }}>
        {gb(shown)}
      </span>
      <span style={{ fontSize: 13, color: token.colorTextSecondary }}>{t("weight.freeOf", { total: Math.round(total / 1073741824) })}</span>
    </div>
  );
}

/**
 * What closing gave back, measured, where the closed thing was: it counts up from zero
 * in place of the row's memory while the row's meter drains.
 */
export function GainFigure({ bytes, size = 16 }: { bytes: number; size?: number }) {
  const { c, reducedMotion } = useWeight();
  const { t } = useTranslation();
  const [target, setTarget] = useState(0);
  useEffect(() => { setTarget(bytes); }, [bytes]);
  const shown = useCountUp(target, reducedMotion, 900);
  return (
    <span role="status" className="dd-num" aria-label={t("weight.freed", { amount: mb(bytes) })} style={{
      fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.01em", fontSize: size, color: c.freeText, whiteSpace: "nowrap",
    }}>+{mb(shown)}</span>
  );
}

/* ---------- the strip: the computer's memory, piece by piece ---------- */

type SegKind = "active" | "dormant" | "process";
interface Seg {
  key: string;
  kind: SegKind;
  bytes: number;
}
const RANK: Record<SegKind, number> = { active: 0, dormant: 1, process: 2 };

/** One piece per session (with what runs under it) and per group of the processes outside the sessions. */
export function segmentsOf(sessions: SessionRow[], groups: Group[]): Seg[] {
  const live = new Set(sessions.map((r) => r.session.pid));
  const out: Seg[] = sessions.map(({ session: s }) => ({
    key: `s${s.pid}`, kind: isDormant(s.last_activity, s.run_time) ? "dormant" : "active", bytes: s.memory + s.children_memory,
  }));
  for (const g of groups) {
    // What runs under a listed session is already in its piece.
    const bytes = g.procs.filter((p) => !p.claude && !(p.claude_pid != null && live.has(p.claude_pid))).reduce((a, p) => a + p.memory, 0);
    if (bytes > 0) out.push({ key: `g${g.root ?? g.name}`, kind: "process", bytes });
  }
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.key.localeCompare(b.key));
}

/**
 * What just went away, kept `ms` more at its old place with `leaving: true`, so it can
 * shrink or fold instead of vanishing (a strip segment, a closed session's row).
 */
export function useLeaving<T>(items: T[], keyOf: (x: T) => string, ms = 900): { item: T; leaving: boolean }[] {
  const last = useRef<T[]>(items);
  // Worked out while rendering, not in an effect: the leaving item must be in the very render
  // that drops it, or its element unmounts and comes back already folded, with nothing to see.
  const ghosts = useRef(new Map<string, { item: T; at: number; until: number }>());
  const [, tick] = useState(0);
  const here = new Set(items.map(keyOf));
  last.current.forEach((item, at) => {
    const k = keyOf(item);
    if (!here.has(k) && !ghosts.current.has(k)) ghosts.current.set(k, { item, at, until: Date.now() + ms });
  });
  for (const k of [...ghosts.current.keys()]) if (here.has(k)) ghosts.current.delete(k);
  last.current = items;
  useEffect(() => {
    if (!ghosts.current.size) return;
    const next = Math.min(...[...ghosts.current.values()].map((g) => g.until));
    const id = setTimeout(() => {
      for (const [k, g] of ghosts.current) if (g.until <= Date.now()) ghosts.current.delete(k);
      tick((n) => n + 1);
    }, Math.max(0, next - Date.now()));
    return () => clearTimeout(id);
  });
  const out = items.map((item) => ({ item, leaving: false }));
  for (const g of [...ghosts.current.values()].sort((a, b) => a.at - b.at)) {
    out.splice(Math.min(g.at, out.length), 0, { item: g.item, leaving: true });
  }
  return out;
}

export function MemoryStrip({ sessions, groups, total, available }: { sessions: SessionRow[]; groups: Group[]; total: number; available: number }) {
  const { c, reducedMotion, dark } = useWeight();
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const segs = segmentsOf(sessions, groups);
  const shown = useLeaving(segs, (x) => x.key)
    .map(({ item, leaving }) => ({ ...item, leaving }))
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.key.localeCompare(b.key));
  const sum = (k: SegKind) => segs.filter((s) => s.kind === k).reduce((a, s) => a + s.bytes, 0);
  const held = segs.reduce((a, s) => a + s.bytes, 0);
  const system = Math.max(0, total - available - held);
  const pct = (b: number) => `${((b / Math.max(1, total)) * 100).toFixed(3)}%`;
  const move = reducedMotion ? "none" : "width .8s cubic-bezier(.2,.8,.2,1), margin .8s";
  const color: Record<SegKind, string> = { active: c.active, dormant: c.dormant, process: c.process };
  const legend: [string, string, number, string?][] = [
    [t("weight.stripActive"), c.active, sum("active")],
    [t("weight.stripDormant"), c.dormant, sum("dormant"), c.dormantText],
    [t("weight.stripProcesses"), c.process, sum("process")],
    [t("weight.stripSystem"), c.system, system],
    [t("weight.stripFree"), c.free, available, freeTone(available, total, dark)],
  ];
  const parts = legend.map(([label, , b]) => `${label} ${mb(b)}`).join(", ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div role="img" aria-label={t("weight.stripLabel", { parts })}
        style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: c.free, boxShadow: `inset 0 0 0 1px ${c.freeEdge}` }}>
        {shown.map((s) => (
          <div key={s.key} style={{ flexShrink: 0, width: s.leaving ? 0 : pct(s.bytes), marginInlineEnd: s.leaving ? 0 : 2, background: color[s.kind], transition: move }} />
        ))}
        <div style={{ flexShrink: 0, width: pct(system), background: c.system, transition: move }} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", columnGap: 20, rowGap: 4, fontSize: 12.5, color: token.colorTextSecondary }}>
        {legend.map(([label, swatch, b, strong]) => b > 0 || label === t("weight.stripFree") ? (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: swatch, boxShadow: swatch === c.free ? `inset 0 0 0 1px ${c.freeEdge}` : undefined }} />
            {label}
            <span className="dd-num" style={{ fontWeight: 600, color: strong ?? token.colorText }}>{mb(b)}</span>
          </span>
        ) : null)}
      </div>
    </div>
  );
}
