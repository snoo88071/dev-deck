/**
 * The shadow report: per category, how many proposals, how many judged, how
 * many with the right diagnosis and how many you would really have closed. And
 * the rule for giving a category autonomy (written, but switched off: only read here).
 *
 *   npm run shadow              (from the mcp folder)
 *   DEVDECK_SHADOW=other.jsonl npm run shadow
 */
import { MIN_JUDGED, MIN_PRECISION, pending, readShadow, shadowPath, stats } from "./shadow.ts";

const records = readShadow();
const rows = stats(records);
const pct = (x: number | null) => (x === null ? "  —" : `${Math.round(x * 100)}%`.padStart(4));

console.log(`Shadow file: ${shadowPath()}`);
console.log(`${records.filter((r) => r.type === "proposal").length} proposals, ${pending(records).length} still to judge, ${records.filter((r) => r.type === "action").length} actions.\n`);
if (!rows.length) {
  console.log("No proposals yet. Ask Claude Code to «clean up» (dev_cleanup), or press «Cleanup» in the panel.");
  process.exit(0);
}
console.log("category         proposals  judged  right diagnosis  would close  wrong  autonomy");
for (const r of rows) {
  const verdict = r.promotable
    ? "could be granted"
    : r.judged < MIN_JUDGED
      ? `needs ${MIN_JUDGED - r.judged} more verdicts`
      : !r.cleanLast10
        ? "recent mistakes"
        : "too many «keep»";
  console.log(
    `${r.category.padEnd(16)} ${String(r.proposals).padStart(9)}  ${String(r.judged).padStart(6)}  ${pct(r.precision).padStart(15)}  ${pct(r.closeRate).padStart(11)}  ${String(r.wrong).padStart(5)}  ${verdict}`,
  );
}
console.log(
  `\nRule (switched off): at least ${MIN_JUDGED} verdicts, at least ${Math.round(MIN_PRECISION * 100)}% «close», no wrong one among the last 10.` +
    `\nA category that passes it could be left to Claude on its own: the decision stays yours.`,
);
