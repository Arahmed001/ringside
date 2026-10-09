import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { candidates, composeName, composedNames, readWordsFile, writeWordsFile, type WordsFile } from "../lib/i18n/name-words";
import { sheet } from "../lib/i18n/name-words-sheet";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-words-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const w = (ar: string, reviewed: boolean) => ({ ar, source: "t", reviewed });
const words: WordsFile = { Jose: w("خوسيه", true), Luis: w("لويس", true), Garcia: w("غارسيا", false), Cruz: w("كروز", true) };

test("a name is composed only from words a person has reviewed", () => {
  assert.equal(composeName("Jose Luis Cruz", words), "خوسيه لويس كروز");
  assert.equal(composeName("Jose Garcia", words), null, "a machine suggestion is never shown");
  assert.equal(composeName("Jose Unknown", words), null);
  assert.equal(composeName("Jose", words), null, "a one-word name is reviewed as a whole name");
});

test("composed names fill only the gaps, and need reviewed words to appear at all", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE boxers (name TEXT); CREATE TABLE people (name TEXT); INSERT INTO boxers VALUES ('Jose Cruz'),('Luis Cruz'),('Jose Garcia'); INSERT INTO people VALUES ('Luis Jose')");
  assert.deepEqual(composedNames(db, { "Luis Cruz": "لويس كروز (whole)" }, words), { "Jose Cruz": "خوسيه كروز", "Luis Jose": "لويس خوسيه" });
  assert.deepEqual(composedNames(db, {}, { Jose: w("خوسيه", false) }), {}, "no reviewed words, nothing composed");
});

test("candidates are ranked by fighters and count the names each word completes", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE boxers (name TEXT); INSERT INTO boxers VALUES ('Ana Cruz'),('Ana Diaz'),('Bo Cruz'),('Cy Cruz'),('Whole Name')");
  const c = candidates(db, { "Whole Name": "x" }, { Ana: w("آنا", true) });
  assert.deepEqual(c.map((x) => [x.word, x.fighters]), [["Cruz", 3], ["Bo", 1], ["Cy", 1], ["Diaz", 1]], "a reviewed word and a name that already has a whole entry are left out");
  assert.deepEqual(c.map((x) => x.fully), [1, 2, 3, 4], "Cruz completes Ana Cruz; Bo then Bo Cruz; Cy then Cy Cruz; Diaz then Ana Diaz");
});

test("suggest never overwrites a reviewed word; import marks reviewed and refuses Latin letters", () => {
  const dir = path.join(tmp, "i18n"); fs.mkdirSync(dir);
  writeWordsFile({ Jose: w("خوسيه", true) }, path.join(dir, "name-words.ar.json"));
  const run = (...a: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/i18n-words.ts", ...a], { env: { ...process.env, I18N_DIR: dir, DATABASE_PATH: path.join(tmp, "none.db") }, encoding: "utf8" });
  const sug = path.join(tmp, "s.json"); fs.writeFileSync(sug, JSON.stringify({ Jose: "جوزيه", Ana: "آنا", Bad: "Bad" }));
  assert.match(run("suggest", sug).stdout, /1 suggestions stored, 1 reviewed words left alone, 1 skipped/);
  let f = readWordsFile(path.join(dir, "name-words.ar.json"));
  assert.deepEqual([f.Jose, f.Ana], [w("خوسيه", true), { ar: "آنا", source: "claude-session", reviewed: false }].map((x, i) => (i ? x : { ...x, source: "t" })));
  const rev = path.join(tmp, "r.json"); fs.writeFileSync(rev, JSON.stringify({ words: { Ana: { ar: "آنا" }, Cy: { ar: "سي", edited: true }, Oops: { ar: "Oops" } } }));
  assert.match(run("import", rev).stdout, /1 approved, 1 edited, 1 refused/);
  f = readWordsFile(path.join(dir, "name-words.ar.json"));
  assert.equal(f.Ana.reviewed, true); assert.equal(f.Cy.source, "reviewer");
});

test("the review sheet loads nothing from the web and escapes the data", () => {
  const html = sheet([{ word: "</script><b>", fighters: 3, fully: 2, suggestion: "س" }]);
  assert.ok(!/https?:\/\//.test(html));
  assert.ok(!html.includes("</script><b>"), "a word cannot close the script early");
});

test("the committed word list holds Arabic only, and no word is marked reviewed by a script", () => {
  const f = readWordsFile(path.join(process.cwd(), "i18n", "name-words.ar.json"));
  for (const [k, e] of Object.entries(f)) {
    assert.ok(!/[A-Za-z]/.test(e.ar), `${k}: Latin letters in the Arabic`);
    if (e.reviewed) assert.equal(e.source, "reviewer", `${k}: reviewed words come from the review import`);
  }
});
