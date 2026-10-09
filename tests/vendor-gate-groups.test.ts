import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeBoxer, miniFeed, providerOf, tempDb } from "./helpers";
import type { FeedData } from "../lib/feed";

/**
 * Step E1 of the vendor gate: deciding on a whole group, the baseline action, and standing rules. What must hold: a group's numbers and samples describe exactly the proposals in it;
 * a group decision decides on exactly those (a changed group is refused); the baseline is one logged step that leaves the database as an ungated update would have; a rule keeps the
 * changes it accepts out of the queue, and is logged each night it is used; and no rule can hide a night the flood guard would refuse.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("vendor-gate-groups");
after(cleanup);

let db: DatabaseSync, acc: DatabaseSync;
let ingest: typeof import("../lib/ingest").ingest;
let gate: typeof import("../lib/watch/vendor-gate");
let policy: typeof import("../lib/watch/vendor-policy");
let props: typeof import("../lib/watch/proposals");
let groups: typeof import("../lib/watch/groups");
let rulesLib: typeof import("../lib/watch/rules");
let admin: import("../lib/accounts/users").User, editor: import("../lib/accounts/users").User;

const N = 120; // fighters, so that one group is larger than the 50 a single call may decide
const prov = (feed: FeedData) => ({ ...providerOf(feed), fetchOfficialRankings: async () => feed.officialRankings });
function league(): FeedData {
  const f = miniFeed();
  f.boxers = Array.from({ length: N }, (_, i) => makeBoxer(`F${i}`, "Lightweight", { careerRecord: { wins: 5, losses: 1, draws: 0, koWins: 2, stopped: 0 } }));
  f.events = [{ externalId: "E1", name: "Old Night", date: "2025-01-10", venue: "Arena", city: "Las Vegas", country: "United States" }, { externalId: "E2", name: "Next Night", date: "2026-10-01", venue: "Arena", city: "Las Vegas", country: "United States" }];
  f.bouts = [{ externalId: "E1-1", eventExternalId: "E1", redExternalId: "F0", blueExternalId: "F1", weightClass: "Lightweight", rounds: 12, winnerExternalId: "F0", method: "UD", endRound: 12, title: null, position: 0 },
    { externalId: "E2-1", eventExternalId: "E2", redExternalId: "F2", blueExternalId: "F3", weightClass: "Lightweight", rounds: 10, winnerExternalId: null, method: null, endRound: null, title: null, position: 0 }];
  f.people = f.people.slice(0, 1); f.stints = []; f.weighIns = []; f.officials = []; f.scorecards = []; f.corners = []; f.punches = []; f.officialRankings = [];
  return f;
}
/** every fighter's height moves by `by`, the first `taller` of them by `big` instead, and a result arrives */
function night(by: number, o: { big?: number; taller?: number; result?: boolean } = {}): FeedData {
  const f = league();
  f.boxers = f.boxers.map((b, i) => ({ ...b, heightCm: (b.heightCm ?? 175) + (i < (o.taller ?? 0) ? (o.big ?? 0) : by) }));
  if (o.result) {
    Object.assign(f.bouts[1], { winnerExternalId: "F2", method: "KO", endRound: 3, status: "completed" });
    f.boxers[2].careerRecord = { wins: 6, losses: 1, draws: 0, koWins: 3, stopped: 0 }; f.boxers[3].careerRecord = { wins: 5, losses: 2, draws: 0, koWins: 2, stopped: 1 };
  }
  return f;
}
const TABLES = ["boxers", "events", "bouts", "orgs", "people", "rating_history", "official_rankings"];
const rows = (d: DatabaseSync) => JSON.stringify(TABLES.map((t) => d.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()));
const flood = () => policy.gateSettings({ VENDOR_GATE_MAX_FIELD_ROWS: "100000" }); // these tests are about groups, not the guard
async function hold(feed: FeedData, o: { rules?: import("../lib/watch/rules").Rule[]; settings?: import("../lib/watch/vendor-policy").GateSettings; baseline?: boolean } = {}) {
  const hooks = gate.gateHooks({ mode: "hold", settings: o.settings ?? flood(), log: () => {}, baseline: o.baseline ?? true, rules: o.rules });
  await ingest(db, prov(feed), { gate: hooks });
  return hooks.flush(acc)!;
}
const reset = async () => { acc.exec("DELETE FROM proposals; DELETE FROM audit; DELETE FROM watch_rules"); await ingest(db, prov(league())); db.exec("UPDATE boxers SET height_cm = 175"); };
const copyDb = () => {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const file = path.join(os.tmpdir(), `ringside-test-gate-groups-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(process.env.DATABASE_PATH!, file);
  return { d: new DatabaseSync(file), done: () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); } };
};
const waiting = () => (acc.prepare("SELECT COUNT(*) c FROM proposals WHERE status = 'pending'").get() as { c: number }).c;

before(async () => {
  db = await (await import("../lib/db")).getDb();
  acc = (await import("../lib/accounts/store")).accountsDb();
  ({ ingest } = await import("../lib/ingest"));
  gate = await import("../lib/watch/vendor-gate"); policy = await import("../lib/watch/vendor-policy");
  props = await import("../lib/watch/proposals"); groups = await import("../lib/watch/groups"); rulesLib = await import("../lib/watch/rules");
  const users = await import("../lib/accounts/users");
  const mk = async (name: string, role: "admin" | "editor") => { const r = await users.createUser(name, "a-long-passphrase-for-tests-1", acc); if ("error" in r) throw new Error(r.error); users.setRole(name, role, acc); return { ...r.user, role }; };
  admin = await mk("grp_admin", "admin"); editor = await mk("grp_editor", "editor");
  await ingest(db, prov(league()));
});

test("a group describes exactly the proposals in it: the count, filled/replaced, the median and largest change, ten samples, the oldest", async () => {
  await reset();
  await hold(night(2, { big: 15, taller: 10, result: true }));
  const gs = groups.proposalGroups(acc);
  const h = gs.find((g) => g.field === "boxers.height_cm")!;
  assert.equal(h.count, N);
  assert.deepEqual([h.fills, h.replaces, h.clears, h.numeric], [0, N, 0, true]);
  assert.equal(h.maxDelta, 15); assert.equal(h.medianDelta, 2);
  assert.equal(h.samples.length, 10);
  assert.ok(h.samples.every((s) => typeof s.old === "number" && typeof s.new === "number"));
  assert.equal(gs.find((g) => g.field === "result")!.count, 1);
  assert.equal(gs.reduce((n, g) => n + g.count, 0), waiting(), "every waiting proposal is in exactly one group");
  assert.deepEqual(gs.map((g) => g.count), [...gs.map((g) => g.count)].sort((a, b) => b - a), "the biggest group first");
});

test("a group is decided whole whatever its size, only if it is the group the page showed, and only by an administrator", async () => {
  await reset();
  await hold(night(2));
  assert.deepEqual(groups.decideGroup(editor, { source: gate.VENDOR_SOURCE_ID, kind: "field_change", field: "boxers.height_cm", decision: "approved", note: "", expectCount: N }, db, acc), { error: "forbidden" });
  assert.deepEqual(groups.decideGroup(admin, { source: gate.VENDOR_SOURCE_ID, kind: "field_change", field: "boxers.height_cm", decision: "approved", note: "", expectCount: N - 1 }, db, acc), { error: "group_changed" });
  assert.equal(waiting(), N, "a changed group is never decided");
  assert.deepEqual(groups.decideGroup(admin, { source: gate.VENDOR_SOURCE_ID, kind: "field_change", field: "boxers.height_cm", decision: "rejected", note: "  ", expectCount: N }, db, acc), { error: "note_required" });
  const r = groups.decideGroup(admin, { source: gate.VENDOR_SOURCE_ID, kind: "field_change", field: "boxers.height_cm", decision: "approved", note: "", expectCount: N }, db, acc);
  assert.ok(!("error" in r)); assert.equal(r.report.approved, N); assert.deepEqual(r.failed, {});
  assert.equal(waiting(), 0);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM boxers WHERE height_cm = 177").get() as { c: number }).c, N);
  assert.equal((acc.prepare("SELECT COUNT(*) c FROM audit WHERE action = 'update.group_approve'").get() as { c: number }).c, 1);
  assert.deepEqual(groups.decideGroup(admin, { source: gate.VENDOR_SOURCE_ID, kind: "field_change", field: "boxers.height_cm", decision: "approved", note: "", expectCount: 1 }, db, acc), { error: "group_empty" });
});

test("rejecting a group keeps our values, and a stale member does not stop the rest", async () => {
  await reset();
  await hold(night(3));
  db.prepare("UPDATE boxers SET height_cm = 199 WHERE external_id = 'F5'").run(); // one held row moved on
  const r = groups.decideGroup(admin, { source: gate.VENDOR_SOURCE_ID, kind: "field_change", field: "boxers.height_cm", decision: "approved", note: "", expectCount: N }, db, acc);
  assert.ok(!("error" in r)); assert.equal(r.report.approved, N - 1); assert.deepEqual(r.failed, { stale: 1 });
  assert.equal(waiting(), 1, "the stale one stays waiting");
  const rej = groups.decideGroup(admin, { source: gate.VENDOR_SOURCE_ID, kind: "field_change", field: "boxers.height_cm", decision: "rejected", note: "moved", expectCount: 1 }, db, acc);
  assert.ok(!("error" in rej)); assert.equal(rej.report.rejected, 1);
});

test("THE BASELINE: accepting everything waiting is one logged step, needs a note and the count, and leaves the database exactly as an ungated update would have", async () => {
  await reset();
  const a = copyDb();
  try {
    const f = night(2, { result: true });
    await ingest(a.d, prov(f));
    await hold(f);
    const total = waiting();
    assert.ok(total > N);
    assert.deepEqual(groups.acceptEverythingWaiting(editor, { note: "x", expectCount: total }, db, acc), { error: "forbidden" });
    assert.deepEqual(groups.acceptEverythingWaiting(admin, { note: "", expectCount: total }, db, acc), { error: "note_required" });
    assert.deepEqual(groups.acceptEverythingWaiting(admin, { note: "first night", expectCount: total + 1 }, db, acc), { error: "group_changed" });
    const r = groups.acceptEverythingWaiting(admin, { note: "first night of holding", expectCount: total }, db, acc);
    assert.ok(!("error" in r)); assert.equal(r.report.approved, total); assert.equal(r.report.ratingsRecomputed, true);
    assert.equal(rows(db), rows(a.d), "every table, ratings included, is what an ungated update leaves");
    const log = acc.prepare("SELECT actor, action, detail FROM audit WHERE action = 'update.baseline'").all() as { actor: string; detail: string }[];
    assert.equal(log.length, 1); assert.equal(log[0].actor, "grp_admin"); assert.match(log[0].detail, /first night of holding/);
  } finally { a.d.close(); a.done(); }
});

test("rules: only an administrator makes them, for a field that can be named, with a condition that fits it; a duplicate is refused; removing is logged", async () => {
  await reset();
  const add = (u: typeof admin | null, r: Parameters<typeof rulesLib.addRule>[1]) => rulesLib.addRule(u, r, acc);
  assert.deepEqual(add(editor, { field: "boxers.height_cm", condition: "any" }), { ok: false, error: "forbidden" });
  assert.deepEqual(add(null, { field: "boxers.height_cm", condition: "any" }), { ok: false, error: "forbidden" });
  assert.deepEqual(add(admin, { field: "boxers.slug", condition: "any" }), { ok: false, error: "field_unknown" });
  assert.deepEqual(add(admin, { field: "boxers.height_cm", condition: "sometimes" }), { ok: false, error: "condition_invalid" });
  assert.deepEqual(add(admin, { field: "boxers.nickname", condition: "max_delta", amount: 2 }), { ok: false, error: "condition_invalid" }, "a text field has no size of change");
  assert.deepEqual(add(admin, { field: "result", condition: "fills" }), { ok: false, error: "condition_invalid" }, "a result is accepted whole or not at all");
  assert.deepEqual(add(admin, { field: "boxers.height_cm", condition: "max_delta", amount: -1 }), { ok: false, error: "amount_invalid" });
  const ok = add(admin, { field: "boxers.height_cm", condition: "max_delta", amount: 3 });
  assert.ok(ok.ok);
  assert.deepEqual(add(admin, { field: "boxers.height_cm", condition: "max_delta", amount: 3 }), { ok: false, error: "duplicate" });
  assert.equal(rulesLib.listRules(acc).length, 1);
  assert.deepEqual(rulesLib.removeRule(editor, (ok as { id: number }).id, acc), { ok: false, error: "forbidden" });
  assert.deepEqual(rulesLib.removeRule(admin, (ok as { id: number }).id, acc), { ok: true });
  assert.deepEqual(rulesLib.removeRule(admin, 9999, acc), { ok: false, error: "not_found" });
  assert.deepEqual((acc.prepare("SELECT action FROM audit WHERE action LIKE 'update.rule_%' ORDER BY id").all() as { action: string }[]).map((x) => x.action), ["update.rule_add", "update.rule_remove"]);
});

test("a rule keeps the changes it accepts out of the queue, is logged for the night it is used, and what is not accepted still waits", async () => {
  await reset();
  assert.ok(rulesLib.addRule(admin, { field: "boxers.height_cm", condition: "max_delta", amount: 3 }, acc).ok);
  assert.ok(rulesLib.addRule(admin, { field: "result", condition: "any" }, acc).ok);
  const a = copyDb();
  try {
    const f = night(2, { big: 15, taller: 7, result: true }); // 7 fighters move 15 cm, the rest 2; a result arrives
    await ingest(a.d, prov(f));
    const h = await hold(f, { rules: rulesLib.listRules(acc) });
    assert.equal(h.held, 7, "only the seven large changes wait: the small ones and the result were accepted by rule");
    assert.equal((db.prepare("SELECT COUNT(*) c FROM boxers WHERE height_cm = 177").get() as { c: number }).c, N - 7, "the small changes are live");
    assert.equal((db.prepare("SELECT method m FROM bouts WHERE external_id = 'E2-1'").get() as { m: string }).m, "KO", "the result is live");
    assert.equal((db.prepare("SELECT vendor_wins w FROM boxers WHERE external_id = 'F2'").get() as { w: number }).w, 6, "and so are the totals that ride with it");
    assert.deepEqual(groups.proposalGroups(acc).map((g) => [g.field, g.count]), [["boxers.height_cm", 7]]);
    const used = acc.prepare("SELECT target, detail FROM audit WHERE action = 'update.rule_applied' ORDER BY target").all() as { target: string; detail: string }[];
    assert.equal(used.length, 2); assert.match(used.map((u) => u.detail).join(" "), /"accepted":113/); assert.match(used.map((u) => u.detail).join(" "), /"accepted":1/);
    assert.deepEqual((acc.prepare("SELECT used_count u FROM watch_rules ORDER BY id").all() as { u: number }[]).map((x) => x.u), [N - 7, 1]);
    // approve the rest: the database is what an ungated update leaves
    const r = groups.decideGroup(admin, { source: gate.VENDOR_SOURCE_ID, kind: "field_change", field: "boxers.height_cm", decision: "approved", note: "", expectCount: 7 }, db, acc);
    assert.ok(!("error" in r));
    assert.equal(rows(db), rows(a.d));
  } finally { a.d.close(); a.done(); }
});

test("no rule can hide a night the flood guard refuses: the guard looks at the whole night first", async () => {
  await reset();
  assert.ok(rulesLib.addRule(admin, { field: "boxers.height_cm", condition: "any" }, acc).ok);
  const strict = { ...policy.gateSettings({}), maxFieldRows: 10, maxFieldShare: 0.5 };
  await assert.rejects(() => hold(night(2), { rules: rulesLib.listRules(acc), settings: strict, baseline: false }), (e: unknown) => e instanceof gate.GateRefusal);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM boxers WHERE height_cm = 177").get() as { c: number }).c, 0, "nothing was written");
});

test("the routes: groups, the baseline and the rules are for administrators only, a group decision needs the count, and removing a rule needs the same origin", async () => {
  await reset();
  await hold(night(2));
  const users = await import("../lib/accounts/users");
  const gr = await import("../app/api/review/updates/groups/route"), ru = await import("../app/api/review/updates/rules/route");
  const cookie = (u: { id: number }) => `${users.SESSION_COOKIE}=${users.createSession(u.id, acc).token}`;
  const A = cookie(admin), E = cookie(editor);
  const call = async (h: (r: Request) => Promise<Response>, method: string, body?: unknown, o: { cookie?: string; origin?: string | null; url?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "10.7.7.7" };
    if (o.cookie) headers.cookie = o.cookie; if (o.origin !== null) headers.origin = o.origin ?? "http://localhost:3100";
    const res = await h(new Request(o.url ?? "http://localhost:3100/api/x", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  assert.equal((await call(gr.GET, "GET")).status, 401);
  assert.equal((await call(gr.GET, "GET", undefined, { cookie: E })).status, 403);
  const list = await call(gr.GET, "GET", undefined, { cookie: A });
  assert.equal(list.status, 200); assert.equal(list.json.groups[0].count, N); assert.ok(Array.isArray(list.json.rules));
  const body = { action: "decide", source: gate.VENDOR_SOURCE_ID, kind: "field_change", field: "boxers.height_cm", decision: "approved", note: "", expectCount: N };
  assert.equal((await call(gr.POST, "POST", body, { cookie: E })).status, 403);
  assert.equal((await call(gr.POST, "POST", { ...body, expectCount: undefined }, { cookie: A })).status, 400);
  assert.equal((await call(gr.POST, "POST", { ...body, expectCount: N - 1 }, { cookie: A })).status, 409);
  assert.equal((await call(gr.POST, "POST", body, { cookie: A, origin: "https://evil.example" })).status, 403);
  const ok = await call(gr.POST, "POST", body, { cookie: A });
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.approved, N);
  assert.equal((await call(ru.POST, "POST", { field: "boxers.height_cm", condition: "any" }, { cookie: E })).status, 403);
  assert.equal((await call(ru.POST, "POST", { field: "boxers.slug", condition: "any" }, { cookie: A })).status, 400);
  const made = await call(ru.POST, "POST", { field: "boxers.height_cm", condition: "max_delta", amount: 2 }, { cookie: A });
  assert.equal(made.status, 201);
  assert.equal((await call(ru.POST, "POST", { field: "boxers.height_cm", condition: "max_delta", amount: 2 }, { cookie: A })).status, 409);
  assert.equal((await call(ru.GET, "GET", undefined, { cookie: A })).json.rules.length, 1);
  assert.equal((await call(ru.DELETE, "DELETE", undefined, { cookie: A, origin: "https://evil.example", url: `http://localhost:3100/api/x?id=${made.json.id}` })).status, 403);
  assert.equal((await call(ru.DELETE, "DELETE", undefined, { cookie: E, url: `http://localhost:3100/api/x?id=${made.json.id}` })).status, 403);
  assert.equal((await call(ru.DELETE, "DELETE", undefined, { cookie: A, url: `http://localhost:3100/api/x?id=${made.json.id}` })).status, 200);
  void props;
});
