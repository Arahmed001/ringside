import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { miniFeed, makeBoxer, providerOf, tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";

const cleanup = tempDb("ingest");
after(cleanup);
let lib: { ingest: typeof import("../lib/ingest").ingest; getDb: typeof import("../lib/db").getDb; demo: typeof import("../lib/providers/demo").demoProvider };
let db: DatabaseSync;
const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;

before(async () => {
  lib = { ingest: (await import("../lib/ingest")).ingest, getDb: (await import("../lib/db")).getDb, demo: (await import("../lib/providers/demo")).demoProvider };
  db = await lib.getDb(); // seeds the demo league on first open
});

test("the demo league seeds with every table populated and no data-quality problems", () => {
  const minimum: Record<string, number> = { boxers: 500, events: 300, bouts: 3000, people: 200, orgs: 50, team_stints: 2000, weigh_ins: 5000, officials: 5000, scorecards: 3000, corners: 5000, punch_stats: 10000, rating_history: 5000 };
  for (const [t, min] of Object.entries(minimum)) assert.ok(count(`SELECT COUNT(*) c FROM ${t}`) >= min, `${t} should have at least ${min} rows`);
  const run = db.prepare("SELECT errors, warnings FROM ingest_runs ORDER BY id DESC LIMIT 1").get() as { errors: number; warnings: number };
  assert.deepEqual({ ...run }, { errors: 0, warnings: 0 });
});

test("the demo covers every result method, both sexes and all stances", () => {
  const methods = new Set((db.prepare("SELECT DISTINCT method m FROM bouts WHERE method IS NOT NULL").all() as { m: string }[]).map((r) => r.m));
  for (const m of ["KO", "TKO", "RTD", "DQ", "UD", "MD", "SD", "TD", "TDRAW", "DRAW", "NC"]) assert.ok(methods.has(m), `no ${m} bouts in the demo`);
  assert.ok(count("SELECT COUNT(*) c FROM boxers WHERE sex='female'") > 100);
  assert.ok(count("SELECT COUNT(*) c FROM boxers WHERE stance='Switch'") > 0);
  assert.ok(count("SELECT COUNT(*) c FROM bouts WHERE status='cancelled'") > 0);
  assert.ok(count("SELECT COUNT(*) c FROM events WHERE status='cancelled'") > 0 && count("SELECT COUNT(*) c FROM events WHERE status='postponed'") > 0);
});

test("women fight women and men fight men", () => {
  assert.equal(count("SELECT COUNT(*) c FROM bouts b JOIN boxers r ON r.id=b.red_id JOIN boxers u ON u.id=b.blue_id WHERE r.sex != u.sex"), 0);
});

test("scorecards agree with the recorded result in every scored decision", () => {
  const rows = db.prepare(`SELECT b.id, b.method, b.winner_id, b.red_id,
      SUM(s.red_score > s.blue_score) r, SUM(s.blue_score > s.red_score) u, SUM(s.red_score = s.blue_score) e, COUNT(*) n
    FROM bouts b JOIN scorecards s ON s.bout_id = b.id GROUP BY b.id`).all() as { id: number; method: string; winner_id: number | null; red_id: number; r: number; u: number; e: number; n: number }[];
  assert.ok(rows.length > 1000);
  let bad = 0;
  for (const x of rows) {
    if (x.n !== 3) { bad++; continue; }
    const red = x.winner_id === x.red_id, forW = red ? x.r : x.u, forL = red ? x.u : x.r;
    if (x.method === "UD" && forW !== 3) bad++;
    else if (x.method === "SD" && !(forW === 2 && forL === 1)) bad++;
    else if (x.method === "MD" && !(forW === 2 && x.e === 1)) bad++;
    else if (x.method === "TD" && forW < 2) bad++;
  }
  assert.equal(bad, 0);
});

test("re-ingesting the same feed changes nothing", async () => {
  const before = ["team_stints", "weigh_ins", "scorecards", "officials", "corners", "punch_stats", "boxers", "bouts"].map((t) => count(`SELECT COUNT(*) c FROM ${t}`));
  await lib.ingest(db, lib.demo(new Date("2026-10-03")));
  const after = ["team_stints", "weigh_ins", "scorecards", "officials", "corners", "punch_stats", "boxers", "bouts"].map((t) => count(`SELECT COUNT(*) c FROM ${t}`));
  assert.deepEqual(after, before);
});

test("bad rows are quarantined, good rows are written, and the run is recorded", async () => {
  const feed = miniFeed();
  feed.boxers.push(makeBoxer("X", "Catchweight")); // unknown division: dropped
  feed.bouts.push({ externalId: "E1-9", eventExternalId: "E1", redExternalId: "A", blueExternalId: "X", weightClass: "Lightweight", rounds: 10, winnerExternalId: null, method: null, endRound: null, title: null, position: 3 });
  const report = await lib.ingest(db, providerOf(feed, "quarantine-test"));
  assert.ok(report.errors >= 2, `errors: ${report.errors}`);
  assert.equal(report.dropped.boxer, 1);
  assert.equal(count("SELECT COUNT(*) c FROM boxers WHERE external_id = 'X'"), 0, "the bad fighter must not be written");
  assert.equal(count("SELECT COUNT(*) c FROM bouts WHERE external_id = 'E1-9'"), 0, "a bout against a dropped fighter must not be written");
  assert.equal(count("SELECT COUNT(*) c FROM bouts WHERE external_id = 'E1-1'"), 1, "the good bout is written");
  const run = db.prepare("SELECT provider, errors FROM ingest_runs WHERE id = ?").get(report.runId) as { provider: string; errors: number };
  assert.equal(run.provider, "quarantine-test");
  assert.equal(run.errors, report.errors);
  assert.ok(count(`SELECT COUNT(*) c FROM ingest_issues WHERE run_id = ${report.runId}`) >= 2);
});

test("strict mode refuses a feed with errors before touching the database", async () => {
  const feed = miniFeed();
  feed.boxers[0].weightClass = "Nonsense";
  const boxersBefore = count("SELECT COUNT(*) c FROM boxers");
  await assert.rejects(lib.ingest(db, providerOf(feed), { strict: true }), /error/i);
  assert.equal(count("SELECT COUNT(*) c FROM boxers"), boxersBefore);
});

test("slugs stay unique across ingests, even for a fighter with a name already taken", async () => {
  const feed = miniFeed();
  feed.boxers = [makeBoxer("N1"), makeBoxer("N2")];
  feed.boxers[0].name = "Same Name"; feed.boxers[1].name = "Same Name";
  feed.bouts = []; feed.weighIns = []; feed.officials = []; feed.scorecards = []; feed.corners = []; feed.punches = []; feed.stints = [];
  await lib.ingest(db, providerOf(feed));
  await lib.ingest(db, providerOf(feed));
  const slugs = (db.prepare("SELECT slug FROM boxers WHERE name = 'Same Name'").all() as { slug: string }[]).map((r) => r.slug).sort();
  assert.deepEqual(slugs, ["same-name", "same-name-2"]);
});

test("fighters outside any bout keep their sex and stance", async () => {
  const feed = miniFeed();
  feed.boxers = [makeBoxer("W1", "Flyweight", { sex: "female", stance: "Switch" })];
  feed.bouts = []; feed.weighIns = []; feed.officials = []; feed.scorecards = []; feed.corners = []; feed.punches = []; feed.stints = [];
  await lib.ingest(db, providerOf(feed));
  const row = db.prepare("SELECT sex, stance FROM boxers WHERE external_id = 'W1'").get() as { sex: string; stance: string };
  assert.deepEqual({ ...row }, { sex: "female", stance: "Switch" });
});
