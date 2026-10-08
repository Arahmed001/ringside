import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { KNOWN_ENV } from "../lib/doctor";

/**
 * The operator handbook (docs/operator-handbook.md) is the page a non-engineer runs the site from. Like tests/config-docs.test.ts and tests/load-day-doc.test.ts,
 * this keeps it from drifting: a setting the doctor knows must be in its table, a command it tells you to type must exist, a link must go somewhere.
 */
const ROOT = path.resolve(__dirname, "..");
const DOC = fs.readFileSync(path.join(ROOT, "docs/operator-handbook.md"), "utf8");
const scripts = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
/** Documents that live in open pull requests (host-guide: 165, cdn: 166) and are named in plain text, not linked, until they merge. Remove an entry here once its file is on main. */
const PENDING = new Set(["docs/host-guide.md", "docs/cdn.md"]);

/** The text between a "## " heading starting with `start` and the next "## " heading. */
function section(start: string): string {
  const i = DOC.search(new RegExp(`^## ${start}`, "m"));
  assert.ok(i >= 0, `the handbook has a section "${start}"`);
  const rest = DOC.slice(i + 3);
  const j = rest.search(/^## /m);
  return j < 0 ? rest : rest.slice(0, j);
}
/** The rows of the settings table: setting name -> [what it does, default, secret?]. */
function settingsTable(): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of section("7\\.").split("\n")) {
    const m = /^\| `([A-Z][A-Z0-9_]+)` \| (.*) \|$/.exec(line);
    if (!m) continue;
    rows.set(m[1], m[2].split(" | ").map((c) => c.trim()));
  }
  return rows;
}
/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
const slug = (h: string) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");

test("every setting the doctor knows is in the handbook's table, and the table lists nothing the doctor does not know", () => {
  const table = settingsTable();
  const missing = KNOWN_ENV.filter((k) => !table.has(k));
  assert.deepEqual(missing, [], "add a row to section 7 of docs/operator-handbook.md (what it does, the safe default, whether it is a secret)");
  const extra = [...table.keys()].filter((k) => !(KNOWN_ENV as readonly string[]).includes(k));
  assert.deepEqual(extra, [], "section 7 lists a setting the doctor does not know: remove the row, or add the setting to KNOWN_ENV");
  for (const [name, cols] of table) assert.equal(cols.length, 3, `${name}: three columns (what it does | safe default | secret?)`);
});

test("only the two keys are marked secret, and every row says so either way", () => {
  const secret = [...settingsTable()].filter(([, cols]) => /^\*\*yes\*\*$/i.test(cols[2]) || /^yes$/i.test(cols[2])).map(([k]) => k).sort();
  assert.deepEqual(secret, ["ANTHROPIC_API_KEY", "BOXING_API_KEY"]);
  for (const [name, cols] of settingsTable()) assert.match(cols[2], /^(?:\*\*yes\*\*|no)(?:\s|$)/i, `${name}: the last column starts with yes or no`);
});

test("the four statement flags are each explained as the owner's own statement, with what happens if unset", () => {
  const pre = section("3\\.");
  for (const flag of ["BOXING_API_STORAGE_CONFIRMED", "VENDOR_RANKINGS_CONFIRMED", "PUBLIC_API", "VENDOR_REDISTRIBUTION_CONFIRMED"]) assert.match(pre, new RegExp(flag), `${flag} in the pre-launch checklist`);
  assert.match(pre, /your statement that the vendor allows it/i);
});

test("the nightly job's exit codes 2, 3 and 75 are explained, with the same meanings as the docs that define them", () => {
  const s = section("4\\.");
  assert.match(s, /\| \*\*2\*\* \| \*\*The vendor was unreachable or refused/);
  assert.match(s, /\| \*\*3\*\* \| \*\*A safety check refused the data/);
  assert.match(s, /\| \*\*75\*\* \| \*\*Another run already holds the lock/);
  const loadDay = fs.readFileSync(path.join(ROOT, "docs/load-day.md"), "utf8");
  assert.match(loadDay, /\| 2 \| The vendor is unreachable or refused/);
  assert.match(loadDay, /\| 3 \| A check refused the data/);
  assert.match(loadDay, /\| 75 \| Another run holds the lock/);
});

test("every case the owner must be able to look up is in the 'if X happens' section", () => {
  const s = section("4\\.").toLowerCase();
  for (const phrase of ["site is down", "\"stale\":true", "exit code 2", "exit code 3", "exit code 75", "vendor emails", "remove their details", "forum post is reported", "wrong fact", "disk is nearly full", "restarting", "ai key", "actions ci", "rollback", "restore from a backup", "arabic looks wrong", "photo is wrong"])
    assert.ok(s.includes(phrase), `section 4 covers: ${phrase}`);
});

test("every npm script the handbook tells you to run exists", () => {
  const used = [...DOC.matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]);
  assert.ok(used.length >= 10, `the handbook uses ${used.length} commands`);
  for (const s of new Set(used)) assert.ok(s in scripts, `npm run ${s} exists`);
  for (const s of ["doctor", "backup", "accounts", "gate", "vendor:backfill", "vendor:fetch", "vendor:audit"]) assert.ok(used.includes(s), `the handbook covers npm run ${s}`);
});

test("every link goes to a document or heading that exists", () => {
  const headings = new Set(DOC.split("\n").filter((l) => /^#{1,4} /.test(l)).map((l) => slug(l.replace(/^#+\s+/, "").replace(/`/g, ""))));
  const bad: string[] = [];
  for (const m of DOC.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^https?:/.test(target)) continue;
    if (target.startsWith("#")) { if (!headings.has(target.slice(1))) bad.push(`${target} (no such heading)`); continue; }
    const file = target.split("#")[0], rel = path.posix.join("docs", file);
    if (!fs.existsSync(path.join(ROOT, rel)) && !PENDING.has(rel)) bad.push(`${target} (no such file ${rel})`);
  }
  assert.deepEqual(bad, []);
});

test("it is linked from the README and from the top of go-live.md and load-day.md", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "README.md"), "utf8"), /docs\/operator-handbook\.md/);
  for (const f of ["go-live.md", "load-day.md"]) {
    const top = fs.readFileSync(path.join(ROOT, "docs", f), "utf8").split("\n").slice(0, 4).join("\n");
    assert.match(top, /operator-handbook\.md/, `${f} links to the handbook within its first lines`);
  }
});

test("the settings test itself notices a missing row (a doctor-known setting removed from the table is reported)", () => {
  const table = new Map<string, string[]>(KNOWN_ENV.map((k) => [k, []]));
  table.delete("SITE_URL");
  assert.deepEqual(KNOWN_ENV.filter((k) => !table.has(k)), ["SITE_URL"]);
});
