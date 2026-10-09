import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyResult, compareFighter, fightersToLook, isoDate, parseRecordTable, resultsSource, vendorAgrees } from "../lib/watch/results";
import { PROPOSAL_SCHEMA } from "../lib/watch/schema";
import { reconcile } from "../lib/watch/proposals";

/** Results from the record table of a fighter's Wikipedia article (PLAN 270): read from the table's own columns, matched on opponent and date, proposed only. */
const TABLE = (rows: string) => `Intro.\n\n==Professional boxing record==\n{{BoxingRecordSummary\n|draws=\n}}\n{|class="wikitable" style="text-align:center"\n|-\n!{{abbr|No.|Number}}\n!Result\n!Record\n!Opponent\n!Type\n!Round, time\n!Date\n!Location\n!Notes\n${rows}\n|}\n\n==References==\n`;
const ROW = (n: number, res: string, opp: string, type: string, round: string, date: string) => `|-\n|${n}\n|${res}\n|1–0\n|align=left|{{flagicon|MEX}} ${opp}\n|${type}\n|{{small|${round}}}\n|{{small|${date}}}\n|align=left|{{small|[[Arena]], Town}}\n|`;

test("a split draw is a draw, and a decision over a distance we do not hold is not proposed", () => {
  const rows = parseRecordTable(TABLE([ROW(2, "{{draw2|Draw}}", "Bo Lee", "SD", "10", "2026-01-02"), ROW(1, "{{yes2|Win}}", "Cy Day", "UD", "6", "2026-01-01")].join("\n")));
  assert.deepEqual(rows.map((r) => [r.result, r.method]), [["draw", "DRAW"], ["win", "UD"]]);
  const db = world();
  db.exec("UPDATE events SET date = '2026-01-02' WHERE id = 2; UPDATE boxers SET name = 'Cy Day' WHERE id = 2; UPDATE bouts SET rounds = 10 WHERE id = 1; UPDATE events SET date = '2026-01-01' WHERE id = 1");
  const { changes } = compareFighter(db, FIGHTER, rows, "1");
  assert.equal(changes.length, 0, "ours is a 10-round fight and the article says 6: nothing is proposed");
});

test("the record table is read by its header: results, methods, rounds and three date styles", () => {
  const rows = parseRecordTable(TABLE([
    ROW(3, "{{yes2|Win}}", "[[José Núñez]]", "TKO", "2 (10), 1:12", "29 Apr 2026"),
    ROW(2, "{{no2}}Loss", "Bo Lee", "UD", "8", "May 10, 2026"),
    ROW(1, "{{draw2|Draw}}", "Cy Day", "SD", "6", "2026-01-02"),
    ROW(0, "{{yes2}}Win", "Dee Ray", "PTS", "4", "2026-01-01"),
  ].join("\n")));
  assert.deepEqual(rows.map((r) => [r.result, r.opponent, r.method, r.round, r.scheduled, r.date]), [
    ["win", "José Núñez", "TKO", 2, 10, "2026-04-29"], ["loss", "Bo Lee", "UD", 8, 8, "2026-05-10"], ["draw", "Cy Day", "DRAW", 6, 6, "2026-01-02"],
  ], "a points type we do not use (PTS) is left out rather than guessed");
  assert.equal(isoDate("1 January 2026"), "2026-01-01");
  assert.deepEqual(parseRecordTable("==Professional boxing record==\nNo table here."), []);
  assert.deepEqual(parseRecordTable(TABLE("|-\n|1\n|Win").replace("!Opponent\n", "")), [], "a table without an opponent column reads as nothing");
});

const world = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE boxers (id INTEGER PRIMARY KEY, external_id TEXT, name TEXT, wikipedia_title TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT, date TEXT);
    CREATE TABLE bouts (id INTEGER PRIMARY KEY, external_id TEXT, event_id INT, red_id INT, blue_id INT, rounds INT, method TEXT, winner_id INT, end_round INT, status TEXT);
    INSERT INTO boxers VALUES (1,'f1','Ana Cruz','Ana Cruz'),(2,'f2','Jose Nunez',NULL),(3,'f3','Bo Lee',NULL);
    INSERT INTO events VALUES (1,'Card A','2026-04-29'),(2,'Card B','2026-05-11'),(3,'Card C','2099-01-01');
    INSERT INTO bouts VALUES (1,'b1',1,1,2,10,NULL,NULL,NULL,NULL),(2,'b2',2,3,1,8,NULL,NULL,NULL,NULL),(3,'b3',3,1,3,8,NULL,NULL,NULL,NULL);`);
  return db;
};
const FIGHTER = { id: 1, name: "Ana Cruz", title: "Ana Cruz" };
const ART = parseRecordTable(TABLE([ROW(2, "{{yes2|Win}}", "José Núñez", "TKO", "2 (10), 1:12", "29 Apr 2026"), ROW(1, "{{no2|Loss}}", "Bo Lee", "UD", "8", "May 10, 2026")].join("\n")));

test("a row becomes a proposal only when the opponent and the date agree with a fight held without a result", () => {
  const { changes, looked } = compareFighter(world(), FIGHTER, ART, "77");
  assert.deepEqual(changes.map((c) => [c.targetKey, c.new]), [
    ["result|b1|", { method: "TKO", winner: "Ana Cruz", endRound: 2 }],
    ["result|b2|", { method: "UD", winner: "Bo Lee", endRound: 8 }], // May 10 in the article, May 11 on our card: a day's shift is allowed; Bo Lee won, so Ana lost
  ]);
  assert.deepEqual(looked, ["b1", "b2"], "a future card is not looked at");
  assert.equal((changes[0].evidence as { corroboration: string }).corroboration, "single unofficial source");
  assert.match(String((changes[0].evidence as { url: string }).url), /wikipedia\.org\/wiki\/Ana_Cruz#Professional_boxing_record/);
  const none = compareFighter(world(), FIGHTER, ART.map((r) => ({ ...r, opponent: "Somebody Else" })), "77");
  assert.equal(none.changes.length, 0, "a different opponent proposes nothing: the same name on another boxer's article does not match");
});

test("nothing is written by a look; approval writes once and refuses a fight that got a result meanwhile", () => {
  const db = world(), acc = new DatabaseSync(":memory:"); acc.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY); ${PROPOSAL_SCHEMA}`);
  const { changes, looked } = compareFighter(db, FIGHTER, ART, "77");
  const r = reconcile(acc, resultsSource.id, changes, looked.map((x) => `result|${x}|`));
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
  reconcile(acc, resultsSource.id, a.changes, a.looked.map((x) => `result|${x}|`));
  reconcile(acc, resultsSource.id, [], ["result|b9|"]); // a run that looked at some other fight
  assert.equal((acc.prepare("SELECT COUNT(*) c FROM proposals WHERE status = 'pending'").get() as { c: number }).c, 2);
  const b = reconcile(acc, resultsSource.id, [], ["result|b1|"]); // the same fight looked at again, the article no longer says it
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
  assert.ok(!r.changes.some((c) => c.targetKey === "result|b1|"));
  assert.ok(r.refused.some((x) => /disagree/.test(x.reason)));
});

test("an approval finds its fight and winner by the vendor's ids, so a reload that renumbers the rows cannot send it to another fight", () => {
  const db = world();
  const { changes } = compareFighter(db, FIGHTER, ART, "77");
  const p = { kind: changes[0].kind, targetKey: changes[0].targetKey, old: changes[0].old, new: changes[0].new, evidence: changes[0].evidence };
  // the same data loaded again with other row numbers
  db.exec("UPDATE bouts SET id = id + 100; UPDATE boxers SET id = id + 50; UPDATE bouts SET red_id = red_id + 50, blue_id = blue_id + 50");
  assert.deepEqual(applyResult(db, p), { ok: true, changed: true, ratings: true });
  assert.deepEqual({ ...db.prepare("SELECT method, winner_id FROM bouts WHERE external_id = 'b1'").get() }, { method: "TKO", winner_id: 51 });
  assert.equal((db.prepare("SELECT COUNT(*) c FROM bouts WHERE method IS NOT NULL").get() as { c: number }).c, 1);
});

test("a fight that has got a result since is retired from the pending list on the next look", () => {
  const acc = new DatabaseSync(":memory:"); acc.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY); ${PROPOSAL_SCHEMA}`);
  const db = world();
  const a = compareFighter(db, FIGHTER, ART, "77");
  reconcile(acc, resultsSource.id, a.changes, a.looked.map((x) => `result|${x}|`));
  db.exec("UPDATE bouts SET method = 'UD', winner_id = 1 WHERE external_id = 'b1'");
  const b = compareFighter(db, FIGHTER, ART, "77");
  assert.ok(!b.changes.some((c) => c.targetKey === "result|b1|"));
  const r = reconcile(acc, resultsSource.id, b.changes, b.looked.map((x) => `result|${x}|`));
  assert.equal(r.superseded, 1);
});

test("a pending proposal for a fight that has a result now is retired even when its fighters have no open fight left to look at", async () => {
  const fs = await import("node:fs"), os = await import("node:os");
  const dir = fs.mkdtempSync(`${os.tmpdir()}/wr-`);
  fs.writeFileSync(`${dir}/Ana_Cruz.json`, JSON.stringify({ page: "Ana_Cruz", revision: "1", wikitext: TABLE(ROW(1, "{{yes2|Win}}", "José Núñez", "TKO", "2 (10)", "29 Apr 2026")) }));
  const acc = new DatabaseSync(":memory:"); acc.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY); ${PROPOSAL_SCHEMA}`);
  const db = world();
  const { runWatch } = await import("../lib/watch/run");
  const ctx = { main: db, log: () => {}, fetch: { cacheDir: dir } };
  await runWatch("results", ctx, acc);
  assert.equal((acc.prepare("SELECT COUNT(*) c FROM proposals WHERE status = 'pending'").get() as { c: number }).c, 1);
  db.exec("UPDATE bouts SET method = 'UD', winner_id = 1 WHERE external_id IN ('b1', 'b2', 'b3')"); // the vendor has results for all of them now
  await runWatch("results", ctx, acc);
  assert.equal((acc.prepare("SELECT COUNT(*) c FROM proposals WHERE status = 'pending'").get() as { c: number }).c, 0);
});

test("a result is sorted by what the vendor's own copy says: agrees, nothing to compare, or contradicts", () => {
  assert.ok(vendorAgrees("TKO", "KO") && vendorAgrees("KO", "RTD") && vendorAgrees("UD", "UD") && vendorAgrees("PTS", "UD") && vendorAgrees("D", "DRAW"));
  assert.ok(!vendorAgrees("UD", "TKO") && !vendorAgrees("TD", "DRAW") && !vendorAgrees("UD", "NC"));
  const said: Record<string, { outcome: string | null; status: string | null }> = { b1: { outcome: "KO", status: "FINISHED" }, b2: { outcome: "UD", status: "FINISHED" } };
  const { changes } = compareFighter(world(), FIGHTER, ART, "77", (id) => said[id]);
  assert.deepEqual(changes.map((c) => [c.targetKey, c.kind]), [["result|b1|", "result_set"], ["result|b2|", "result_set"]], "TKO and KO agree; UD and UD agree");
  assert.deepEqual((changes[0].evidence as { vendor: unknown }).vendor, { outcome: "KO", status: "FINISHED" });
  const none = compareFighter(world(), FIGHTER, ART, "77", () => undefined).changes;
  assert.deepEqual(none.map((c) => c.kind), ["result_set_alone", "result_set_alone"]);
  const no = compareFighter(world(), FIGHTER, ART, "77", () => ({ outcome: "SD", status: "FINISHED" })).changes;
  assert.deepEqual(no.map((c) => c.kind), ["result_set_conflict", "result_set_conflict"], "TKO against SD contradicts; UD against SD contradicts");
  // every kind can be applied
  const db = world();
  assert.equal(applyResult(db, { kind: "result_set_conflict", targetKey: "result|b1|", old: null, new: null, evidence: changes[0].evidence }).ok, true);
});
