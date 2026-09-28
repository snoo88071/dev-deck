/**
 * The README screenshots, from the demo data: Processes (a project open) and
 * Sessions (descriptions on), in light and dark, into docs/.
 *
 *   npm run ui:build && npm run screenshots
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, URL } from "./serve.mjs";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
const stop = await serve();
const browser = await chromium.launch();
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 600 }, colorScheme: theme, deviceScaleFactor: 2, reducedMotion: "reduce", locale: "en-US" });
    const page = await context.newPage();
    await page.goto(URL);
    await page.waitForSelector(".ant-menu");
    const suffix = theme === "dark" ? "-dark" : "";

    await page.getByRole("menuitem", { name: /^Processes/ }).click();
    await page.locator("tr.ant-table-row-level-0").first().locator(".ant-table-row-expand-icon").click();
    await page.mouse.move(999, 599);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(DOCS, `processes${suffix}.png`) });

    await page.getByRole("menuitem", { name: /^Sessions/ }).click();
    await page.locator("#describe-switch").click();
    await page.getByRole("button", { name: "Describe", exact: true }).first().click();
    await page.getByText(/Redesigning the Dev Deck panel/).waitFor();
    await page.mouse.move(999, 599);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(DOCS, `sessions${suffix}.png`) });
    await context.close();
  }
  console.log("docs/processes(-dark).png and docs/sessions(-dark).png updated");
} finally {
  await browser.close();
  stop();
}
