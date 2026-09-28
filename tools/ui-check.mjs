/**
 * The panel in demo mode (outside Tauri, fake data), in Chromium: tabs with
 * mouse and keyboard, the remembered tab, `/` for the filter, the filter,
 * "Describe", a verdict in Cleanup, and no horizontal scrolling at 1280, 760
 * and 420 px. Saves screenshots to tools/shots/.
 *
 *   npm run ui-check
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(HERE, "..", "ui", "index.html")).href;
const SHOTS = join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const ok = (msg) => console.log("ok  " + msg);

await page.goto(PAGE);
await page.waitForSelector("#sessions details.row");
await page.waitForTimeout(1500); // the Web Awesome components come from the CDN

// Tabs: with the keyboard (arrows on the bar), and the choice survives a reload.
await page.locator("wa-tab[panel=sessions]").focus();
await page.keyboard.press("ArrowRight");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
assert.equal(await page.locator("#tabs").getAttribute("active"), "processes");
ok("tabs with the keyboard");
await page.reload();
await page.waitForSelector("#groups details.row");
await page.waitForTimeout(800);
assert.equal(await page.locator("#tabs").getAttribute("active"), "processes");
ok("the chosen tab survives a reload");

// "/" jumps to the filter, and the filter applies to the open tab.
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press("/");
await page.keyboard.type("blog");
await page.waitForTimeout(300);
assert.deepEqual(await page.locator("#groups details.row .name").allTextContents(), ["blog"]);
ok("\"/\" and filter on projects");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
assert.equal(await page.locator("#groups details.row").count(), 2);
ok("Esc clears the filter");

// A project opens on click and shows the tree; it stays open on the next refresh (3 s).
await page.locator("#groups details.row summary").first().click();
await page.waitForTimeout(3500);
assert.equal(await page.locator("#groups details.row").first().getAttribute("open"), "");
assert.equal(await page.locator("#groups details.row .proc").first().isVisible(), true);
ok("an open project stays open when the list refreshes");
await page.screenshot({ path: join(SHOTS, "processes-1280.png") });

// Sessions: descriptions are off until the switch turns them on; then "Describe" writes one.
await page.locator("wa-tab[panel=sessions]").click();
await page.waitForTimeout(300);
assert.equal(await page.locator("#sessions wa-button", { hasText: "Describe" }).count(), 0);
assert.equal(await page.locator("#describe-switch").evaluate((el) => el.checked), false);
ok("descriptions off by default, no \"Describe\" button");
await page.locator("#describe-switch").click();
await page.locator("#sessions wa-button", { hasText: "Describe" }).first().waitFor({ timeout: 3000 });
await page.locator("#sessions details.row").first().locator("wa-button", { hasText: "Describe" }).click();
await page.waitForFunction(() => document.querySelector("#sessions .desc")?.textContent.includes("Redesigning"), null, { timeout: 5000 });
ok("\"Describe\"");
await page.screenshot({ path: join(SHOTS, "sessions-1280.png") });

// Cleanup: the verdict removes the proposal and clears the count.
await page.locator("wa-tab[panel=cleanup]").click();
await page.waitForTimeout(300);
assert.equal(await page.locator("#count-cleanup").textContent(), "1");
await page.screenshot({ path: join(SHOTS, "cleanup-1280.png") });
await page.locator(".proposal wa-button", { hasText: "Right" }).click();
await page.waitForTimeout(800);
assert.equal(await page.locator(".proposal").count(), 0);
assert.equal(await page.locator("#count-cleanup").isHidden(), true);
ok("verdict in Cleanup");

// No horizontal scrolling, on every tab and at three widths.
for (const width of [1280, 760, 420]) {
  await page.setViewportSize({ width, height: 820 });
  for (const tab of ["sessions", "processes", "cleanup"]) {
    await page.locator(`wa-tab[panel=${tab}]`).click();
    await page.waitForTimeout(250);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `${tab} at ${width} px scrolls by ${over} px`);
    if (width !== 1280) await page.screenshot({ path: join(SHOTS, `${tab}-${width}.png`) });
  }
}
ok("no horizontal scrolling at 1280, 760 and 420 px");

assert.deepEqual(errors, []);
ok("no console errors");
await browser.close();
