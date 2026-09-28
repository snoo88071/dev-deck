/**
 * The contrast of every text/background pair in the panel, per WCAG 2.
 * Reads the colors from ui/style.css (the :root variables), so it can't
 * drift from the real CSS. Semi-transparent backgrounds are composited over
 * the background they sit on.
 *
 *   node tools/contrast.mjs        exits with 1 if a text pair is below 4.5:1
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "style.css"), "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const vars = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

function resolve(v) {
  const m = /^var\(--([\w-]+)\)$/.exec(v);
  return m ? resolve(vars[m[1]]) : v;
}
function parse(c) {
  c = resolve(c);
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(c);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
  throw new Error(`unrecognized color: ${c}`);
}
/** A background, possibly semi-transparent over another: "--green-soft over --bg-row". */
function background(spec) {
  const [top, , under] = spec.split(" ");
  const t = parse(top.startsWith("#") ? top : `var(${top})`);
  if (!under) return t;
  const u = background(under);
  return { r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 };
}
function lum({ r, g, b }) {
  const f = (x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg, bg) {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

// [text, background, use]. Text pairs need 4.5:1; "ui" ones (borders, dots) 3:1.
const TEXT = [];
for (const t of ["--text-1", "--text-2", "--text-3"]) {
  for (const b of ["--bg-app", "--bg-row", "--bg-hover", "--bg-open", "--bg-inset"]) TEXT.push([t, b, "text"]);
}
TEXT.push(
  ["--text-2", "--bg-count", "tab counts"],
  ["--text-1", "--bg-button-hover", "button on hover"],
  ["--text-1", "--bg-neutral-loud", "filled neutral button"],
  ["--red-hover", "--red-soft over --bg-row", "stop button, on hover"],
  ["--green", "--bg-row", "ports, running state"],
  ["--green", "--green-soft over --bg-row", "green chip"],
  ["--green", "--green-soft over --bg-open", "green chip in an open row"],
  ["--amber", "--amber-soft over --bg-app", "cleanup count"],
  ["--amber", "--amber-soft over --bg-row", "amber chip"],
  ["--red", "--bg-row", "stop buttons"],
  ["--red", "--bg-hover", "stop buttons, on hover"],
  ["#ffffff", "--red-solid", "\"Close\" button"],
  ["#052e16", "#22c55e", "\"Scan now\" button"],
);
const UI = [
  ["--idle", "--bg-row", "dot of an idle session"],
  ["--amber", "--bg-row", "dot of a recent session"],
  ["--green", "--bg-app", "focus ring"],
];

let fail = 0;
const line = (fg, bg, use, min) => {
  const r = ratio(parse(fg.startsWith("#") ? fg : `var(${fg})`), background(bg));
  const ok = r >= min;
  if (!ok) fail++;
  console.log(`${ok ? "ok " : "NO "} ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${fg} on ${bg}  · ${use}`);
};
console.log("Text (WCAG AA, 4.5:1)");
for (const [f, b, u] of TEXT) line(f, b, u, 4.5);
console.log("\nInterface elements (3:1)");
for (const [f, b, u] of UI) line(f, b, u, 3);
console.log(fail ? `\n${fail} pairs below the threshold.` : "\nAll pairs pass.");
process.exit(fail ? 1 : 0);
