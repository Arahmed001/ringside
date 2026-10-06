import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { EMPTY_META, applyReview, glossaryReport, groupOf, hashOf, qaEntry, statusOf, stemOf, summarise, type ReviewFile } from "../lib/i18n/review";
import { buildSheet } from "../lib/i18n/review-sheet";
import { extractKeys, checkDict } from "../lib/i18n/extract";
import type { Dict } from "../lib/i18n/t";

const root = process.cwd();
const REAL = JSON.parse(fs.readFileSync(path.join(root, "i18n", "ar.json"), "utf8")) as Dict;
const GLOSSARY = JSON.parse(fs.readFileSync(path.join(root, "i18n", "glossary.json"), "utf8")) as Record<string, string>;
const codes = (key: string, v: Dict[string], o: Parameters<typeof qaEntry>[2] = {}) => qaEntry(key, v, o).map((f) => f.code);

test("the mechanical checks find each kind of slip, and leave fine Arabic alone", () => {
  assert.deepEqual(codes("Hello {name}", "مرحبًا"), ["placeholders"]);
  assert.deepEqual(codes("Hello {name}", "مرحبًا {name} و{other}"), ["placeholders"]);
  assert.deepEqual(codes("<b>Bold</b> text", "نص <b>غامق"), ["placeholders"]);
  assert.deepEqual(codes("{n} things", { zero: "لا شيء", one: "شيء", two: "", few: "{n} أشياء", many: "{n} شيئًا", other: "{n} شيء" }, { plural: true }), ["plural"]);
  assert.ok(codes("Wins", "Victories and انتصارات").includes("latin"));
  assert.ok(codes("Wins", "٣ انتصارات").includes("digits"));
  assert.ok(codes("Two things", "شيئان, وثالث").includes("punctuation"));
  assert.ok(codes("Why?", "لماذا?").includes("punctuation"));
  assert.ok(codes("Quote", 'قال "نعم"').includes("punctuation"));
  assert.ok(codes("Space", "كلمة ،أخرى").includes("spacing") || codes("Space", "كلمة ، أخرى").includes("spacing"));
  assert.ok(codes("Double", "كلمة  أخرى").includes("spacing"));
  assert.ok(codes("Same", "Same words here").includes("untranslated") === false); // untranslated needs no Arabic at all AND identical text
  assert.ok(codes("Some words here", "Some words here").includes("untranslated"));
  // fine: brands, abbreviations, code paths, setting names, a tatweel before a digit or a placeholder
  assert.deepEqual(codes("BoxRec", "BoxRec"), []);
  assert.deepEqual(codes("Elo and KO", "إيلو و KO"), []);
  assert.deepEqual(codes("Add an ANTHROPIC_API_KEY", "أضف ANTHROPIC_API_KEY"), []);
  assert.deepEqual(codes("See docs/research.md", "راجع docs/research.md"), []);
  assert.deepEqual(codes("With 4+ bouts", "بـ4 نزالات"), []);
  assert.deepEqual(codes("The next {n}", "الـ {n} التالية"), []);
  assert.ok(codes("Word", "كلـمة").includes("spacing"), "a tatweel in the middle of a word is flagged");
});

test("notes: gendered English, numbers that disappear, and the glossary (which survives inflection and broken plurals)", () => {
  assert.ok(qaEntry("How she wins", "كيف تفوز").some((f) => f.code === "gender" && f.severity === "note"));
  assert.ok(qaEntry("Both are top-10", "كلاهما ضمن أفضل عشرة").some((f) => f.code === "numbers" && f.severity === "note"));
  const g = { title: "لقب", belt: "حزام", knockout: "ضربة قاضية" };
  assert.deepEqual(qaEntry("Title lineages", "سلاسل الألقاب", { glossary: g }).map((f) => f.code), [], "الألقاب is a broken plural of لقب");
  assert.deepEqual(qaEntry("The belt", "الأحزمة كلها", { glossary: g }).map((f) => f.code), [], "plural of حزام");
  assert.ok(qaEntry("The belt", "السوار", { glossary: g }).some((f) => f.code === "glossary"));
  assert.equal(stemOf("ضربة قاضية"), "ضرب");
  assert.deepEqual(qaEntry("KO rate", "نسبة الحسم", { glossary: { KO: "ضربة قاضية" } }).map((f) => f.code), [], "terms kept in Latin are not looked for in Arabic");
});

test("a review only counts for the exact Arabic the reviewer saw", () => {
  const dict: Dict = { "Hello": "مرحبًا", "{n} things": { zero: "a", one: "b", two: "c", few: "d", many: "e", other: "f" } };
  const meta = EMPTY_META();
  assert.equal(statusOf("Hello", dict, meta), "machine");
  meta.keys["Hello"] = { by: "R", at: "2026-10-04", hash: hashOf(dict["Hello"]) };
  assert.equal(statusOf("Hello", dict, meta), "reviewed");
  assert.equal(statusOf("Hello", { ...dict, Hello: "أهلًا" }, meta), "changed", "edited after review: needs another look");
  assert.deepEqual(summarise(["Hello", "{n} things", "Gone"], dict, meta), { total: 3, machine: 2, reviewed: 1, changed: 0, flagged: 0 });
  assert.notEqual(hashOf({ one: "a", other: "b" } as never), hashOf({ one: "a", other: "c" } as never));
});

const KNOWN = new Map<string, { plural?: string }>([["Hello {name}", {}], ["{n} fights", { plural: "{n} fight" }], ["Plain", {}]]);
const DICT: Dict = { "Hello {name}": "مرحبًا {name}", "{n} fights": { zero: "لا نزالات", one: "نزال", two: "نزالان", few: "{n} نزالات", many: "{n} نزالًا", other: "{n} نزال" }, "Plain": "عادي" };
const file = (entries: ReviewFile["entries"]): ReviewFile => ({ format: "ringside-arabic-review/1", reviewer: "Sara", at: "2026-10-04T10:00:00Z", entries });

test("importing a review: approvals, edits and flags are recorded; bad entries are rejected one by one", () => {
  const r = applyReview(file([
    { key: "Plain", status: "approved" },
    { key: "Hello {name}", status: "edited", ar: "أهلًا {name}" },
    { key: "{n} fights", status: "flagged", note: "dual form?" },
    { key: "Nope", status: "approved" },
    { key: "Hello {name}", status: "edited", ar: "أهلًا" },
  ]), DICT, EMPTY_META(), KNOWN);
  assert.deepEqual([r.approved, r.edited, r.flagged], [1, 1, 1]);
  assert.equal(r.dict["Hello {name}"], "أهلًا {name}", "the later bad edit did not overwrite the good one");
  assert.deepEqual(r.rejected.map((x) => [x.key, /not a key|placeholders/.test(x.reason)]), [["Nope", true], ["Hello {name}", true]]);
  assert.equal(statusOf("Plain", r.dict, r.meta), "reviewed");
  assert.equal(statusOf("Hello {name}", r.dict, r.meta), "reviewed");
  assert.equal(statusOf("{n} fights", r.dict, r.meta), "machine", "flagged is not reviewed");
  assert.equal(r.meta.flagged["{n} fights"].note, "dual form?");
  assert.deepEqual(r.meta.reviews, [{ by: "Sara", at: "2026-10-04", approved: 1, edited: 1, flagged: 1 }]);
  // approving a flagged string later clears the flag; nothing mutated the inputs
  const r2 = applyReview(file([{ key: "{n} fights", status: "approved" }]), r.dict, r.meta, KNOWN);
  assert.equal(r2.meta.flagged["{n} fights"], undefined); assert.equal(statusOf("{n} fights", r2.dict, r2.meta), "reviewed");
  assert.equal(DICT["Hello {name}"], "مرحبًا {name}");
});

test("a file that edits a string and then approves it records the hash of the edited text, not the old one", () => {
  const r = applyReview(file([{ key: "Plain", status: "edited", ar: "عادي جدًا" }, { key: "Plain", status: "approved" }]), DICT, EMPTY_META(), KNOWN);
  assert.equal(r.dict["Plain"], "عادي جدًا");
  assert.equal(statusOf("Plain", r.dict, r.meta), "reviewed");
});

test("a plural edit needs all six forms and no empty ones; wrong formats and anonymous files are refused", () => {
  const bad = applyReview(file([{ key: "{n} fights", status: "edited", ar: { zero: "x", one: "", two: "x", few: "x", many: "x", other: "x" } as never }, { key: "Plain", status: "edited", ar: "   " }]), DICT, EMPTY_META(), KNOWN);
  assert.equal(bad.edited, 0); assert.equal(bad.rejected.length, 2);
  assert.throws(() => applyReview({ ...file([]), format: "other" as never }, DICT, EMPTY_META(), KNOWN), /format/);
  assert.throws(() => applyReview({ ...file([]), reviewer: " " }, DICT, EMPTY_META(), KNOWN), /reviewer/);
});

test("importing the same file twice changes nothing the second time", () => {
  const f = file([{ key: "Plain", status: "approved" }, { key: "Hello {name}", status: "edited", ar: "أهلًا {name}" }]);
  const once = applyReview(f, DICT, EMPTY_META(), KNOWN);
  const twice = applyReview(f, once.dict, once.meta, KNOWN);
  assert.deepEqual(twice.dict, once.dict); assert.deepEqual(twice.meta.keys, once.meta.keys);
});

test("groups put the most-seen text first and unknown files fall to Other", () => {
  assert.equal(groupOf(["app/[locale]/layout.tsx"]), "Navigation, header and footer");
  assert.equal(groupOf(["app/[locale]/page.tsx"]), "Home page");
  assert.equal(groupOf(["app/[locale]/ask/page.tsx"]), "Ask the data");
  assert.equal(groupOf(["lib/whatever.ts"]), "Other");
  assert.ok(glossaryReport({ "Knockout rate": "نسبة الحسم", "Knockout": "ضربة قاضية" }, { knockout: "ضربة قاضية" })[0].missing.length === 1);
});

test("the review sheet is one offline page: every string in it, valid script, nothing loaded from the web, safe against markup in the data", () => {
  const entries = Object.keys(REAL).slice(0, 30).map((k) => ({ key: k, group: "Other", files: [], plural: null, ar: REAL[k], status: "machine" as const, flags: [] }));
  entries.push({ key: "</script><img src=x onerror=alert(1)>", group: "Other", files: [], plural: null, ar: "x", status: "machine", flags: [] });
  const html = buildSheet({ build: "abc", generatedAt: "now", entries, groups: ["Other"], glossary: [], names: [{ en: "A", ar: "ا", source: "t", reviewed: false }], questions: [{ title: "Q", body: "B" }] });
  assert.ok(!/(src|href)=["']https?:/i.test(html) && !/@import|<link/i.test(html), "nothing is fetched from the web");
  assert.equal((html.match(/<script/g) ?? []).length, 2, "the injected </script> did not open a third script");
  const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];
  assert.doesNotThrow(() => new vm.Script(js), "the sheet's script parses");
  const data = JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]);
  assert.equal(data.entries.length, 31); assert.equal(data.entries[30].key, "</script><img src=x onerror=alert(1)>");
  assert.match(html, /Download my review/); assert.match(html, /ringside-arabic-review\/1/);
});

test("the real dictionary: nothing is reviewed without a record, no mechanical problem with placeholders or plurals, no stale review entries", () => {
  const metaFile = path.join(root, "i18n", "ar.review.json");
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : EMPTY_META();
  for (const k of Object.keys(meta.keys ?? {})) assert.ok(k in REAL, `a review entry for a string that no longer exists: ${k}`);
  const { found } = extractKeys();
  const s = summarise([...found.keys()], REAL, { ...EMPTY_META(), ...meta });
  assert.equal(s.reviewed + s.changed + s.machine, found.size);
  const hard = [...found].flatMap(([k, f]) => qaEntry(k, REAL[k], { plural: f.plural !== undefined, glossary: GLOSSARY }).filter((x) => x.code === "placeholders" || x.code === "plural").map((x) => `${k}: ${x.note}`));
  assert.deepEqual(hard, []);
  assert.equal(checkDict(REAL, found).missing.length, 0);
});

test("the real commands: export a sheet, import a reviewer's file, and the status moves (run on a copy, names included)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-review-"));
  try {
    fs.cpSync(path.join(root, "i18n"), path.join(tmp, "i18n"), { recursive: true });
    fs.rmSync(path.join(tmp, "i18n", "ar.review.json"), { force: true });
    fs.rmSync(path.join(tmp, "i18n", "names.ar.json"), { force: true }); // start with no names file: the sheet then falls back to the database's names
    const dbFile = path.join(tmp, "t.db");
    const db = new DatabaseSync(dbFile);
    db.exec("CREATE TABLE name_translations (en TEXT NOT NULL, locale TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'claude', reviewed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (en, locale))");
    db.prepare("INSERT INTO name_translations VALUES ('Ana Cruz','ar','آنا كروز','claude-session',0)").run();
    db.prepare("INSERT INTO name_translations VALUES ('Bo Lee','ar','بو لي','claude-session',0)").run();
    db.close();
    const env = { ...process.env, I18N_DIR: path.join(tmp, "i18n"), DATABASE_PATH: dbFile, NODE_NO_WARNINGS: "1", REVIEW_OUT: path.join(tmp, "out") };
    const run = (...a: string[]) => spawnSync("npx", ["tsx", "scripts/i18n-review.ts", ...a], { cwd: root, env, encoding: "utf8" });
    const sheet = path.join(tmp, "sheet.html");
    const ex = run("export", sheet);
    assert.equal(ex.status, 0, ex.stderr);
    const html = fs.readFileSync(sheet, "utf8");
    const data = JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]);
    assert.equal(data.entries.length, extractKeys().found.size); assert.deepEqual(data.names.map((n: { en: string }) => n.en), ["Ana Cruz", "Bo Lee"]);
    const first = data.entries.find((e: { plural: unknown; ar: unknown }) => e.plural === null && typeof e.ar === "string" && !/\{|</.test(e.ar)) as { key: string; ar: string };
    const review: ReviewFile & { answers: Record<string, string> } = {
      format: "ringside-arabic-review/1", reviewer: "Test Reviewer", at: "2026-10-04T09:00:00Z", build: data.build,
      entries: [{ key: first.key, status: "edited", ar: first.ar + " (معدّل)" }, { key: data.entries.find((e: { key: string }) => e.key !== first.key).key, status: "approved" }],
      names: [{ en: "Ana Cruz", ar: "آنا كروث", status: "edited" }, { en: "Bo Lee", ar: "بو لي", status: "approved" }],
      glossary: [{ term: "belt", ar: "حزام البطولة" }], answers: { Register: "fine" },
    };
    const f = path.join(tmp, "review.json"); fs.writeFileSync(f, JSON.stringify(review));
    const im = run("import", f);
    assert.equal(im.status, 0, im.stderr + im.stdout);
    assert.match(im.stdout, /1 approved as they were, 1 edited, 0 flagged for discussion, 0 rejected/); assert.match(im.stdout, /names: 2 stored as reviewed/);
    const dict = JSON.parse(fs.readFileSync(path.join(tmp, "i18n", "ar.json"), "utf8")) as Dict;
    assert.equal(dict[first.key], first.ar + " (معدّل)");
    const meta = JSON.parse(fs.readFileSync(path.join(tmp, "i18n", "ar.review.json"), "utf8"));
    assert.equal(meta.keys[first.key].by, "Test Reviewer"); assert.equal(meta.keys[first.key].hash, hashOf(dict[first.key]));
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, "i18n", "glossary.json"), "utf8")).belt, "حزام البطولة");
    const d2 = new DatabaseSync(dbFile, { readOnly: true });
    assert.deepEqual(d2.prepare("SELECT en, text, source, reviewed FROM name_translations ORDER BY en").all().map((r) => ({ ...r })), [
      { en: "Ana Cruz", text: "آنا كروث", source: "editor", reviewed: 1 }, { en: "Bo Lee", text: "بو لي", source: "claude-session", reviewed: 1 }]);
    d2.close();
    // the reviewed names were written back to the committed file, with the edit and the review flag
    const names = JSON.parse(fs.readFileSync(path.join(tmp, "i18n", "names.ar.json"), "utf8"));
    assert.deepEqual(names["Ana Cruz"], { ar: "آنا كروث", source: "editor", reviewed: true });
    assert.deepEqual(names["Bo Lee"], { ar: "بو لي", source: "claude-session", reviewed: true });
    const st = run("status");
    assert.match(st.stdout, /reviewed by a person 2, changed since review 0/); assert.match(st.stdout, /Names: 2, reviewed by a person 2/);
    assert.ok(fs.readdirSync(path.join(tmp, "out")).some((x) => x.startsWith("answers-")), "the answers were saved");
    // the real files were not touched
    assert.ok(!fs.existsSync(path.join(root, "i18n", "ar.review.json")) || !JSON.parse(fs.readFileSync(path.join(root, "i18n", "ar.review.json"), "utf8")).reviews?.some((r: { by: string }) => r.by === "Test Reviewer"));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("export --first N: only the N most-seen strings, in the full sheet's order, with no names unless asked for; an answer from it imports", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-review-first-"));
  try {
    fs.cpSync(path.join(root, "i18n"), path.join(tmp, "i18n"), { recursive: true });
    fs.rmSync(path.join(tmp, "i18n", "ar.review.json"), { force: true });
    const env = { ...process.env, I18N_DIR: path.join(tmp, "i18n"), DATABASE_PATH: path.join(tmp, "none.db"), NODE_NO_WARNINGS: "1", REVIEW_OUT: path.join(tmp, "out") };
    const run = (...a: string[]) => spawnSync("npx", ["tsx", "scripts/i18n-review.ts", ...a], { cwd: root, env, encoding: "utf8" });
    const read = (f: string) => JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(fs.readFileSync(f, "utf8"))![1]);
    const full = path.join(tmp, "full.html"), part = path.join(tmp, "part.html"), withNames = path.join(tmp, "names.html");
    assert.equal(run("export", full).status, 0);
    const ex = run("export", part, "--first", "120");
    assert.equal(ex.status, 0, ex.stderr);
    assert.match(ex.stdout, /120 of \d+ strings, 0 names/);
    const a = read(full), b = read(part);
    assert.equal(b.entries.length, 120);
    const needJudging = a.entries.filter((e: { key: string; ar: unknown }) => !(typeof e.ar === "string" && e.ar === e.key));
    assert.deepEqual(b.entries.map((e: { key: string }) => e.key), needJudging.slice(0, 120).map((e: { key: string }) => e.key), "the same strings, in the same most-seen-first order, without those that are the English unchanged");
    assert.ok(a.entries.some((e: { key: string; ar: unknown }) => typeof e.ar === "string" && e.ar === e.key), "(the full sheet does hold some of those)");
    assert.ok(!b.entries.some((e: { key: string; ar: unknown }) => typeof e.ar === "string" && e.ar === e.key), "and the first pass holds none");
    assert.equal(b.names.length, 0, "the names tab is left out of a first pass");
    assert.equal(b.build, a.build, "one build tag, so an answer from either sheet imports the same way");
    assert.equal(run("export", withNames, "--first", "120", "--names").status, 0);
    assert.equal(read(withNames).names.length, a.names.length);
    assert.notEqual(run("export", part, "--first", "0").status, 0, "a nonsense count is refused");
    // an answer to the partial sheet imports like any other, and the strings it did not show stay machine-written
    const k = b.entries.find((e: { plural: unknown; ar: unknown }) => e.plural === null && typeof e.ar === "string" && !/\{|</.test(e.ar)).key as string;
    const f = path.join(tmp, "r.json");
    fs.writeFileSync(f, JSON.stringify({ format: "ringside-arabic-review/1", reviewer: "T", at: "2026-10-06T09:00:00Z", build: b.build, entries: [{ key: k, status: "approved" }], names: [], glossary: [] }));
    const im = run("import", f);
    assert.equal(im.status, 0, im.stderr + im.stdout);
    assert.match(im.stdout, /1 approved as they were, 0 edited, 0 flagged for discussion, 0 rejected/);
    assert.match(run("status").stdout, new RegExp(`reviewed by a person 1, changed since review 0, machine-written ${a.entries.length - 1}`));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
