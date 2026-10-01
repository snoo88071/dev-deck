/**
 * WCAG 2 contrast of every visible piece of text in the panel, measured on the
 * colors the browser actually computes (antd derives many of them), on every
 * page, in light and dark. Semi-transparent colors are composited over what is
 * behind them. Normal text needs 4.5:1, large text (24 px, or 18.66 px bold) 3:1;
 * disabled controls are exempt.
 *
 *   npm run ui:build && npm run contrast     exits with 1 on a failure
 */
import { chromium } from "playwright";
import { serve, URL } from "./serve.mjs";

const stop = await serve();
const browser = await chromium.launch();
const failures = new Map();
let checked = 0;

try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme, reducedMotion: "reduce", locale: "en-US" });
    const page = await context.newPage();
    await page.goto(URL);
    await page.waitForSelector(".ant-menu");
    for (const [i, name] of ["sessions", "processes", "jobs", "cleanup"].entries()) {
      await page.locator(".ant-menu-item").nth(i).click();
      await page.locator(".ant-table-row, .dd-session").first().waitFor();
      // Open what can be opened, so detail rows are measured too.
      for (const icon of await page.locator(".ant-table-row-expand-icon-collapsed, .dd-expand[aria-expanded=false]").all()) await icon.click().catch(() => {});
      await page.mouse.move(1279, 899);
      await page.waitForTimeout(300);
      const rows = await page.evaluate(measure);
      for (const r of rows) {
        checked++;
        if (r.ratio < r.need) failures.set(`${theme} · ${name} · ${r.text}`, r);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  stop();
}

if (failures.size) {
  for (const [where, r] of failures) {
    const line = `${r.ratio.toFixed(2)}:1 (needs ${r.need}) ${where}   ${r.fg} on ${r.bg}`;
    console.log(process.env.GITHUB_ACTIONS ? `::error title=contrast::${line}` : `FAIL ${line}`);
  }
  process.exitCode = 1;
} else {
  console.log(`All ${checked} text/background pairs pass (light and dark, four pages).`);
}

/** Runs in the page: every text node, its color and the background behind it. */
function measure() {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const [r, g, b, a = "1"] = m[1].split(/[ ,/]+/).filter(Boolean);
    return [+r, +g, +b, +a];
  };
  const over = (top, under) => {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  function background(el) {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let bg = parse(getComputedStyle(document.body).backgroundColor);
    if (bg[3] < 1) bg = [255, 255, 255, 1];
    for (const l of layers.reverse()) bg = over(l, bg);
    return bg;
  }

  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent.trim()) continue;
    seen.add(el);
    const s = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height || s.visibility === "hidden" || +s.opacity === 0) continue;
    if (el.closest("[disabled], .ant-btn-disabled, .ant-switch-disabled, [aria-disabled='true'], .ant-tooltip, .sr-only")) continue;
    const bg = background(el);
    const fg = over(parse(s.color), bg);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700);
    out.push({ text: n.textContent.trim().slice(0, 50), ratio: ratio(fg, bg), need: large ? 3 : 4.5, fg: hex(fg), bg: hex(bg) });
  }
  return out;
}
