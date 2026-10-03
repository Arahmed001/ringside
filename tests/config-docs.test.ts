import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { INTERNAL_ENV, KNOWN_ENV, distance } from "../lib/doctor";

/**
 * The settings the code reads, the list the doctor knows, and .env.example must agree. Round 28 found fourteen settings that the code
 * read and no file mentioned; this is the test that stops the number going back up.
 */
const ROOT = path.resolve(__dirname, "..");
const SCAN = ["lib", "app", "components", "scripts", "proxy.ts", "next.config.ts", "instrumentation.ts"];
const PLATFORM = new Set(["NODE_ENV", "NEXT_RUNTIME"]);
/** Misspellings the docs print on purpose, as examples of what the doctor catches. */
const EXAMPLE_TYPOS = new Set(["SITE_URLL"]);

function files(p: string): string[] {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(p, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(full, e.name)] : []));
}
/** Names read as process.env.NAME, process.env["NAME"] or through the envNum("NAME", …) helper. */
export function readSettings(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const f of SCAN.flatMap(files)) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|process\.env\[["']([A-Z][A-Z0-9_]+)["']\]|envNum\(["']([A-Z][A-Z0-9_]+)["']/g)) {
      const name = m[1] ?? m[2] ?? m[3];
      found.set(name, [...(found.get(name) ?? []), path.relative(ROOT, f)]);
    }
  }
  return found;
}
const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));

test("every setting the code reads is known to the doctor, and every one the doctor knows is read by the code", () => {
  const read = readSettings();
  const known = new Set<string>([...KNOWN_ENV, ...INTERNAL_ENV]);
  const unknown = [...read.keys()].filter((k) => !known.has(k) && !PLATFORM.has(k));
  assert.deepEqual(unknown.map((k) => `${k} (read in ${read.get(k)![0]})`), [], "add it to KNOWN_ENV in lib/doctor.ts (and .env.example), or to INTERNAL_ENV if it is a test hook");
  const stale = [...known].filter((k) => !read.has(k));
  assert.deepEqual(stale, [], "a setting nothing reads any more: remove it from lib/doctor.ts and .env.example");
});

test(".env.example documents every public setting, and nothing it lists is unknown", () => {
  assert.deepEqual(KNOWN_ENV.filter((k) => !documented.has(k)), [], "missing from .env.example");
  assert.deepEqual([...documented].filter((k) => !(KNOWN_ENV as readonly string[]).includes(k)), [], ".env.example lists a setting the code does not read");
  const internal = INTERNAL_ENV.filter((k) => documented.has(k));
  assert.deepEqual(internal, [], "internal test hooks stay out of .env.example");
});

test(".env.example has no real-looking value on an uncommented line", () => {
  const live = example.split("\n").filter((l) => /^[A-Z][A-Z0-9_]+=/.test(l)).map((l) => l.split("=")[0] + "=" + l.split("=").slice(1).join("=").trim());
  // Copying the file must not turn anything on by itself: the only active values are the empty key and the demo provider.
  assert.deepEqual(live.sort(), ["ANTHROPIC_API_KEY=", "BOXING_PROVIDER=demo"]);
});

test("the docs name no setting that is a near-miss of a real one", () => {
  const known = [...KNOWN_ENV, ...INTERNAL_ENV];
  const docs = ["README.md", "PLAN.md", ...fs.readdirSync(path.join(ROOT, "docs")).map((n) => path.join("docs", n))].filter((p) => p.endsWith(".md") && fs.existsSync(path.join(ROOT, p)));
  const bad: string[] = [];
  for (const d of docs) {
    for (const m of fs.readFileSync(path.join(ROOT, d), "utf8").matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?:=[^`]*)?`/g)) {
      const name = m[1];
      if (known.includes(name as never) || PLATFORM.has(name) || EXAMPLE_TYPOS.has(name)) continue;
      const near = known.find((k) => distance(name, k) <= 2);
      if (near) bad.push(`${d}: ${name} (did you mean ${near}?)`);
    }
  }
  assert.deepEqual(bad, []);
});

test("the scanner itself sees the three ways of reading a setting (so an unnoticed pattern cannot hide a setting)", () => {
  const read = readSettings();
  assert.ok(read.has("DATABASE_PATH"), "process.env.NAME");
  assert.ok(read.has("AI_DAILY_BUDGET"), 'envNum("NAME")');
  assert.ok([...read.values()].flat().some((f) => f.startsWith("scripts")), "scripts are scanned");
  assert.ok(read.size >= 25, `only ${read.size} settings found`);
});
