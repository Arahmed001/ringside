import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { collectNames, readDbNames, readNamesFile, saveNamesToFile, syncNamesFromFile, writeNamesFile, type NamesFile } from "../lib/i18n/names-file";
import { tempDb } from "./helpers";

const root = process.cwd();
const cleanup = tempDb("names-file");
after(cleanup);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-names-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const mem = () => { const db = new DatabaseSync(":memory:"); db.exec("CREATE TABLE name_translations (en TEXT NOT NULL, locale TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'claude', reviewed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (en, locale))"); return db; };
const put = (db: DatabaseSync, en: string, text: string, source: string, reviewed: number) => db.prepare("INSERT INTO name_translations VALUES (?, 'ar', ?, ?, ?)").run(en, text, source, reviewed);
const file = (names: NamesFile) => { const f = path.join(tmp, `n-${Math.random().toString(36).slice(2)}.json`); writeNamesFile(names, f); return f; };

test("the file loads into a database: new names are added, the same name is left alone, a differing unreviewed copy is replaced by the file", () => {
  const db = mem();
  put(db, "Ana Cruz", "آنا كروز", "claude-session", 0);
  put(db, "Bo Lee", "بو لي", "claude-session", 0);
  const f = file({ "Ana Cruz": { ar: "آنا كروز", source: "claude-session", reviewed: false }, "Bo Lee": { ar: "بو لي الجديد", source: "editor", reviewed: true }, "Cy Day": { ar: "سي داي", source: "claude", reviewed: false } });
  assert.deepEqual(syncNamesFromFile(db, f), { inserted: 1, updated: 1, kept: 0 });
  assert.deepEqual(readDbNames(db), { "Ana Cruz": { ar: "آنا كروز", source: "claude-session", reviewed: false }, "Bo Lee": { ar: "بو لي الجديد", source: "editor", reviewed: true }, "Cy Day": { ar: "سي داي", source: "claude", reviewed: false } });
  assert.deepEqual(syncNamesFromFile(db, f), { inserted: 0, updated: 0, kept: 0 }, "loading twice changes nothing");
});

test("a name a person reviewed in the database is never overwritten by a file copy that was not reviewed; the file's review flag is picked up", () => {
  const db = mem();
  put(db, "Ana Cruz", "آنا كروز (راجعها شخص)", "editor", 1);
  put(db, "Bo Lee", "بو لي", "claude-session", 0);
  const f = file({ "Ana Cruz": { ar: "آنا كروث", source: "claude", reviewed: false }, "Bo Lee": { ar: "بو لي", source: "claude-session", reviewed: true } });
  assert.deepEqual(syncNamesFromFile(db, f), { inserted: 0, updated: 1, kept: 1 });
  assert.equal(readDbNames(db)["Ana Cruz"].ar, "آنا كروز (راجعها شخص)");
  assert.equal(readDbNames(db)["Bo Lee"].reviewed, true);
});

test("saving writes the database back to the file without ever shrinking it, sorted, one name per line", () => {
  const db = mem();
  put(db, "Zed", "زد", "editor", 1);
  const f = file({ "Ann": { ar: "آن", source: "claude", reviewed: false }, "Zed": { ar: "زد (قديم)", source: "claude", reviewed: false } });
  assert.equal(saveNamesToFile(db, f), 2, "Ann was only in the file and is kept");
  const text = fs.readFileSync(f, "utf8");
  assert.deepEqual(readNamesFile(f), { Ann: { ar: "آن", source: "claude", reviewed: false }, Zed: { ar: "زد", source: "editor", reviewed: true } });
  assert.equal(text.split("\n").length, 5, "{, two names, }, and a trailing newline");
  assert.ok(text.indexOf('"Ann"') < text.indexOf('"Zed"'));
  const again = path.join(tmp, "again.json"); writeNamesFile(readNamesFile(f), again);
  assert.equal(fs.readFileSync(again, "utf8"), text, "writing is deterministic");
});

test("a malformed or Arabic-less entry in the file is ignored, not loaded", () => {
  const f = path.join(tmp, "bad.json");
  fs.writeFileSync(f, JSON.stringify({ Good: { ar: "جيد", source: "x", reviewed: false }, NoArabic: { ar: "Latin only", source: "x", reviewed: false }, Empty: { ar: "  ", source: "x" }, Wrong: "text", Missing: { source: "x" } }));
  assert.deepEqual(Object.keys(readNamesFile(f)), ["Good"]);
  assert.deepEqual(readNamesFile(path.join(tmp, "does-not-exist.json")), {});
});

test("the committed file is well formed, nothing in it claims a review that has not happened, and it covers every name the demo league can show", async () => {
  const names = readNamesFile(path.join(root, "i18n", "names.ar.json"));
  const rows = Object.entries(names);
  assert.ok(rows.length > 1000);
  for (const [en, e] of rows) { assert.ok(en.trim() && /[؀-ۿ]/.test(e.ar), en); assert.ok(["claude", "claude-session", "editor"].includes(e.source), `${en}: source ${e.source}`); assert.ok(!/[٠-٩]/.test(e.ar), `${en}: Arabic-Indic digits`); }
  // a name is reviewed only if a person did it: machine sources can never be reviewed
  assert.deepEqual(rows.filter(([, e]) => e.reviewed && e.source !== "editor" && e.source !== "claude-session").map(([en]) => en), []);
  const { getDb } = await import("../lib/db");
  const db = await getDb(); // seeds the demo league and loads the file
  const missing = [...collectNames(db)].filter(([en]) => !names[en]).map(([en, kind]) => `${en} (${kind})`);
  assert.deepEqual(missing.slice(0, 10), [], `${missing.length} names the demo league can show have no Arabic in i18n/names.ar.json: run npm run i18n:names -- auto`);
  // opening the database loaded the file into it
  assert.equal(Object.keys(readDbNames(db)).length >= rows.length, true);
});

test("the real commands on a copy: save, check, load", () => {
  const dir = path.join(tmp, "i18n"); fs.mkdirSync(dir);
  const dbFile = path.join(tmp, "cli.db");
  const db = new DatabaseSync(dbFile);
  db.exec("CREATE TABLE name_translations (en TEXT NOT NULL, locale TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'claude', reviewed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (en, locale))");
  db.exec("CREATE TABLE boxers (id INTEGER PRIMARY KEY, name TEXT, nickname TEXT, aliases TEXT, birth_place TEXT, residence TEXT); CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE orgs (id INTEGER PRIMARY KEY, name TEXT, city TEXT); CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT, venue TEXT, city TEXT, country TEXT, broadcaster TEXT); CREATE TABLE bouts (id INTEGER PRIMARY KEY, title TEXT); CREATE TABLE event_broadcasts (event_id INTEGER, broadcaster TEXT, region TEXT);");
  db.prepare("INSERT INTO boxers (name) VALUES ('Ana Cruz'), ('Bo Lee')").run();
  db.prepare("INSERT INTO name_translations VALUES ('Ana Cruz','ar','آنا كروز','claude-session',0)").run();
  db.close();
  const env = { ...process.env, I18N_DIR: dir, DATABASE_PATH: dbFile, NODE_NO_WARNINGS: "1" };
  const run = (...a: string[]) => spawnSync("npx", ["tsx", "scripts/i18n-names.ts", ...a], { cwd: root, env, encoding: "utf8" });
  const save = run("save"); assert.equal(save.status, 0, save.stderr);
  assert.deepEqual(Object.keys(readNamesFile(path.join(dir, "names.ar.json"))), ["Ana Cruz"]);
  const check = run("check");
  assert.equal(check.status, 1, "Bo Lee has no Arabic yet"); assert.match(check.stdout, /1 names the site can show are missing/); assert.match(check.stdout, /Bo Lee/);
  writeNamesFile({ "Ana Cruz": { ar: "آنا كروز", source: "claude-session", reviewed: false }, "Bo Lee": { ar: "بو لي", source: "editor", reviewed: true } }, path.join(dir, "names.ar.json"));
  assert.equal(run("check").status, 0);
  const load = run("load"); assert.equal(load.status, 0, load.stderr); assert.match(load.stdout, /1 added/);
  assert.equal(readDbNames(new DatabaseSync(dbFile, { readOnly: true }))["Bo Lee"].reviewed, true);
});
