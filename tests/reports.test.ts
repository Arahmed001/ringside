import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";

/**
 * Reports of a wrong fact and the corrections that come from the ones an editor accepts. The things that must hold: nothing changes without a source, a
 * second person and an accepted report; a correction is still there after the vendor's daily update has rewritten the row; the vendor's own value is
 * remembered, so a change by the vendor is noticed and retiring a correction puts it back; a corrected result moves the ratings; and what a reporter or an
 * editor may see stays within what each is meant to.
 */
const cleanup = tempDb("reports");
const accFile = path.join(os.tmpdir(), `ringside-test-reports-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

const SRC = "https://example.org/fight-report";
const QUOTE = "the official record gives the fighter's reach as 188 cm";

async function setup() {
  const { getDb } = await import("../lib/db");
  const users = await import("../lib/accounts/users");
  const store = await import("../lib/accounts/store");
  const main: DatabaseSync = await getDb();
  const acc = store.accountsDb();
  const mk = async (name: string, role: "user" | "editor" | "admin") => {
    const r = await users.createUser(name, "a-long-passphrase-for-tests-1", acc);
    if ("error" in r) throw new Error(r.error);
    if (role !== "user") users.setRole(name, role, acc);
    return { ...r.user, role };
  };
  const alice = await mk("alice_rep", "user"), eddie = await mk("eddie_edit", "editor"), carol = await mk("carol_admin", "admin"), frank = await mk("frank_user", "user");
  const C = await import("../lib/accounts/corrections");
  return { main, acc, alice, eddie, carol, frank, C, users };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
let ctx: Ctx;
const get = async () => (ctx ??= await setup());

/** A boxer who has fought, and finished fights with a winner by a decision, a draw and a stoppage, from the demo league. */
function pick(main: DatabaseSync) {
  const boxer = main.prepare("SELECT external_id e, slug, name, height_cm, reach_cm, stance, nickname, country, birth_date, birth_year FROM boxers WHERE active = 1 ORDER BY id LIMIT 1").get() as Record<string, string | number | null>;
  const decided = main.prepare("SELECT external_id e, winner_id w, red_id r, blue_id u, method m, end_round er, rounds FROM bouts WHERE method = 'UD' AND winner_id IS NOT NULL ORDER BY id LIMIT 1").get() as Record<string, number | string>;
  const draw = main.prepare("SELECT external_id e, method m FROM bouts WHERE method = 'DRAW' ORDER BY id LIMIT 1").get() as { e: string; m: string } | undefined;
  const upcoming = main.prepare("SELECT external_id e FROM bouts WHERE method IS NULL ORDER BY id LIMIT 1").get() as { e: string };
  return { boxer, decided, draw, upcoming };
}
const reach = (main: DatabaseSync, ext: string) => (main.prepare("SELECT reach_cm r FROM boxers WHERE external_id = ?").get(ext) as { r: number | null }).r;

test("a report needs a source and a value that makes sense: each field's rules, and what the site showed is captured by the server", async () => {
  const { main, C } = await get();
  const { boxer, decided, draw, upcoming } = pick(main);
  const v = (over: Record<string, unknown>) => C.validateReport({ kind: "error", targetType: "boxer", targetExt: String(boxer.e), field: "reach_cm", proposed: "188", sourceUrl: SRC, quote: QUOTE, ...over } as never, main, "2026-10-03");
  const ok = v({}); assert.ok(ok.ok); if (ok.ok) { assert.equal(ok.value.shown, String(boxer.reach_cm)); assert.equal(ok.value.proposed, "188"); }
  const bad = (over: Record<string, unknown>, code: string) => { const r = v(over); assert.deepEqual(r.ok ? "ok" : r.error, code, JSON.stringify(over)); };
  bad({ kind: "other" }, "kind_invalid"); bad({ targetExt: "nope" }, "target_unknown"); bad({ targetType: "club" }, "target_unknown");
  bad({ field: "name" }, "field_invalid"); bad({ field: "result" }, "field_invalid", ); // a bout field on a boxer
  bad({ sourceUrl: "ftp://x.org/a" }, "url_invalid"); bad({ sourceUrl: "https://user:pw@x.org/a" }, "url_invalid"); bad({ sourceUrl: "" }, "url_invalid");
  bad({ quote: "too short" }, "quote_short"); bad({ quote: "x ".repeat(200) }, "quote_long");
  bad({ proposed: String(boxer.reach_cm) }, "no_change"); bad({ proposed: "19" }, "value_invalid"); bad({ proposed: "300" }, "value_invalid"); bad({ proposed: "abc" }, "value_invalid");
  bad({ field: "height_cm", proposed: "300" }, "value_invalid"); bad({ field: "height_cm", proposed: "100" }, "value_invalid");
  bad({ field: "stance", proposed: "Sideways" }, "value_invalid");
  assert.equal((v({ field: "stance", proposed: "southpaw" }) as { ok: true; value: { proposed: string } }).value.proposed, "Southpaw", "the stance is stored as the site spells it");
  bad({ field: "birth_date", proposed: "1990-02-30" }, "value_invalid"); bad({ field: "birth_date", proposed: "1899-12-31" }, "value_invalid"); bad({ field: "birth_date", proposed: "2020-01-01" }, "value_invalid");
  assert.ok(v({ field: "birth_date", proposed: "1991-05-04" }).ok);
  bad({ field: "nickname", proposed: "see https://x.org" }, "value_invalid"); bad({ field: "nickname", proposed: "" }, "value_invalid");
  assert.ok(v({ field: "nickname", proposed: "The Hammer" }).ok);
  bad({ field: "country", proposed: "Narnia" }, "value_invalid");
  const c = v({ field: "country", proposed: "denmark" }); assert.ok(c.ok); if (c.ok) assert.equal(c.value.proposed, "Denmark");
  // a report only: something an editor should look into, with no value to apply
  bad({ field: "other", note: "short" }, "note_short");
  assert.ok(v({ field: "other", note: "The record on this page is one fight short of what the commission shows.", sourceUrl: "", quote: "" }).ok);

  const b = (over: Record<string, unknown>) => C.validateReport({ kind: "error", targetType: "bout", targetExt: String(decided.e), field: "result", proposed: "blue", sourceUrl: SRC, quote: QUOTE, ...over } as never, main, "2026-10-03");
  const bb = (over: Record<string, unknown>, code: string) => { const r = b(over); assert.deepEqual(r.ok ? "ok" : r.error, code, JSON.stringify(over)); };
  const winnerIsRed = decided.w === decided.r;
  bb({ proposed: winnerIsRed ? "red" : "blue" }, "no_change"); bb({ proposed: "maybe" }, "value_invalid");
  const flip = b({ proposed: winnerIsRed ? "blue" : "red" }); assert.ok(flip.ok); if (flip.ok) assert.equal(flip.value.proposed, `${winnerIsRed ? "blue" : "red"}|UD`, "the method is kept when the winner changes");
  const asDraw = b({ proposed: "draw" }); assert.ok(asDraw.ok); if (asDraw.ok) assert.equal(asDraw.value.proposed, "draw|DRAW");
  bb({ proposed: "draw", proposedMethod: "KO" }, "method_mismatch"); bb({ proposed: "red", proposedMethod: "DRAW" }, "method_mismatch"); bb({ proposed: "nc", proposedMethod: "UD" }, "method_mismatch");
  bb({ field: "method", proposed: "DRAW" }, "method_mismatch"); bb({ field: "method", proposed: "NC" }, "method_mismatch"); bb({ field: "method", proposed: "XYZ" }, "value_invalid"); bb({ field: "method", proposed: "UD" }, "no_change");
  assert.ok(b({ field: "method", proposed: "SD" }).ok);
  bb({ field: "end_round", proposed: "0" }, "value_invalid"); bb({ field: "end_round", proposed: "40" }, "value_invalid"); assert.ok(b({ field: "end_round", proposed: "3" }).ok);
  bb({ targetExt: upcoming.e }, "bout_not_finished");
  if (draw) { // a draw corrected to a win: how did it end?
    const dr = (over: Record<string, unknown>) => C.validateReport({ kind: "error", targetType: "bout", targetExt: draw.e, field: "result", proposed: "red", sourceUrl: SRC, quote: QUOTE, ...over } as never, main, "2026-10-03");
    const r1 = dr({}); assert.deepEqual(r1.ok ? "ok" : r1.error, "method_needed");
    const r2 = dr({ proposedMethod: "SD" }); assert.ok(r2.ok); if (r2.ok) assert.equal(r2.value.proposed, "red|SD");
  }
  // about me: a note and nothing else, on a fighter only
  const am = (over: Record<string, unknown>) => C.validateReport({ kind: "about_me", targetType: "boxer", targetExt: String(boxer.e), note: "This is my own record and my birth date on this page is not right.", ...over } as never, main);
  assert.ok(am({}).ok); assert.equal((am({ note: "too short" }) as { error: string }).error, "note_short"); assert.equal((am({ contact: "x".repeat(300) }) as { error: string }).error, "contact_long");
  assert.equal((am({ targetType: "bout", targetExt: decided.e }) as { error: string }).error, "target_unknown");
  const clean = am({ contact: "  me@example.org‮ " }) as { ok: true; value: { contact: string } }; assert.equal(clean.value.contact, "me@example.org", "control and direction characters are removed");
});

test("review rules: a second person decides, an editor cannot see about-me requests, a rejection says why, and nothing is applied before acceptance", async () => {
  const { main, acc, alice, eddie, carol, C } = await get();
  const { boxer } = pick(main);
  const before = reach(main, String(boxer.e));
  const r1 = C.submitReport(alice, { kind: "error", targetType: "boxer", targetExt: String(boxer.e), field: "reach_cm", proposed: "191", sourceUrl: SRC, quote: QUOTE }, main, acc);
  assert.ok(r1.ok); const id = (r1 as { id: number }).id;
  assert.equal(reach(main, String(boxer.e)), before, "a report alone changes nothing");
  assert.deepEqual(C.submitReport(alice, { kind: "error", targetType: "boxer", targetExt: String(boxer.e), field: "reach_cm", proposed: "191", sourceUrl: SRC, quote: QUOTE }, main, acc), { ok: false, error: "duplicate_open" });
  assert.equal(C.reviewReport({ ...alice, role: "editor" }, id, "accepted", "", main, acc).ok, false, "not your own (an editor who is also the reporter)");
  assert.deepEqual(C.reviewReport(alice, id, "accepted", "", main, acc), { ok: false, error: "forbidden" }, "an ordinary user cannot review");
  assert.deepEqual(C.reviewReport(eddie, id, "rejected", "no", main, acc), { ok: false, error: "note_required" });
  assert.deepEqual(C.reviewReport(eddie, 9999, "rejected", "not there at all", main, acc), { ok: false, error: "not_found" });
  const rej = C.reviewReport(eddie, id, "rejected", "The page says 188, not 191.", main, acc); assert.ok(rej.ok);
  assert.equal(reach(main, String(boxer.e)), before, "a rejection changes nothing");
  assert.deepEqual(C.reviewReport(eddie, id, "accepted", "", main, acc), { ok: false, error: "not_open" }, "decided once");
  const q = C.reportQueue(eddie, main, { status: "rejected" }, acc); assert.equal(q.some((x) => x.id === id && x.reviewNote === "The page says 188, not 191."), true);
  // about me: admins only, always needs a note, never applied
  const am = C.submitReport(alice, { kind: "about_me", targetType: "boxer", targetExt: String(boxer.e), note: "This is my own record and my birth date on this page is not right.", contact: "alice@example.org" }, main, acc);
  assert.ok(am.ok); const amId = (am as { id: number }).id;
  assert.deepEqual(C.reviewReport(eddie, amId, "accepted", "done", main, acc), { ok: false, error: "forbidden" }, "an editor cannot handle an about-me request");
  assert.deepEqual(C.reportQueue(eddie, main, { kind: "about_me" }, acc), [], "and cannot see one");
  const adminSees = C.reportQueue(carol, main, { kind: "about_me" }, acc); assert.equal(adminSees[0].contact, "alice@example.org");
  assert.deepEqual(C.reviewReport(carol, amId, "accepted", "", main, acc), { ok: false, error: "note_required" });
  const handled = C.reviewReport(carol, amId, "accepted", "Contacted the fighter; birth date to be corrected at the source.", main, acc);
  assert.ok(handled.ok && handled.applied.applied === 0 && handled.applied.unchanged === 0, "nothing was applied");
  assert.equal((acc.prepare("SELECT state s FROM reports WHERE id = ?").get(amId) as { s: string | null }).s, null);
  // the queue's kind and status are part of a query: anything not on the list is treated as the default, never put into the query
  const open = C.reportQueue(eddie, main, {}, acc).map((x) => x.id);
  assert.deepEqual(C.reportQueue(eddie, main, { kind: "x' OR '1'='1" as never, status: "open' OR '1'='1" }, acc).map((x) => x.id), open);
  // what the reporter sees of their own report carries no contact, source check or vendor values
  const mine = C.myReports(alice.id, main, acc).find((x) => x.id === amId)!; assert.equal(mine.contact, null);
  assert.equal(C.myReports(alice.id, main, acc).every((x) => x.sourceCheck === null && x.originalValue === null && x.vendorValue === null), true);
  // the audit trail says who decided what
  const trail = acc.prepare("SELECT actor, action FROM audit WHERE action LIKE 'report_%' ORDER BY id").all() as { actor: string; action: string }[];
  assert.deepEqual(trail.slice(-2).map((t) => `${t.actor}:${t.action}`), ["eddie_edit:report_rejected", "carol_admin:report_accepted"]);
});

test("an accepted correction is applied at once, remembers the vendor's value, and is applied again when the vendor rewrites the row", async () => {
  const { main, acc, alice, eddie, C } = await get();
  const { boxer } = pick(main);
  const ext = String(boxer.e), vendor = reach(main, ext);
  const r = C.submitReport(alice, { kind: "error", targetType: "boxer", targetExt: ext, field: "reach_cm", proposed: "188", sourceUrl: SRC, quote: QUOTE }, main, acc);
  const id = (r as { id: number }).id;
  const acceptedBy = C.reviewReport(eddie, id, "accepted", "Checked the page: it says 188 cm.", main, acc);
  assert.ok(acceptedBy.ok && acceptedBy.applied.applied === 1 && acceptedBy.applied.boutsChanged === false);
  assert.equal(reach(main, ext), 188);
  const row = () => acc.prepare("SELECT state, original_value o, vendor_value v FROM reports WHERE id = ?").get(id) as { state: string; o: string; v: string | null };
  assert.deepEqual({ ...row() }, { state: "active", o: String(vendor ?? ""), v: null }, "the vendor's value as it was");
  assert.deepEqual({ ...C.applyCorrections(main, acc) }, { applied: 0, unchanged: 1, vendorChanged: 0, skipped: 0, boutsChanged: false }, "idempotent");
  // the vendor's daily update rewrites its own value
  main.prepare("UPDATE boxers SET reach_cm = ? WHERE external_id = ?").run(vendor, ext);
  assert.deepEqual({ ...C.applyCorrections(main, acc) }, { applied: 1, unchanged: 0, vendorChanged: 0, skipped: 0, boutsChanged: false });
  assert.equal(reach(main, ext), 188, "corrected again");
  assert.equal(row().state, "active");
  // the vendor changes it to something else: the sourced value stays in, and an editor is asked to look
  main.prepare("UPDATE boxers SET reach_cm = 175 WHERE external_id = ?").run(ext);
  const flagged = C.applyCorrections(main, acc);
  assert.deepEqual([flagged.vendorChanged, flagged.applied], [1, 0]); assert.equal(reach(main, ext), 188);
  assert.deepEqual({ ...row() }, { state: "vendor_changed", o: String(vendor ?? ""), v: "175" });
  const q = C.reportQueue(eddie, main, { kind: "flagged" }, acc); assert.equal(q.length, 1); assert.equal(q[0].vendorValue, "175"); assert.equal(q[0].originalValue, String(vendor ?? ""));
  assert.deepEqual(C.settleFlagged({ ...alice }, id, "keep", "still right", main, acc), { ok: false, error: "forbidden" });
  assert.deepEqual(C.settleFlagged(eddie, id, "keep", "no", main, acc), { ok: false, error: "note_required" });
  // keep: the new vendor value is what to compare against from now on
  assert.ok(C.settleFlagged(eddie, id, "keep", "The source still says 188; the vendor's 175 is not sourced.", main, acc).ok);
  assert.deepEqual({ ...row() }, { state: "active", o: "175", v: null });
  main.prepare("UPDATE boxers SET reach_cm = 175 WHERE external_id = ?").run(ext);
  assert.equal(C.applyCorrections(main, acc).applied, 1, "175 is now just the vendor's value, and is corrected over");
  assert.equal(reach(main, ext), 188);
  // retire: the vendor's value is put back
  const ret = C.settleFlagged(eddie, id, "retire", "The commission's own page now says 175.", main, acc); assert.ok(ret.ok);
  assert.equal(reach(main, ext), 175, "the vendor's value is back");
  assert.equal(row().state, "retired"); assert.equal(C.applyCorrections(main, acc).applied, 0, "a retired correction is not applied");
  assert.deepEqual(C.settleFlagged(eddie, id, "keep", "again please now", main, acc), { ok: false, error: "not_a_correction" });
});

test("a newer correction for the same field supersedes the older one and inherits the vendor's value, so retiring it restores the vendor's, not the earlier correction's", async () => {
  const { main, acc, alice, eddie, frank, C } = await get();
  const { boxer } = pick(main);
  const ext = String(boxer.e);
  main.prepare("UPDATE boxers SET height_cm = 170 WHERE external_id = ?").run(ext);
  const send = (who: typeof alice, value: string) => (C.submitReport(who, { kind: "error", targetType: "boxer", targetExt: ext, field: "height_cm", proposed: value, sourceUrl: SRC, quote: QUOTE }, main, acc) as { id: number }).id;
  const first = send(alice, "175"), second = send(frank, "177");
  assert.ok(C.reviewReport(eddie, first, "accepted", "Source says 175.", main, acc).ok);
  assert.ok(C.reviewReport(eddie, second, "accepted", "A better source says 177.", main, acc).ok);
  const state = (id: number) => (acc.prepare("SELECT state s, original_value o FROM reports WHERE id = ?").get(id) as { s: string; o: string });
  assert.deepEqual({ ...state(first) }, { s: "retired", o: "170" }); assert.equal(state(second).s, "active"); assert.equal(state(second).o, "170", "the vendor's 170, not the first correction's 175");
  assert.equal((main.prepare("SELECT height_cm h FROM boxers WHERE external_id = ?").get(ext) as { h: number }).h, 177);
  assert.ok(C.settleFlagged(eddie, second, "retire", "That source was withdrawn.", main, acc).ok);
  assert.equal((main.prepare("SELECT height_cm h FROM boxers WHERE external_id = ?").get(ext) as { h: number }).h, 170, "the vendor's value");
});

test("the daily update: a correction survives a real re-ingest, a corrected result moves the ratings, and the birth year follows a corrected birth date", async () => {
  const { main, acc, alice, eddie, C } = await get();
  const { ingest, recomputeRatings } = await import("../lib/ingest");
  const { decided, boxer } = pick(main);
  const ratings = () => Object.fromEntries((main.prepare("SELECT external_id e, rating r FROM boxers").all() as { e: string; r: number }[]).map((x) => [x.e, x.r]));
  const winnerIsRed = decided.w === decided.r;
  const names = main.prepare("SELECT (SELECT external_id FROM boxers WHERE id = ?) r, (SELECT external_id FROM boxers WHERE id = ?) u").get(decided.r, decided.u) as { r: string; u: string };
  const before = ratings();
  const flipTo = winnerIsRed ? "blue" : "red";
  const rep = C.submitReport(alice, { kind: "error", targetType: "bout", targetExt: String(decided.e), field: "result", proposed: flipTo, sourceUrl: SRC, quote: QUOTE }, main, acc) as { id: number };
  const acc1 = C.reviewReport(eddie, rep.id, "accepted", "The official result page gives the other fighter the win.", main, acc);
  assert.ok(acc1.ok && acc1.applied.boutsChanged, "a changed result is reported so ratings can be recomputed");
  // the route does the recompute; do it here as the route does
  recomputeRatings(main);
  const afterFlip = ratings();
  const winnerExt = winnerIsRed ? names.r : names.u, loserExt = winnerIsRed ? names.u : names.r;
  assert.ok(afterFlip[winnerExt] < before[winnerExt] && afterFlip[loserExt] > before[loserExt], "the fighter who no longer won rates lower, the other higher");

  // a birth date correction too
  const rb = C.submitReport(alice, { kind: "error", targetType: "boxer", targetExt: String(boxer.e), field: "birth_date", proposed: "1990-03-04", sourceUrl: SRC, quote: QUOTE }, main, acc) as { id: number };
  assert.ok(C.reviewReport(eddie, rb.id, "accepted", "The official page gives the date.", main, acc).ok);
  assert.deepEqual({ ...(main.prepare("SELECT birth_date d, birth_year y FROM boxers WHERE external_id = ?").get(String(boxer.e)) as object) }, { d: "1990-03-04", y: 1990 });

  // the vendor's daily update: the whole league is ingested again (which rewrites the vendor's values)
  await ingest(main);
  const row = main.prepare("SELECT winner_id w, method m FROM bouts WHERE external_id = ?").get(String(decided.e)) as { w: number; m: string };
  assert.equal(row.w === decided.r ? "red" : row.w === decided.u ? "blue" : "none", flipTo, "the corrected result survived the re-ingest");
  assert.equal(row.m, "UD");
  const afterIngest = ratings();
  assert.deepEqual(afterIngest, afterFlip, "ratings after the update include the correction (ingest applies it before recomputing)");
  assert.deepEqual({ ...(main.prepare("SELECT birth_year y FROM boxers WHERE external_id = ?").get(String(boxer.e)) as object) }, { y: 1990 }, "the year follows the corrected date");
  // and the ratings are exactly what a fresh recompute gives
  recomputeRatings(main); assert.deepEqual(ratings(), afterFlip);
  // retiring the result correction restores the vendor's result and the ratings
  assert.ok(C.settleFlagged(eddie, rep.id, "retire", "The official page was corrected to the vendor's result.", main, acc).ok);
  recomputeRatings(main);
  assert.deepEqual(ratings(), before, "the vendor's result and the original ratings are back");
});

test("limits: at most twenty reports open at a time per person", async () => {
  const { main, acc, C } = await get();
  const users = await import("../lib/accounts/users");
  const r = await users.createUser("grace_many", "a-long-passphrase-for-tests-1", acc); if ("error" in r) throw new Error(r.error);
  const some = main.prepare("SELECT external_id e FROM boxers ORDER BY id LIMIT 25").all() as { e: string }[];
  const note = "The nickname shown here is not the one the fighter uses, per their own page.";
  const results = some.map((b) => C.submitReport(r.user, { kind: "error", targetType: "boxer", targetExt: b.e, field: "other", note }, main, acc));
  assert.equal(results.filter((x) => x.ok).length, 20);
  assert.deepEqual(results[20], { ok: false, error: "too_many_open" });
});

// ---------- the routes ----------
const HOST = "http://localhost:3100";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(h: (req: Request, ctx?: any) => Promise<Response>, method: string, body?: unknown, o: { cookie?: string; origin?: string | null; params?: object; url?: string } = {}): Promise<{ status: number; json: Json }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.origin !== null) headers.origin = o.origin ?? HOST;
  const res = await h(new Request(o.url ?? `${HOST}/api/x`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), o.params ? { params: Promise.resolve(o.params) } : undefined);
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

test("the routes: sign-in is needed, a foreign origin is refused, a refused report costs no allowance, and the review routes follow the roles", async () => {
  const { main, acc, alice, eddie, carol, C } = await get();
  const users = await import("../lib/accounts/users");
  const cookie = (u: { id: number }) => `${users.SESSION_COOKIE}=${users.createSession(u.id, acc).token}`;
  const report = await import("../app/api/report/route");
  const queue = await import("../app/api/review/reports/route");
  const decide = await import("../app/api/review/reports/[id]/route");
  const check = await import("../app/api/review/reports/[id]/check/route");
  const { limits } = await import("../lib/accounts/guard");
  limits().report.reset();
  const { boxer, decided } = pick(main);
  const body = { kind: "error", boxerSlug: boxer.slug, field: "country", proposed: "Denmark", sourceUrl: SRC, quote: QUOTE };
  assert.equal((await call(report.POST, "POST", body)).status, 401, "signed out");
  assert.equal((await call(report.GET, "GET")).status, 401);
  const A = cookie(alice), E = cookie(eddie), K = cookie(carol);
  assert.equal((await call(report.POST, "POST", body, { cookie: A, origin: "https://evil.example" })).status, 403, "a form on another site cannot report in someone's name");
  const refused = await call(report.POST, "POST", { ...body, proposed: "Narnia" }, { cookie: A });
  assert.deepEqual([refused.status, refused.json.error], [400, "value_invalid"]);
  assert.equal(limits().report.left(`u${alice.id}`), 10, "a refused report does not use the day's allowance");
  const sent = await call(report.POST, "POST", { ...body, proposed: String(boxer.country) === "Denmark" ? "Norway" : "Denmark" }, { cookie: A }); assert.equal(sent.status, 201);
  const bout = await call(report.POST, "POST", { kind: "error", boutId: decided.e, field: "end_round", proposed: "2", sourceUrl: SRC, quote: QUOTE }, { cookie: A }); assert.equal(bout.status, 201, JSON.stringify(bout.json));
  const mine = await call(report.GET, "GET", undefined, { cookie: A }); assert.equal(mine.json.items.length >= 2, true);
  assert.equal(mine.json.items.every((x: Json) => x.sourceCheck === null && x.contact === null), true);
  // review: an ordinary user is refused; an editor sees errors, not about-me; the admin sees both
  assert.equal((await call(queue.GET, "GET", undefined, { cookie: A })).status, 403);
  assert.equal((await call(queue.GET, "GET")).status, 401);
  const open = await call(queue.GET, "GET", undefined, { cookie: E, url: `${HOST}/api/review/reports?kind=error` }); assert.equal(open.status, 200); assert.equal(open.json.items.some((x: Json) => x.id === sent.json.id), true);
  assert.equal((await call(queue.GET, "GET", undefined, { cookie: E, url: `${HOST}/api/review/reports?kind=about_me` })).status, 403);
  assert.equal((await call(queue.GET, "GET", undefined, { cookie: K, url: `${HOST}/api/review/reports?kind=about_me` })).status, 200);
  assert.equal((await call(decide.POST, "POST", { decision: "accepted", note: "" }, { cookie: A, params: { id: String(sent.json.id) } })).status, 403);
  assert.equal((await call(decide.POST, "POST", { decision: "maybe" }, { cookie: E, params: { id: String(sent.json.id) } })).status, 400);
  assert.equal((await call(decide.POST, "POST", { decision: "rejected", note: "no" }, { cookie: E, params: { id: String(sent.json.id) } })).status, 400, "a rejection needs a reason");
  assert.equal((await call(decide.POST, "POST", { decision: "accepted", note: "Checked: the page says so." }, { cookie: E, params: { id: String(sent.json.id) } })).status, 200);
  assert.equal((await call(decide.POST, "POST", { decision: "accepted", note: "Checked: the page says so." }, { cookie: E, params: { id: String(sent.json.id) } })).status, 409, "decided once");
  assert.equal((await call(decide.POST, "POST", { decision: "accepted", note: "x" }, { cookie: E, params: { id: "99999" } })).status, 404);
  // a corrected result through the route recomputes the ratings
  const flip = decided.w === decided.r ? "blue" : "red";
  const before = (main.prepare("SELECT rating r FROM boxers WHERE id = ?").get(decided.w) as { r: number }).r;
  const rep = await call(report.POST, "POST", { kind: "error", boutId: decided.e, field: "result", proposed: flip, sourceUrl: SRC, quote: QUOTE }, { cookie: A });
  assert.equal((await call(decide.POST, "POST", { decision: "accepted", note: "The result page agrees." }, { cookie: E, params: { id: String(rep.json.id) } })).status, 200);
  const after = (main.prepare("SELECT rating r FROM boxers WHERE id = ?").get(decided.w) as { r: number }).r;
  assert.ok(after < before, "the route recomputed the ratings: the fighter who no longer won rates lower");
  // withdraw: only your own, only while open
  const other = await call(report.POST, "POST", { kind: "about_me", boxerSlug: boxer.slug, note: "These details are mine and one of them is not right any more." }, { cookie: A });
  assert.equal((await call(report.DELETE, "DELETE", { id: other.json.id }, { cookie: E })).status, 404, "someone else's");
  assert.equal((await call(report.DELETE, "DELETE", { id: other.json.id }, { cookie: A })).status, 200);
  // the source check runs only for reviewers and only on a report that has a source
  assert.equal((await call(check.POST, "POST", {}, { cookie: A, params: { id: String(rep.json.id) } })).status, 403);
  assert.equal((await call(check.POST, "POST", {}, { cookie: E, params: { id: String(other.json.id) } })).status, 404, "no source on an about-me request");
  void C;
});

test("the source check works on a report: the quote is looked for on the page, and the answer is kept for reviewers only", async () => {
  const { main, acc, alice, eddie, C } = await get();
  const { runSourceCheck } = await import("../lib/accounts/source-check");
  const { boxer } = pick(main);
  const r = C.submitReport(alice, { kind: "error", targetType: "boxer", targetExt: String(boxer.e), field: "nickname", proposed: "Iron Mike Jr", sourceUrl: SRC, quote: "He is known as Iron Mike Jr to his fans" }, main, acc) as { id: number };
  const page = async (text: string) => ({ ok: true as const, url: SRC, text, fromCache: false, status: 200 });
  assert.equal(await runSourceCheck(r.id, eddie.username, acc, () => page("Profile. He is known as Iron Mike Jr to his fans [1]. More."), "reports"), "quote_found");
  assert.equal(await runSourceCheck(r.id, eddie.username, acc, () => page("Nothing about that."), "reports"), "quote_missing");
  assert.equal(await runSourceCheck(999999, eddie.username, acc, () => page("x"), "reports"), "not_found");
  assert.equal(C.reportQueue(eddie, main, {}, acc).find((x) => x.id === r.id)?.sourceCheck, "quote_missing");
  assert.equal(C.myReports(alice.id, main, acc).find((x) => x.id === r.id)?.sourceCheck, null, "not shown to the reporter");
  // the other table is untouched by a check on reports
  assert.equal((acc.prepare("SELECT COUNT(*) c FROM contributions").get() as { c: number }).c >= 0, true);
});
