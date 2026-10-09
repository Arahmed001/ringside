import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyResult, compareFighter, fightersToLook, isoDate, parseRecordTable, resultsSource } from "../lib/watch/results";
import { PROPOSAL_SCHEMA } from "../lib/watch/schema";
import { reconcile } from "../lib/watch/proposals";

/** Results from the record table of a fighter's Wikipedia article (PLAN 270): read from the table's own columns, matched on opponent and date, proposed only. */
const TABLE = (rows: string) => `Intro.\n\n==Professional boxing record==\n{{BoxingRecordSummary\n|draws=\n}}\n{|class="wikitable" style="text-align:center"\n|-\n!{{abbr|No.|Number}}\n!Result\n!Record\n!Opponent\n!Type\n!Round, time\n!Date\n!Location\n!Notes\n${rows}\n|}\n\n==References==\n`;
const ROW = (n: number, res: string, opp: string, type: string, round: string, date: string) => `|-\n|${n}\n|${res}\n|1–0\n|align=left|{{flagicon|MEX}} ${opp}\n|${type}\n|{{small|${round}}}\n|{{small|${date}}}\n|align=left|{{small|[[Arena]], Town}}\n|`;

test("the record table is read by its header: results, methods, rounds and three date styles", () => {
  const rows = parseRecordTable(TABLE([
    ROW(3, "{{yes2|Win}}", "[[José Núñez]]", "TKO", "2 (10), 1:12", "29 Apr 2026"),
    ROW(2, "{{no2}}Loss", "Bo Lee", "UD", "8", "May 10, 2026"),
    ROW(1, "{{draw2|Draw}}", "Cy Day", "SD", "6", "2026-01-02"),
    ROW(0, "{{yes2}}Win", "Dee Ray", "PTS", "4", "2026-01-01"),
  ].join("\n")));
  assert.deepEqual(rows.map((r) => [r.result, r.opponent, r.method, r.round, r.scheduled, r.date]), [
    ["win", "José Núñez", "TKO", 2, 10, "2026-04-29"], ["loss", "Bo Lee", "UD", 8, 8, "2026-05-10"], ["draw", "Cy Day", "SD", 6, 6, "2026-01-02"],
  ], "a points type we do not use (PTS) is left out rather than guessed");
  assert.equal(isoDate("1 January 2026"), "2026-01-01");
  assert.deepEqual(parseRecordTable("==Professional boxing record==\nNo table here."), []);
  assert.deepEqual(parseRecordTable(TABLE("|-\n|1\n|Win").replace("!Opponent\n", "")), [], "a table without an opponent column reads as nothing");
});

const world = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE boxers (id INTEGER PRIMARY KEY, name TEXT, wikipedia_title TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT, date TEXT);
    CREATE TABLE bouts (id INTEGER PRIMARY KEY, event_id INT, red_id INT, blue_id INT, rounds INT, method TEXT, winner_id INT, end_round INT, status TEXT);
    INSERT INTO boxers VALUES (1,'Ana Cruz','Ana Cruz'),(2,'Jose Nunez',NULL),(3,'Bo Lee',NULL);
    INSERT INTO events VALUES (1,'Card A','2026-04-29'),(2,'Card B','2026-05-11'),(3,'Card C','2099-01-01');
    INSERT INTO bouts VALUES (1,1,1,2,10,NULL,NULL,NULL,NULL),(2,2,3,1,8,NULL,NULL,NULL,NULL),(3,3,1,3,8,NULL,NULL,NULL,NULL);`);
  return db;
};
const FIGHTER = { id: 1, name: "Ana Cruz", title: "Ana Cruz" };
const ART = parseRecordTable(TABLE([ROW(2, "{{yes2|Win}}", "José Núñez", "TKO", "2 (10), 1:12", "29 Apr 2026"), ROW(1, "{{no2|Loss}}", "Bo Lee", "UD", "8", "May 10, 2026")].join("\n")));

test("a row becomes a proposal only when the opponent and the date agree with a fight held without a result", () => {
  const { changes, looked } = compareFighter(world(), FIGHTER, ART, "77");
  assert.deepEqual(changes.map((c) => [c.targetKey, c.new]), [
    ["result|1|", { method: "TKO", winner: "Ana Cruz", endRound: 2 }],
    ["result|2|", { method: "UD", winner: "Bo Lee", endRound: 8 }], // May 10 in the article, May 11 on our card: a day's shift is allowed; Bo Lee won, so Ana lost
  ]);
  assert.deepEqual(looked, [1, 2], "a future card is not looked at");
  assert.equal((changes[0].evidence as { corroboration: string }).corroboration, "single unofficial source");
  assert.match(String((changes[0].evidence as { url: string }).url), /wikipedia\.org\/wiki\/Ana_Cruz#Professional_boxing_record/);
  const none = compareFighter(world(), FIGHTER, ART.map((r) => ({ ...r, opponent: "Somebody Else" })), "77");
  assert.equal(none.changes.length, 0, "a different opponent proposes nothing: the same name on another boxer's article does not match");
});

test("nothing is written by a look; approval writes once and refuses a fight that got a result meanwhile", () => {
  const db = world(), acc = new DatabaseSync(":memory:"); acc.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY); ${PROPOSAL_SCHEMA}`);
  const { changes, looked } = compareFighter(db, FIGHTER, ART, "77");
  const r = reconcile(acc, resultsSource.id, changes, looked.map((id) => `result|${id}|`));
  assert.equal(r.added, 2);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM bouts WHERE method IS NOT NULL").get() as { c: number }).c, 0);
  const p = (c: (typeof changes)[number]) => ({ kind: c.kind, targetKey: c.targetKey, old: c.old, new: c.new, evidence: c.evidence });
  assert.deepEqual(applyResult(db, p(changes[0])), { ok: true, changed: true, ratings: true });
  assert.deepEqual({ ...db.prepare("SELECT method, winner_id, end_round FROM bouts WHERE id = 1").get() }, { method: "TKO", winner_id: 1, end_round: 2 });
  assert.deepEqual(applyResult(db, p(changes[0])), { ok: false, error: "stale" }, "a second approval does not overwrite");
  db.prepare("UPDATE bouts SET method = 'KO', winner_id = 3 WHERE id = 2").run();
  assert.deepEqual(applyResult(db, p(changes[1])), { ok: false, error: "stale" }, "the vendor's own result wins");
  assert.deepEqual(applyResult(db, { ...p(changes[0]), evidence: {} }), { ok: false, error: "bad_proposal" });
});

test("a limited run retires proposals only for the fights it looked at", () => {
  const acc = new DatabaseSync(":memory:"); acc.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY); ${PROPOSAL_SCHEMA}`);
  const db = world();
  const a = compareFighter(db, FIGHTER, ART, "77");
  reconcile(acc, resultsSource.id, a.changes, a.looked.map((id) => `result|${id}|`));
  reconcile(acc, resultsSource.id, [], ["result|9|"]); // a run that looked at some other fight
  assert.equal((acc.prepare("SELECT COUNT(*) c FROM proposals WHERE status = 'pending'").get() as { c: number }).c, 2);
  const b = reconcile(acc, resultsSource.id, [], ["result|1|"]); // the same fight looked at again, the article no longer says it
  assert.equal(b.superseded, 1);
});

test("only fighters with an article and a past fight with no result are looked up", () => {
  assert.deepEqual(fightersToLook(world()).map((f) => f.name), ["Ana Cruz"]);
});

test("two articles that disagree on one fight propose nothing for it", async () => {
  const db = world();
  db.exec("UPDATE boxers SET wikipedia_title = 'Jose Nunez' WHERE id = 2");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(`${os.tmpdir()}/wr-`);
  const page = (title: string, rows: string) => fs.writeFileSync(`${dir}/${title.replace(/[^A-Za-z0-9_-]/g, "_")}.json`, JSON.stringify({ page: title.replace(/ /g, "_"), revision: "1", wikitext: TABLE(rows) }));
  page("Ana Cruz", ROW(1, "{{yes2|Win}}", "José Núñez", "TKO", "2 (10)", "29 Apr 2026"));
  page("Jose Nunez", ROW(1, "{{yes2|Win}}", "Ana Cruz", "KO", "3 (10)", "29 Apr 2026")); // both say they won
  const r = await resultsSource.run!({ main: db, log: () => {}, fetch: { cacheDir: dir } });
  assert.ok(!r.changes.some((c) => c.targetKey === "result|1|"));
  assert.ok(r.refused.some((x) => /disagree/.test(x.reason)));
});
