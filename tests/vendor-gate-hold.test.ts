import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeBoxer, miniFeed, providerOf, tempDb } from "./helpers";
import type { FeedData } from "../lib/feed";

/**
 * The vendor update gate, step D2: HOLDING. The guarantee that matters is the first test: for any night, holding the changes and then approving every one of them leaves the
 * database exactly as an ungated update would have. Around it: while they wait nothing the policy holds is visible and the rest is; a rejection keeps our value night after
 * night; a result takes its fighters' totals with it and the ratings follow; a change that no longer fits is refused; the flood guard refuses a night whole.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("vendor-gate-hold");
after(cleanup);

let db: DatabaseSync, acc: DatabaseSync;
let ingest: typeof import("../lib/ingest").ingest;
let gate: typeof import("../lib/watch/vendor-gate");
let policy: typeof import("../lib/watch/vendor-policy");
let props: typeof import("../lib/watch/proposals");
let dec: typeof import("../lib/watch/decide");
let admin: import("../lib/accounts/users").User;

const prov = (feed: FeedData) => ({ ...providerOf(feed), fetchOfficialRankings: async () => feed.officialRankings });
const list = (champ: string, rank1: string) => ({ body: "WBC" as const, division: "Lightweight", sex: "male" as const, updatedAt: "2026-10-01", champions: [{ boxerExternalId: champ, name: null, titleType: "full" as const, vacant: false }], contenders: [{ rank: 1, boxerExternalId: rank1, name: null, vacant: false }] });
function league(): FeedData {
  const f = miniFeed();
  const rec = (w: number, l: number, k: number) => ({ careerRecord: { wins: w, losses: l, draws: 0, koWins: k, stopped: 0 } });
  f.boxers = [makeBoxer("A", "Lightweight", rec(10, 1, 6)), makeBoxer("B", "Lightweight", rec(9, 2, 4)), makeBoxer("C", "Lightweight", rec(5, 0, 3)), makeBoxer("D", "Lightweight", rec(4, 1, 2))];
  f.events.push({ externalId: "E2", name: "Next Night", date: "2026-10-01", venue: "Arena", city: "Las Vegas", country: "United States" });
  f.bouts.push({ externalId: "E2-1", eventExternalId: "E2", redExternalId: "C", blueExternalId: "D", weightClass: "Lightweight", rounds: 10, winnerExternalId: null, method: null, endRound: null, title: null, position: 0, oddsRed: 1.5, oddsBlue: 2.6 });
  f.officialRankings = [list("A", "B")];
  return f;
}
/** a night that changes a bit of everything the policy knows about */
function busyNight(): FeedData {
  const f = league();
  const b = (id: string) => f.boxers.find((x) => x.externalId === id)!;
  b("A").heightCm = 181; b("A").nickname = "Ace"; b("B").stance = "Southpaw"; b("B").country = "Ireland";
  b("C").careerRecord = { wins: 6, losses: 0, draws: 0, koWins: 4, stopped: 0 }; b("D").careerRecord = { wins: 4, losses: 2, draws: 0, koWins: 2, stopped: 1 };
  Object.assign(f.bouts.find((x) => x.externalId === "E2-1")!, { winnerExternalId: "C", method: "KO", endRound: 3, status: "completed", oddsRed: 1.2 });
  f.bouts.find((x) => x.externalId === "E1-1")!.winnerExternalId = "B"; // an old decision overturned
  f.events[0].name = "Test Night (renamed)"; f.events[1].date = "2026-10-02";
  f.orgs[0].name = "Test Gym Ltd"; f.people[0].name = "Judge Uno";
  f.boxers.push(makeBoxer("E", "Lightweight")); // a new fighter: goes in at once
  f.officialRankings = [list("A", "C")];
  return f;
}
const TABLES = ["boxers", "events", "bouts", "orgs", "people", "official_rankings", "rating_history", "team_stints", "weigh_ins", "officials", "scorecards"];
const rows = (d: DatabaseSync) => JSON.stringify(TABLES.map((t) => d.prepare(`SELECT * FROM ${t} ORDER BY ${t === "official_rankings" ? "body, division, sex, position, rank" : t === "rating_history" ? "bout_id, boxer_id" : "1, 2"}`).all()));
const settings = (o: Partial<import("../lib/watch/vendor-policy").GateSettings> = {}) => ({ ...policy.gateSettings({}), ...o });
async function hold(d: DatabaseSync, feed: FeedData, o: { baseline?: boolean; settings?: ReturnType<typeof settings> } = {}) {
  const hooks = gate.gateHooks({ mode: "hold", settings: o.settings ?? settings(), log: () => {}, baseline: o.baseline ?? true });
  await ingest(d, prov(feed), { gate: hooks });
  return hooks.flush(acc)!;
}
const pending = () => props.listProposals(acc, { source: gate.VENDOR_SOURCE_ID, limit: 5000 });
const copyDb = async () => {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const file = path.join(os.tmpdir(), `ringside-test-gate-hold-copy-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(process.env.DATABASE_PATH!, file);
  return { d: new DatabaseSync(file), done: () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); } };
};

before(async () => {
  db = await (await import("../lib/db")).getDb();
  acc = (await import("../lib/accounts/store")).accountsDb();
  ({ ingest } = await import("../lib/ingest"));
  gate = await import("../lib/watch/vendor-gate"); policy = await import("../lib/watch/vendor-policy");
  props = await import("../lib/watch/proposals"); dec = await import("../lib/watch/decide");
  const users = await import("../lib/accounts/users");
  const r = await users.createUser("gate_admin", "a-long-passphrase-for-tests-1", acc);
  if ("error" in r) throw new Error(r.error);
  users.setRole("gate_admin", "admin", acc);
  admin = { ...r.user, role: "admin" };
});
const reset = async () => { acc.exec("DELETE FROM proposals; DELETE FROM audit"); await ingest(db, prov(league())); db.exec("UPDATE boxers SET nickname = NULL"); };
const approveAll = (ids?: number[]) => { const r = dec.decide(admin, ids ?? pending().map((p) => p.id), "approved", "", db, acc); assert.ok(!("error" in r), JSON.stringify(r)); return r; };

test("THE GUARANTEE: holding a night's changes and then approving every one of them leaves the database exactly as an ungated update would have", async () => {
  await reset();
  const a = await copyDb();
  try {
    const night = busyNight();
    await ingest(a.d, prov(night)); // ungated
    const held = await hold(db, night);
    assert.ok(held.held > 8, `a busy night held ${held.held}`);
    assert.notEqual(rows(db), rows(a.d), "while they wait the two differ");
    const r = approveAll();
    assert.equal(r.results.every((x) => x.ok), true, JSON.stringify(r.results.filter((x) => !x.ok)));
    assert.equal(rows(db), rows(a.d), "every table, ratings and their history included, is identical");
    assert.equal(pending().length, 0);
    const again = await hold(db, night);
    assert.equal(again.held, 0, "the next night finds nothing left to hold");
  } finally { a.d.close(); a.done(); }
});

test("while they wait: what the policy holds shows the old value, new rows, odds and pictures are in, and the proposals say what and why", async () => {
  await reset();
  const before = rows(db);
  const night = busyNight();
  const h = await hold(db, night);
  const one = (sql: string) => db.prepare(sql).get() as Record<string, unknown>;
  assert.equal(one("SELECT height_cm h FROM boxers WHERE external_id = 'A'").h, 175, "height is held");
  assert.equal(one("SELECT nickname n FROM boxers WHERE external_id = 'A'").n, null, "a blank filled waits too");
  assert.equal(one("SELECT country c FROM boxers WHERE external_id = 'B'").c, "Mexico");
  assert.equal(one("SELECT method m FROM bouts WHERE external_id = 'E2-1'").m, null, "the result has not arrived");
  assert.equal(one("SELECT odds_red o FROM bouts WHERE external_id = 'E2-1'").o, 1.2, "odds go in");
  assert.equal(one("SELECT COUNT(*) c FROM boxers WHERE external_id = 'E'").c, 1, "a new fighter goes in");
  assert.equal(one("SELECT winner_id w FROM bouts WHERE external_id = 'E1-1'").w, one("SELECT id FROM boxers WHERE external_id = 'A'").id, "an overturned result is held");
  assert.equal(one("SELECT vendor_wins w FROM boxers WHERE external_id = 'C'").w, 5, "the totals wait with the result");
  assert.match(String(one("SELECT name n FROM events WHERE external_id = 'E1'").n), /^Test Night$/);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM official_rankings WHERE boxer_id = (SELECT id FROM boxers WHERE external_id = 'C')").get() as { c: number }).c, 0, "the old list is back");
  const kinds = pending().reduce<Record<string, number>>((m, p) => ({ ...m, [p.kind]: (m[p.kind] ?? 0) + 1 }), {});
  assert.deepEqual(Object.keys(kinds).sort(), ["field_change", "list_change", "result_change"]);
  assert.equal(kinds.result_change, 2, "the result arriving and the overturned one are one change each");
  assert.equal(kinds.list_change, 1);
  const res = pending().find((p) => p.targetKey === "bout|E2-1|result")!;
  assert.deepEqual((res.evidence as { shown: { old: string; new: string } }).shown, { old: "no result", new: "Fighter C by KO in round 3" });
  assert.equal(((res.evidence as { totals: unknown[] }).totals).length, 2, "both fighters' totals ride with it");
  assert.equal(h.held, pending().length);
  assert.notEqual(rows(db), before, "the night did change what it may (the new fighter)");
});

test("a rejection keeps our value: the next night restores it again, and the change is not raised again", async () => {
  await reset();
  const night = busyNight();
  await hold(db, night);
  const height = pending().find((p) => p.targetKey === "boxer|A|height_cm")!;
  assert.ok(!("error" in dec.decide(admin, [height.id], "rejected", "the vendor is wrong", db, acc)));
  const again = await hold(db, night);
  assert.equal(again.remembered, 1);
  assert.equal((db.prepare("SELECT height_cm h FROM boxers WHERE external_id = 'A'").get() as { h: number }).h, 175, "still our value");
  assert.equal(pending().some((p) => p.targetKey === "boxer|A|height_cm"), false, "and no new proposal");
  approveAll();
});

test("a result approved takes the fighters' totals with it and moves the ratings exactly as the ungated update did", async () => {
  await reset();
  const a = await copyDb();
  try {
    const f = league();
    Object.assign(f.bouts.find((x) => x.externalId === "E2-1")!, { winnerExternalId: "D", method: "UD", endRound: 10, status: "completed" });
    f.boxers.find((x) => x.externalId === "D")!.careerRecord = { wins: 5, losses: 1, draws: 0, koWins: 2, stopped: 0 };
    f.boxers.find((x) => x.externalId === "C")!.careerRecord = { wins: 5, losses: 1, draws: 0, koWins: 3, stopped: 0 };
    await ingest(a.d, prov(f));
    await hold(db, f);
    const rating = (d: DatabaseSync) => d.prepare("SELECT external_id e, rating r FROM boxers ORDER BY 1").all().map((x) => ({ ...x }));
    assert.notDeepEqual(rating(db), rating(a.d), "held: the ratings have not moved");
    const res = pending().filter((p) => p.kind === "result_change");
    assert.equal(res.length, 1); assert.equal(pending().length, 1, "nothing else is waiting: the totals ride with it");
    const r = approveAll();
    assert.equal(r.ratingsRecomputed, true);
    assert.deepEqual(rating(db), rating(a.d));
    assert.equal((db.prepare("SELECT vendor_wins w FROM boxers WHERE external_id = 'D'").get() as { w: number }).w, 5);
  } finally { a.d.close(); a.done(); }
});

test("a change that no longer fits what is held is refused and stays waiting; applying twice does nothing; a doctored proposal cannot write an unlisted column", async () => {
  await reset();
  await hold(db, busyNight());
  const p = pending().find((x) => x.targetKey === "boxer|A|height_cm")!;
  db.prepare("UPDATE boxers SET height_cm = 199 WHERE external_id = 'A'").run(); // the held row moved on since
  const r = dec.decide(admin, [p.id], "approved", "", db, acc);
  assert.ok(!("error" in r)); assert.deepEqual(r.results, [{ id: p.id, ok: false, error: "stale" }]);
  assert.equal((db.prepare("SELECT height_cm h FROM boxers WHERE external_id = 'A'").get() as { h: number }).h, 199, "nothing written");
  assert.equal(pending().some((x) => x.id === p.id), true);
  db.prepare("UPDATE boxers SET height_cm = 175 WHERE external_id = 'A'").run();
  const { applyVendorChange } = await import("../lib/watch/vendor-apply");
  const good = { kind: "field_change", targetKey: "boxer|A|height_cm", old: { height_cm: 175 }, new: { height_cm: 181 }, evidence: {} };
  assert.deepEqual(applyVendorChange(db, good), { ok: true, changed: true });
  assert.deepEqual(applyVendorChange(db, good), { ok: true, changed: false }, "the second time it is already there");
  for (const bad of [{ ...good, targetKey: "boxer|A|slug", old: { slug: "a" }, new: { slug: "x" } }, { ...good, targetKey: "boxer|A|rating", old: { rating: 1 }, new: { rating: 9 } }, { ...good, targetKey: "bout|E2-1|winner_id", old: { winner_id: null }, new: { winner_id: 1 } }, { ...good, kind: "drop_table" }]) {
    assert.deepEqual(applyVendorChange(db, bad), { ok: false, error: "bad_proposal" }, bad.targetKey);
  }
  assert.deepEqual(applyVendorChange(db, { ...good, targetKey: "boxer|NOPE|height_cm" }), { ok: false, error: "gone" });
});

test("the flood guard refuses a night whole in hold mode: the database is exactly as it was, no proposal is written, and the baseline night is exempt", async () => {
  await reset();
  const before = rows(db);
  const f = league(); f.boxers = f.boxers.map((b) => ({ ...b, heightCm: (b.heightCm ?? 170) + 1 }));
  const s = settings({ maxFieldRows: 3, maxFieldShare: 0.5 });
  await assert.rejects(() => hold(db, f, { baseline: false, settings: s }), (e: unknown) => e instanceof gate.GateRefusal && /boxers\.height_cm changes in 4 of the 4/.test(e.message));
  assert.equal(rows(db), before, "refused: nothing was written, not even the odds");
  assert.equal(pending().length, 0);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM sqlite_temp_master WHERE name LIKE 'gate_%'").get() as { c: number }).c, 0);
  const ok = await hold(db, f, { baseline: true, settings: s });
  assert.equal(ok.held, 4, "the baseline night records the pile instead");
  approveAll();
});

test("the ranking list: held, applied whole when approved, and a list we did not have goes straight in", async () => {
  await reset();
  const f = league(); f.officialRankings = [list("A", "C")];
  await hold(db, f);
  const lists = () => (db.prepare("SELECT name n, boxer_id b, kind k FROM official_rankings ORDER BY position").all() as object[]).length;
  assert.equal(lists(), 2);
  assert.equal(pending().length, 1); assert.equal(pending()[0].kind, "list_change");
  approveAll();
  assert.equal((db.prepare("SELECT COUNT(*) c FROM official_rankings WHERE boxer_id = (SELECT id FROM boxers WHERE external_id = 'C')").get() as { c: number }).c, 1);
  const g = league(); g.officialRankings = [list("A", "C"), { ...list("A", "B"), body: "WBA" as const }];
  const h = await hold(db, g);
  assert.equal(h.held, 0, "a new list is new data: in at once");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM official_rankings WHERE body = 'WBA'").get() as { c: number }).c, 2);
});

test("settings: hold is a mode, and only an administrator's approval ever writes a held change", async () => {
  assert.equal(policy.gateSettings({ VENDOR_GATE: "hold" }).mode, "hold");
  await reset();
  await hold(db, busyNight());
  const p = pending()[0];
  const users = await import("../lib/accounts/users");
  const e = await users.createUser("gate_editor", "a-long-passphrase-for-tests-1", acc);
  if ("error" in e) throw new Error(e.error);
  users.setRole("gate_editor", "editor", acc);
  assert.deepEqual(dec.decide({ ...e.user, role: "editor" }, [p.id], "approved", "", db, acc), { error: "forbidden" });
  approveAll();
});
