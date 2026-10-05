import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** The load-day page is only useful if every command in it exists: a renamed script must fail a test, not a person on the day (round 94). */
const ROOT = path.resolve(__dirname, "..");
const doc = fs.readFileSync(path.join(ROOT, "docs/load-day.md"), "utf8");
const scripts = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

test("every npm script the load-day page runs exists", () => {
  const used = [...doc.matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]);
  assert.ok(used.length >= 8, `the page uses ${used.length} commands`);
  for (const s of new Set(used)) assert.ok(s in scripts, `npm run ${s} exists`);
  for (const s of ["vendor:fetch", "vendor:status", "vendor:load", "vendor:enrich"]) assert.ok(used.includes(s), `the page covers ${s}`);
});

test("the options it names are ones the scripts take, and it never asks for the key anywhere but the hidden prompt", () => {
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
  assert.match(read("scripts/vendor-fetch.ts"), /--setup/); assert.match(read("scripts/vendor-fetch.ts"), /--update|fetchArgs/);
  assert.match(read("lib/vendor-fetch.ts"), /--update/, "the daily update through the wrapper is a real path (the arguments leave --check off)");
  assert.match(read("scripts/vendor-load.ts"), /--dry-run/); assert.match(read("lib/vendor-load.ts"), /--storage-confirmed/);
  assert.match(read("scripts/vendor-enrich.ts"), /--dry-run/);
  assert.doesNotMatch(doc, /BOXING_API_KEY=/, "no command puts the key on a command line");
  assert.match(doc, /Never type the API key anywhere but the hidden prompt/);
});
