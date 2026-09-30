/**
 * The panel in a real browser, on demo data: navigation and keyboard, the page
 * remembered across reloads, the filter ("/" and Esc), an open project surviving
 * a refresh, stopping with confirmation, opt-in descriptions and "Describe", a
 * verdict in Cleanup, scheduled tasks (enable, disable, delete), the theme menu, the language following the system (English
 * when it isn't translated), and no horizontal scrolling at
 * 1280, 760 and 420 px in both themes. Screenshots go to tools/shots/.
 *
 *   npm run ui:build && npm run ui-check
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, URL } from "./serve.mjs";

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "shots");
mkdirSync(SHOTS, { recursive: true });
const ok = (what) => console.log("ok  " + what);

/** Waits for a count instead of reading it once: the demo data arrives asynchronously, later on a slow runner. */
async function expectCount(locator, n, what) {
  const until = Date.now() + 10_000;
  let got;
  while ((got = await locator.count()) !== n && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  assert.equal(got, n, `${what}: expected ${n}, got ${got}`);
}

const stop = await serve();
const browser = await chromium.launch();
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: "light", reducedMotion: "reduce", locale: "en-US" });
  // A clean slate on the first load only (later reloads keep what the page stored).
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("started")) {
      localStorage.clear();
      sessionStorage.setItem("started", "1");
    }
  });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL);

  const menu = (name) => page.getByRole("menuitem", { name: new RegExp(`^${name}`) });
  const heading = () => page.locator("header h4").textContent();

  // Navigation: Sessions first, then the keyboard reaches the other pages.
  await page.waitForSelector(".ant-menu");
  assert.equal(await heading(), "Sessions");
  await menu("Processes").focus();
  await page.keyboard.press("Enter");
  assert.equal(await heading(), "Processes");
  ok("pages from the sidebar, with the keyboard");

  await page.reload();
  await page.waitForSelector(".ant-menu");
  assert.equal(await heading(), "Processes");
  ok("the open page survives a reload");

  // Filter: "/" focuses it, words narrow the projects, Esc clears it.
  const projects = page.locator(".ant-table").first().locator("tr.ant-table-row-level-0");
  await expectCount(projects, 3, "projects after reload");
  await page.locator("body").click({ position: { x: 5, y: 700 } });
  await page.keyboard.press("/");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "filter");
  await page.keyboard.type("blog");
  await expectCount(projects, 1, "projects matching \"blog\"");
  await page.keyboard.press("Escape");
  await expectCount(projects, 3, "projects after Esc");
  ok("\"/\" and the filter, Esc clears it");

  // Opening a project opens its whole tree, and it stays open across a refresh (every 3 s).
  await projects.first().locator(".ant-table-row-expand-icon").click();
  const tsxRow = page.locator("tr.ant-table-row-level-3");
  await tsxRow.first().waitFor();
  await page.waitForTimeout(3500);
  assert.ok(await tsxRow.first().isVisible());
  ok("an open project keeps its tree open when the list refreshes");

  // A process a scheduled task started says so; a project with tasks links to them.
  const blog = page.locator("tr.ant-table-row-level-0", { hasText: "blog" });
  await blog.getByText("2 scheduled").waitFor();
  await blog.locator(".ant-table-row-expand-icon").click();
  await page.locator("tr.ant-table-row-level-1", { hasText: "publish.mjs" }).getByText("blog publish").waitFor();
  const backend = page.locator("tr.ant-table-row-level-0", { hasText: "backend" });
  await backend.getByRole("button", { name: "1 scheduled" }).click();
  assert.equal(await heading(), "Scheduled");
  await expectCount(page.locator("tr.ant-table-row-level-0"), 1, "projects on Scheduled, filtered on backend");
  assert.match(await page.locator("#filter").inputValue(), /acme-shop\\backend$/);
  await page.locator("#filter").fill("");
  await menu("Processes").click();
  ok("a task's process is tagged; \"1 scheduled\" opens Scheduled on that project");

  // Stop asks first, then the project is gone.
  await blog.getByRole("button", { name: /Stop the project/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".ant-modal-confirm-title", { hasText: 'Stop "blog"?' }).waitFor();
  await dialog.getByRole("button", { name: "Stop" }).click();
  await blog.waitFor({ state: "detached" });
  ok("stop asks for confirmation, then the project goes");
  await page.screenshot({ path: join(SHOTS, "processes-1280-light.png") });

  // Sessions: descriptions are off until the switch turns them on; then "Describe" writes one.
  await menu("Sessions").click();
  const describe = page.getByRole("button", { name: "Describe", exact: true });
  assert.equal(await describe.count(), 0);
  assert.equal(await page.locator("#describe-switch").getAttribute("aria-checked"), "false");
  await page.locator("#describe-switch").click();
  await describe.first().waitFor();
  await describe.first().click();
  await page.getByText(/Redesigning the Dev Deck panel/).waitFor({ timeout: 5000 });
  ok("descriptions are opt-in; \"Describe\" writes one");
  await page.screenshot({ path: join(SHOTS, "sessions-1280-light.png") });

  // Scheduled: tasks by project with their schedule and outcome; disabling and deleting ask first.
  await menu("Scheduled").click();
  const jobGroups = page.locator("tr.ant-table-row-level-0");
  await expectCount(jobGroups, 3, "projects with scheduled tasks");
  await page.getByText("Failed: the folder doesn't exist").waitFor();
  await page.getByText(/^every day at 03:00/).waitFor();
  await page.getByText(/^every 2 days at 12:00/).waitFor();
  const jobRow = (name) => page.locator("tr.ant-table-row-level-1", { hasText: name });
  await jobRow("blog links check").getByRole("button", { name: "Enable" }).click();
  await jobRow("blog links check").getByRole("button", { name: "Disable" }).waitFor();
  await jobRow("blog links check").getByRole("button", { name: "Disable" }).click();
  await dialog.locator(".ant-modal-confirm-title", { hasText: 'Disable "blog links check"?' }).waitFor();
  await dialog.getByRole("button", { name: "Disable" }).click();
  await jobRow("blog links check").getByText("disabled", { exact: true }).waitFor();
  await jobRow("Bank sync").getByRole("button", { name: "Delete" }).click();
  await dialog.locator(".ant-modal-confirm-title", { hasText: 'Delete "Bank sync"?' }).waitFor();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await page.getByText(/The copy is in .*deleted-tasks/).waitFor();
  await expectCount(jobGroups, 2, "projects after deleting the only task of one");
  ok("scheduled tasks by project; enable, disable and delete (with a copy) ask where they should");
  await page.screenshot({ path: join(SHOTS, "jobs-1280-light.png") });

  // Cleanup: a verdict removes the proposal and the count.
  await menu("Cleanup").click();
  assert.equal(await menu("Cleanup").locator(".ant-badge-count").textContent(), "1");
  await page.getByRole("button", { name: "Right, keep it" }).click();
  await page.getByText(/Nothing to judge/).waitFor();
  await menu("Cleanup").locator(".ant-badge-count").waitFor({ state: "detached" });
  ok("a verdict in Cleanup clears the proposal and the count");

  // The theme menu.
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitem", { name: "Dark" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  ok("the theme menu");

  // The language follows the system; one the panel doesn't have means English.
  for (const [locale, lang, processes] of [["it-IT", "it", "Processi"], ["pt-BR", "pt", "Processos"], ["de-DE", "en", "Processes"]]) {
    const c = await browser.newContext({ locale, reducedMotion: "reduce" });
    const lp = await c.newPage();
    await lp.goto(URL);
    await lp.getByRole("menuitem", { name: new RegExp(`^${processes}`) }).waitFor();
    assert.equal(await lp.evaluate(() => document.documentElement.lang), lang, locale);
    await c.close();
  }
  ok("the language follows the system, English when it isn't translated");

  // Every page at three widths, in both themes: no horizontal scrolling.
  const wide = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce", locale: "en-US" });
  const p = await wide.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  for (const theme of ["light", "dark"]) {
    await p.emulateMedia({ colorScheme: theme });
    for (const width of [1280, 760, 420]) {
      await p.setViewportSize({ width, height: 720 });
      await p.goto(URL);
      await p.waitForSelector(".ant-menu");
      for (const [i, name] of ["sessions", "processes", "jobs", "cleanup"].entries()) {
        await p.locator(".ant-menu-item").nth(i).click();
        await p.locator(".ant-table-row").first().waitFor();
        await p.mouse.move(width - 4, 716);
        await p.waitForTimeout(200);
        const scroll = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(scroll <= 0, `${name} at ${width} px (${theme}) scrolls sideways by ${scroll} px`);
        if (width !== 1280 || theme !== "light") await p.screenshot({ path: join(SHOTS, `${name}-${width}-${theme}.png`) });
      }
    }
  }
  ok("no horizontal scrolling at 1280, 760 and 420 px, light and dark");

  assert.deepEqual(errors, [], "console errors");
  ok("no console errors");
} catch (e) {
  // In GitHub Actions, an annotation: readable on the run page and through the API.
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=ui-check::${String(e.message ?? e).split(/\r?\n/).slice(0, 3).join(" ")}`);
  throw e;
} finally {
  await browser.close();
  stop();
}
