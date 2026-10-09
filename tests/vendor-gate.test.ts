import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { makeBoxer, miniFeed, providerOf, tempDb } from "./helpers";
import type { FeedData } from "../lib/feed";

/**
 * The vendor update gate, step D1 (docs/vendor-gate-plan.md): it only OBSERVES. What must hold: a report says exactly what an update changed in rows we hold and what the policy
 * would hold; new rows and odds are not counted as changes to wait for; a fight's result is one change and a fighter's totals follow it; a report-mode update is rolled back
 * completely; an observed update commits exactly what an unobserved one would; and nothing the gate does can stop an update.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("vendor-gate");
after(cleanup);

let db: DatabaseSync;
let ingest: typeof import("../lib/ingest").ingest;
let gate: typeof import("../lib/watch/vendor-gate");
let policy: typeof import("../lib/watch/vendor-policy");

/** a league of two decided fights and one scheduled fight (C v D, in the future), each fighter with career totals */
function league(): FeedData {
  const f = miniFeed();
  f.boxers = [makeBoxer("A", "Lightweight", { careerRecord: { wins: 10, losses: 1, draws: 0, koWins: 6, stopped: 0 } }), makeBoxer("B", "Lightweight", { careerRecord: { wins: 9, losses: 2, draws: 0, koWins: 4, stopped: 1 } }),
    makeBoxer("C", "Lightweight", { careerRecord: { wins: 5, losses: 0, draws: 0, koWins: 3, stopped: 0 } }), makeBoxer("D", "Lightweight", { careerRecord: { wins: 4, losses: 1, draws: 0, koWins: 2, stopped: 0 } })];
  f.events.push({ externalId: "E2", name: "Next Night", date: "2026-10-01", venue: "Arena", city: "Las Vegas", country: "United States" });
  f.bouts.push({ externalId: "E2-1", eventExternalId: "E2", redExternalId: "C", blueExternalId: "D", weightClass: "Lightweight", rounds: 10, winnerExternalId: null, method: null, endRound: null, title: null, position: 0, oddsRed: 1.5, oddsBlue: 2.6 });
  return f;
}
const settings = () => policy.gateSettings({});
/** providerOf plus the rankings (the helper has none) */
const prov = (feed: FeedData) => ({ ...providerOf(feed), fetchOfficialRankings: async () => feed.officialRankings });
const run = async (feed: FeedData, mode: "observe" | "report" | null, lines: string[] = []) => {
  const hooks = mode ? gate.gateHooks({ mode, settings: settings(), log: (m) => lines.push(m), baseline: false }) : undefined;
  await ingest(db, prov(feed), { gate: hooks });
  return hooks;
};
/** puts the database back to the base league, unobserved, so each test starts from the same place */
const fresh = async () => { await ingest(db, prov(league())); };
const dump = () => JSON.stringify(["boxers", "events", "bouts", "orgs", "people", "weigh_ins", "scorecards", "ingest_runs"].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()));

before(async () => {
  db = await (await import("../lib/db")).getDb();
  ({ ingest } = await import("../lib/ingest"));
  gate = await import("../lib/watch/vendor-gate"); policy = await import("../lib/watch/vendor-policy");
  await ingest(db, prov(league()));
});

test("the policy: every gated column exists in the schema, the result and the totals move as groups, and odds and pictures pass", async () => {
  for (const f of policy.POLICY) {
    const have = (db.prepare(`PRAGMA table_info(${f.table})`).all() as { name: string }[]).map((c) => c.name);
    assert.ok(have.includes(f.column), `${f.table}.${f.column} is in the policy but not in the table`);
  }
  assert.deepEqual(policy.POLICY.filter((f) => f.group === "result").map((f) => f.column).sort(), ["end_round", "kd_blue", "kd_red", "method", "round_time", "status", "vendor_scores", "winner_id"]);
  for (const c of ["odds_red", "odds_blue"]) assert.equal(policy.policyFor("bouts", c)!.rule, "pass");
  for (const [t, c] of [["boxers", "photo_url"], ["events", "poster_url"]] as const) assert.equal(policy.policyFor(t, c)!.rule, "pass");
  assert.equal(policy.policyFor("boxers", "height_cm")!.rule, "wait", "a blank filled waits too (decision 1)");
});

test("the settings: off by default, observe is the only other mode, a bad value is ignored with a warning", () => {
  assert.deepEqual([policy.gateSettings({}).mode, policy.gateSettings({ VENDOR_GATE: "observe" }).mode, policy.gateSettings({ VENDOR_GATE: "0" }).mode], ["off", "observe", "off"]);
  const bad = policy.gateSettings({ VENDOR_GATE: "hold", VENDOR_GATE_MAX_FIELD_SHARE: "7", VENDOR_GATE_MAX_NIGHT: "x" });
  assert.equal(bad.mode, "off"); assert.equal(bad.maxFieldShare, 0.3); assert.equal(bad.maxNight, 2000); assert.equal(bad.warnings.length, 3);
});

test("a night with no changes says so: nothing waits, new rows are counted apart, and the guard lets it through", async () => {
  await fresh();
  const lines: string[] = [];
  const h = await run(league(), "observe", lines);
  const r = h!.last()!;
  assert.equal(r.wouldHold, 0); assert.deepEqual(r.refuse, []);
  assert.equal(r.touched.boxers, 4); assert.equal(r.newRows.boxers, 0);
  assert.match(lines.join("\n"), /would wait for an administrator: 0 change\(s\) \(none\)/);
});

test("new rows go in and are not changes; odds moving passes; a fighter's height corrected waits, with old, new and the size of the change", async () => {
  await fresh();
  const f = league();
  f.boxers.push(makeBoxer("E", "Lightweight")); // new fighter
  f.boxers.find((b) => b.externalId === "A")!.heightCm = 178; // 175 -> 178
  f.boxers.find((b) => b.externalId === "B")!.heightCm = 170; // 175 -> 170
  f.bouts.find((b) => b.externalId === "E2-1")!.oddsRed = 1.4; // odds move
  const r = (await run(f, "observe"))!.last()!;
  assert.equal(r.newRows.boxers, 1);
  assert.equal(r.passes["bouts.odds_red"], 1);
  const h = r.fields.find((x) => x.key === "boxers.height_cm")!;
  assert.deepEqual([h.changes, h.replaces, h.fills, h.clears, h.medianDelta, h.maxDelta], [2, 2, 0, 0, 4, 5]);
  assert.deepEqual(h.samples.map((s) => [s.label, s.old, s.new]).sort(), [["Fighter A", 175, 178], ["Fighter B", 175, 170]]);
  assert.equal(r.wouldHold, 2, "the new fighter and the odds are not changes to wait for");
  assert.ok(!r.fields.some((x) => x.key.startsWith("bouts.odds")), "odds are never listed as waiting");
});

test("a result arriving for a scheduled fight is ONE change per fight, and the fighters' totals ride with it instead of being counted again", async () => {
  await fresh();
  const f = league();
  const b = f.bouts.find((x) => x.externalId === "E2-1")!;
  Object.assign(b, { winnerExternalId: "C", method: "KO", endRound: 3, status: "completed" });
  f.boxers.find((x) => x.externalId === "C")!.careerRecord = { wins: 6, losses: 0, draws: 0, koWins: 4, stopped: 0 };
  f.boxers.find((x) => x.externalId === "D")!.careerRecord = { wins: 4, losses: 2, draws: 0, koWins: 2, stopped: 1 };
  const lines: string[] = [];
  const r = (await run(f, "observe", lines))!.last()!;
  assert.deepEqual([r.results.arrived, r.results.changed, r.results.cleared], [1, 0, 0]);
  assert.match(r.results.samples[0].label, /Fighter C vs Fighter D/);
  assert.deepEqual([r.results.samples[0].old, r.results.samples[0].new], ["no result", "Fighter C by KO in round 3"]);
  const folded = r.fields.filter((x) => x.table === "boxers" && x.column.startsWith("vendor_")).reduce((n, x) => n + x.folded, 0);
  assert.ok(folded >= 4, `the totals of both fighters follow the result (folded ${folded})`);
  assert.equal(r.fields.reduce((n, x) => n + x.changes, 0), 0, "none of them is a change of its own");
  assert.equal(r.wouldHold, 1, "one fight, one change");
  assert.match(lines.join("\n"), /1 result\(s\) arriving/);
});

test("a result changed (a decision overturned) is its own kind, and a fighter's total that no result explains waits on its own", async () => {
  await fresh();
  const held = league(); Object.assign(held.bouts.find((x) => x.externalId === "E2-1")!, { winnerExternalId: "C", method: "KO", endRound: 3, status: "completed" });
  await ingest(db, prov(held)); // the stored league has C beating D; the feed now says D won, and A's wins jumped with no new fight
  const f = league();
  const b = f.bouts.find((x) => x.externalId === "E2-1")!;
  Object.assign(b, { winnerExternalId: "D", method: "UD", endRound: 10, status: "completed" });
  f.boxers.find((x) => x.externalId === "A")!.careerRecord = { wins: 15, losses: 1, draws: 0, koWins: 6, stopped: 0 };
  const r = (await run(f, "observe"))!.last()!;
  assert.deepEqual([r.results.arrived, r.results.changed], [0, 1]);
  const wins = r.fields.find((x) => x.key === "boxers.vendor_wins")!;
  assert.equal(wins.changes, 1, "A's jump has no result behind it");
  assert.equal(wins.samples[0].label, "Fighter A");
});

test("rankings: the first snapshot goes in whole, a list that differs is one change, an unchanged list is not", async () => {
  await fresh();
  const list = (champ: string, rank1: string) => ({ body: "WBC" as const, division: "Lightweight", sex: "male" as const, updatedAt: "2026-10-01", champions: [{ boxerExternalId: champ, name: null, titleType: "full" as const, vacant: false }], contenders: [{ rank: 1, boxerExternalId: rank1, name: null, vacant: false }] });
  const f = league(); f.officialRankings = [list("A", "B")];
  const first = (await run(f, "observe"))!.last()!;
  assert.equal(first.rankings.firstSnapshot, true);
  const same = (await run({ ...league(), officialRankings: [list("A", "B")] }, "observe"))!.last()!;
  assert.deepEqual([same.rankings.changed, same.rankings.unchanged, same.wouldHold], [0, 1, 0]);
  const moved = (await run({ ...league(), officialRankings: [list("A", "C")] }, "observe"))!.last()!;
  assert.deepEqual([moved.rankings.changed, moved.wouldHold], [1, 1]);
});

test("report mode rolls the whole update back: the database is byte-for-byte what it was, and no run is recorded", async () => {
  await fresh();
  const before = dump();
  const f = league(); f.boxers.find((b) => b.externalId === "A")!.heightCm = 190; f.boxers.push(makeBoxer("F", "Lightweight"));
  const lines: string[] = [];
  await assert.rejects(() => run(f, "report", lines), (e: unknown) => e instanceof gate.GateRollback);
  assert.match(lines.join("\n"), /boxers\.height_cm: 1/);
  assert.equal(dump(), before, "nothing was written, not the new fighter, not the height, not the run");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM sqlite_temp_master WHERE name LIKE 'gate_%'").get() as { c: number }).c, 0, "the temporary copies are gone");
  await run(league(), null); // and the database still takes the next update
});

test("observing changes nothing: an observed update commits exactly what an unobserved one does (two copies of one database, one update)", async () => {
  await fresh();
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const copy = path.join(os.tmpdir(), `ringside-test-vendor-gate-copy-${process.pid}.db`);
  fs.copyFileSync(process.env.DATABASE_PATH!, copy);
  const { DatabaseSync } = await import("node:sqlite");
  const other = new DatabaseSync(copy);
  try {
    const f = league();
    f.boxers.push(makeBoxer("H", "Lightweight")); f.boxers.find((b) => b.externalId === "B")!.stance = "Southpaw"; f.boxers.find((b) => b.externalId === "A")!.heightCm = 181;
    Object.assign(f.bouts.find((b) => b.externalId === "E2-1")!, { winnerExternalId: "D", method: "TKO", endRound: 5, status: "completed" });
    const hooks = gate.gateHooks({ mode: "observe", settings: settings(), log: () => {} });
    await ingest(db, prov(f));
    await ingest(other, prov(f), { gate: hooks });
    assert.ok(hooks.last()!.wouldHold > 0, "the observer did see changes");
    const tables = ["boxers", "events", "bouts", "orgs", "people", "team_stints", "weigh_ins", "officials", "scorecards", "corners", "punch_stats", "rating_history", "official_rankings"];
    const rows = (d: DatabaseSync) => JSON.stringify(tables.map((t) => d.prepare(`SELECT * FROM ${t} ORDER BY 1, 2, 3`).all()));
    assert.equal(rows(other), rows(db), "every table is identical");
    assert.equal((other.prepare("SELECT COUNT(*) c FROM sqlite_temp_master WHERE name LIKE 'gate_%'").get() as { c: number }).c, 0);
  } finally { other.close(); for (const e of ["", "-wal", "-shm"]) fs.rmSync(copy + e, { force: true }); }
});

test("a gate that breaks does not stop the update: the problem is logged and the update commits", async () => {
  await fresh();
  const lines: string[] = [];
  const hooks = gate.gateHooks({ mode: "observe", settings: settings(), log: (m) => lines.push(m) });
  const broken = { before: hooks.before, after: () => { throw new Error("boom"); } };
  const wrapped = { before: broken.before, after: (d: DatabaseSync, f: FeedData) => { try { return gate.compareWithSnapshot(d, f, undefined as never); } catch (e) { lines.push(`caught ${(e as Error).message}`); gate.dropSnapshot(d); } } };
  const f = league(); f.boxers.find((b) => b.externalId === "D")!.nickname = "Dee";
  await ingest(db, prov(f), { gate: wrapped });
  assert.equal((db.prepare("SELECT nickname n FROM boxers WHERE external_id = 'D'").get() as { n: string }).n, "Dee", "the update committed");
  assert.ok(lines.some((l) => l.startsWith("caught")));
  assert.equal((db.prepare("SELECT COUNT(*) c FROM sqlite_temp_master WHERE name LIKE 'gate_%'").get() as { c: number }).c, 0);
});

test("the flood guard: one field changing in most of the rows the feed touched is refused, a few changes are not, the baseline night is exempt, and so is a ceiling-sized night only when it is not over", async () => {
  await fresh();
  const bump = (n: number) => { const f = league(); f.boxers = f.boxers.map((b, i) => ({ ...b, heightCm: (b.heightCm ?? 170) + (i < n ? 1 : 0) })); return f; };
  const s = { ...settings(), maxFieldRows: 3, maxFieldShare: 0.5 };
  const night = async (feed: FeedData, st = s, baseline = false) => { await fresh(); const h = gate.gateHooks({ mode: "observe", settings: st, log: () => {}, baseline }); await ingest(db, prov(feed), { gate: h }); return h.last()!; };
  const flood = await night(bump(4));
  assert.match(flood.refuse.join(" "), /boxers\.height_cm changes in 4 of the 4 boxers the feed touched \(100%; the limit is 50% with at least 3\)/);
  assert.deepEqual((await night(bump(1))).refuse, [], "one fighter in four is under both limits");
  assert.deepEqual((await night(bump(2))).refuse, [], "two in four is 50%, not over the share, and under the row count");
  assert.deepEqual((await night(bump(4), s, true)).refuse, [], "the baseline night is never refused");
  const ceiling = await night(bump(4), { ...s, maxFieldShare: 1, maxNight: 3 });
  assert.match(ceiling.refuse.join(" "), /4 changes in one night is more than the ceiling of 3/);
  assert.deepEqual((await night(bump(3), { ...s, maxFieldShare: 1, maxNight: 3 })).refuse, [], "exactly at the ceiling is allowed");
});

test("the report is written to <data>/gate-reports/ as JSON and only the newest 90 are kept", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-reports-"));
  try {
    const mk = (n: number): import("../lib/watch/vendor-gate").GateReport => ({ version: 1, at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(), mode: "observe", touched: {}, newRows: {}, fields: [], results: { arrived: 0, changed: 0, cleared: 0, details: 0, samples: [] }, rankings: { firstSnapshot: false, changed: 0, removed: 0, added: 0, unchanged: 0, samples: [] }, wouldHold: 0, passes: {}, ungated: {}, refuse: [] });
    for (let i = 0; i < 95; i++) assert.ok(gate.writeGateReport(dir, mk(i)));
    const files = fs.readdirSync(path.join(dir, "gate-reports")).sort();
    assert.equal(files.length, 90); assert.match(files[0], /00-05-00/, "the five oldest were removed");
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "gate-reports", files[89]), "utf8")).version, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
