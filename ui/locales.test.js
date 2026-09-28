// Every language has exactly the keys of en.json, with the same {{placeholders}} and <tags>.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "src", "locales");
const flat = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) => (typeof v === "object" ? flat(v, prefix + k + ".") : [[prefix + k, v]]));
const load = (lang) => new Map(flat(JSON.parse(fs.readFileSync(path.join(DIR, lang + ".json"), "utf8"))));
const marks = (s) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}|<\/?(\w+)>/g)].map((m) => m[0].replace(/\s/g, "")).sort();

const en = load("en");
const others = fs.readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "en.json").map((f) => f.slice(0, -5));

test("the five languages are there", () => {
  assert.deepEqual(others.sort(), ["es", "fr", "it", "pt"]);
});

for (const lang of others) {
  test(`${lang}: same keys as en`, () => {
    const t = load(lang);
    assert.deepEqual([...en.keys()].filter((k) => !t.has(k)), [], "missing");
    assert.deepEqual([...t.keys()].filter((k) => !en.has(k)), [], "extra");
  });
  test(`${lang}: same placeholders and tags as en`, () => {
    const t = load(lang);
    for (const [k, v] of en) if (t.has(k)) assert.deepEqual(marks(t.get(k)), marks(v), `${lang}: ${k}`);
  });
}
