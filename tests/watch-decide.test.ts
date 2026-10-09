import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";

/**
 * Deciding on proposed source changes (PLAN 253, step B). What must hold: only an administrator can decide (an editor, a member and a stranger cannot); approving is the only
 * thing that writes to the reigns we hold, and it writes exactly the change that was shown; a change that no longer fits what is held is refused and stays pending; a decision
 * is made once; a rejection needs a reason and is remembered; every decision leaves an audit row; and the routes keep to the same rules.
 */
process.env.RINGSIDE_NO_SEED = "1";
process.env.WIKIMEDIA_CONTACT = "tests@example.invalid";
const cleanup = tempDb("watch-decide");
const accFile = path.join(os.tmpdir(), `ringside-test-watch-decide-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

const fx = (n: string) => fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "wikipedia", n), "utf8");
const WBO = "List_of_WBO_world_champions";
const ORIGINAL: Record<string, string> = { [WBO]: fx("wbo-excerpt.wikitext"), List_of_IBF_world_champions: fx("ibf-excerpt.wikitext") };
const QIDS: Record<string, string> = { "Francesco Damiani": "Q1", "Ray Mercer": "Q2", "Larry Holmes": "Q3", "Michael Moorer": "Q4" };
let pages = { ...ORIGINAL };
const impl = (async (input: RequestInfo | URL) => {
  const p = new URL(String(input)).searchParams;
  if (p.get("action") === "parse") return Response.json({ parse: { title: p.get("page")!.replace(/_/g, " "), revid: 555, wikitext: pages[p.get("page")!] } });
  return Response.json({ query: { pages: (p.get("titles") ?? "").split("|").map((t) => (QIDS[t] ? { title: t, pageprops: { wikibase_item: QIDS[t] } } : { title: t, missing: true })) } });
}) as typeof fetch;
const CHAMPION_SOURCES = [{ org: "WBO", page: WBO, sex: "male" as const }, { org: "IBF", page: "List_of_IBF_world_champions", sex: "male" as const }];

let main: DatabaseSync, acc: DatabaseSync;
let run: typeof import("../lib/watch/run");
let props: typeof import("../lib/watch/proposals");
let dec: typeof import("../lib/watch/decide");
let admin: import("../lib/accounts/users").User, editor: import("../lib/accounts/users").User, member: import("../lib/accounts/users").User;
const watch = () => run.runWatch("champions", { main, championSources: CHAMPION_SOURCES, fetch: { fetchImpl: impl, sleep: async () => {} }, log: () => {} }, acc);
const reigns = () => main.prepare("SELECT * FROM title_reigns WHERE source = ? ORDER BY id").all(WBO) as Record<string, unknown>[];
const reset = () => { pages = { ...ORIGINAL }; acc.exec("DELETE FROM proposals; DELETE FROM audit"); };
const mercer = () => reigns().find((r) => r.name === "Ray Mercer")!;
const MERCER_END = "|11 Jan – 28 Dec 1991";

before(async () => {
  main = await (await import("../lib/db")).getDb();
  acc = (await import("../lib/accounts/store")).accountsDb();
  run = await import("../lib/watch/run"); props = await import("../lib/watch/proposals"); dec = await import("../lib/watch/decide");
  const users = await import("../lib/accounts/users");
  const mk = async (name: string, role: "user" | "editor" | "admin") => {
    const r = await users.createUser(name, "a-long-passphrase-for-tests-1", acc);
    if ("error" in r) throw new Error(r.error);
    if (role !== "user") users.setRole(name, role, acc);
    return { ...r.user, role };
  };
  admin = await mk("root_admin", "admin"); editor = await mk("eddie_ed", "editor"); member = await mk("mia_member", "user");
  const { importChampions } = await import("../lib/importers/wikipedia-champions");
  await importChampions(main, { sources: CHAMPION_SOURCES, fetchImpl: impl, sleep: async () => {} });
});

test("only an administrator can decide: an editor, a member and a stranger cannot, and nothing changes", async () => {
  reset();
  pages[WBO] = ORIGINAL[WBO].replace(MERCER_END, "|11 Jan – 29 Dec 1991");
  await watch();
  const [p] = props.listProposals(acc);
  const before = JSON.stringify(reigns());
  for (const who of [editor, member, null]) assert.deepEqual(dec.decide(who, [p.id], "approved", "", main, acc), { error: "forbidden" });
  assert.equal(JSON.stringify(reigns()), before);
  assert.equal(props.listProposals(acc).length, 1, "still waiting");
});

test("approving writes exactly the change shown, marks who and when, and leaves an audit row; a second approval is refused", async () => {
  reset();
  pages[WBO] = ORIGINAL[WBO].replace(MERCER_END, "|11 Jan – 29 Dec 1991");
  await watch();
  const [p] = props.listProposals(acc);
  assert.equal(mercer().end_date, "1991-12-28");
  const r = dec.decide(admin, [p.id], "approved", "checked the page", main, acc);
  assert.ok(!("error" in r)); assert.deepEqual([r.approved, r.changedData], [1, true]);
  assert.equal(mercer().end_date, "1991-12-29");
  assert.equal(mercer().revision, "555");
  const done = props.listProposals(acc, { status: "approved" })[0];
  assert.deepEqual([done.decidedBy, done.note], ["root_admin", "checked the page"]);
  const log = acc.prepare("SELECT actor, action, target FROM audit WHERE action = 'update.approve'").all() as { actor: string; action: string; target: string }[];
  assert.deepEqual(log.map((x) => ({ ...x })), [{ actor: "root_admin", action: "update.approve", target: `proposal:${p.id}` }]);
  const again = dec.decide(admin, [p.id], "approved", "", main, acc);
  assert.ok(!("error" in again)); assert.deepEqual(again.results, [{ id: p.id, ok: false, error: "not_pending" }]);
  const next = await watch();
  assert.equal(next.changes, 0, "the data now agrees with the page");
  main.prepare("UPDATE title_reigns SET end_date = '1991-12-28' WHERE id = ?").run(mercer().id as number); // put it back for the tests that follow
});

test("an added reign is inserted, a removed reign is deleted, and nothing else moves", async () => {
  reset();
  const before = reigns();
  pages[WBO] = ORIGINAL[WBO]
    .replace("|-align=center\n!3\n|align=left | [[Michael Moorer]]", "|-align=center\n!3\n|align=left | [[Newly Crowned]]\n|1 Mar 1992 – 14 May 1992\n|0\n|-align=center\n!4\n|align=left | [[Michael Moorer]]")
    .replace(/\|-align=center\n!5\n\|align=left \| \[\[Michael Bentt\]\]\n[^\n]*\n[^\n]*\n/, "");
  await watch();
  const ps = props.listProposals(acc);
  assert.deepEqual(ps.map((p) => p.kind).sort(), ["reign_added", "reign_removed"]);
  const r = dec.decide(admin, ps.map((p) => p.id), "approved", "", main, acc);
  assert.ok(!("error" in r)); assert.equal(r.approved, 2);
  const after = reigns();
  assert.ok(after.some((x) => x.name === "Newly Crowned" && x.start_date === "1992-03-01"));
  assert.ok(!after.some((x) => x.name === "Michael Bentt"));
  assert.equal(after.length, before.length, "one in, one out");
  assert.equal((await watch()).changes, 0);
  // put the table back for the tests that follow
  main.exec(`DELETE FROM title_reigns WHERE source = '${WBO}'`);
  const ins = main.prepare(`INSERT INTO title_reigns (${Object.keys(before[0]).join(",")}) VALUES (${Object.keys(before[0]).map(() => "?").join(",")})`);
  for (const b of before) ins.run(...(Object.values(b) as (string | number | null)[]));
});

test("a change that no longer fits what is held is refused and stays pending, and a rejection needs a reason and is not raised again", async () => {
  reset();
  pages[WBO] = ORIGINAL[WBO].replace(MERCER_END, "|11 Jan – 29 Dec 1991");
  await watch();
  const [p] = props.listProposals(acc);
  main.prepare("UPDATE title_reigns SET end_date = '1991-12-30' WHERE id = ?").run(mercer().id as number); // the held reign moved on since the proposal was made
  const r = dec.decide(admin, [p.id], "approved", "", main, acc);
  assert.ok(!("error" in r)); assert.deepEqual(r.results, [{ id: p.id, ok: false, error: "stale" }]);
  assert.equal(mercer().end_date, "1991-12-30", "nothing was written");
  assert.equal(props.listProposals(acc).length, 1, "still pending");
  main.prepare("UPDATE title_reigns SET end_date = '1991-12-28' WHERE id = ?").run(mercer().id as number);

  assert.deepEqual(dec.decide(admin, [p.id], "rejected", "  ", main, acc), { error: "note_required" });
  const rej = dec.decide(admin, [p.id], "rejected", "the page is wrong here", main, acc);
  assert.ok(!("error" in rej)); assert.equal(rej.rejected, 1);
  assert.equal(mercer().end_date, "1991-12-28", "rejecting changes nothing");
  const again = await watch();
  assert.deepEqual([again.proposals!.added, again.proposals!.remembered], [0, 1]);
});

test("a batch is decided id by id, an unknown id does not stop the rest, and more than fifty at once is refused", async () => {
  reset();
  pages[WBO] = ORIGINAL[WBO].replace(MERCER_END, "|11 Jan – 29 Dec 1991");
  await watch();
  const [p] = props.listProposals(acc);
  const r = dec.decide(admin, [99999, p.id], "approved", "", main, acc);
  assert.ok(!("error" in r));
  assert.deepEqual(r.results, [{ id: 99999, ok: false, error: "not_found" }, { id: p.id, ok: true }]);
  assert.deepEqual(dec.decide(admin, Array.from({ length: 51 }, (_, i) => i + 1), "approved", "", main, acc), { error: "too_many" });
  assert.deepEqual(dec.decide(admin, [], "approved", "", main, acc), { error: "too_many" });
  main.prepare("UPDATE title_reigns SET end_date = '1991-12-28' WHERE id = ?").run(mercer().id as number);
});

// ---- the routes ---------------------------------------------------------------------------------------------------------------------------------
const HOST = "http://localhost:3100";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(h: (req: Request) => Promise<Response>, method: string, body?: unknown, o: { cookie?: string; origin?: string | null; url?: string } = {}): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "10.8.8.8" };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.origin !== null) headers.origin = o.origin ?? HOST;
  const res = await h(new Request(o.url ?? `${HOST}/api/review/updates`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

test("the routes: signed out is 401, editors and members are 403, a foreign origin is refused, and an administrator can list and decide", async () => {
  reset();
  pages[WBO] = ORIGINAL[WBO].replace(MERCER_END, "|11 Jan – 29 Dec 1991");
  await watch();
  const users = await import("../lib/accounts/users");
  const route = await import("../app/api/review/updates/route");
  const cookie = (u: { id: number }) => `${users.SESSION_COOKIE}=${users.createSession(u.id, acc).token}`;
  const A = cookie(admin), E = cookie(editor), M = cookie(member);
  const [p] = props.listProposals(acc);
  assert.equal((await call(route.GET, "GET")).status, 401);
  assert.equal((await call(route.GET, "GET", undefined, { cookie: E })).status, 403, "editors keep the report queues, not this one");
  assert.equal((await call(route.GET, "GET", undefined, { cookie: M })).status, 403);
  assert.equal((await call(route.POST, "POST", { ids: [p.id], decision: "approved" })).status, 401);
  assert.equal((await call(route.POST, "POST", { ids: [p.id], decision: "approved" }, { cookie: E })).status, 403);
  assert.equal((await call(route.POST, "POST", { ids: [p.id], decision: "approved" }, { cookie: A, origin: "https://evil.example" })).status, 403, "a form on another site cannot decide in the administrator's name");
  assert.equal((await call(route.POST, "POST", { ids: "1", decision: "approved" }, { cookie: A })).status, 400);
  assert.equal((await call(route.POST, "POST", { ids: [p.id], decision: "maybe" }, { cookie: A })).status, 400);
  assert.equal((await call(route.POST, "POST", { ids: [p.id], decision: "rejected" }, { cookie: A })).status, 400, "a rejection needs a note");
  const list = await call(route.GET, "GET", undefined, { cookie: A });
  assert.equal(list.status, 200); assert.equal(list.json.items.length, 1); assert.equal(list.json.counts.pending, 1); assert.equal(list.json.max, 50);
  assert.equal(list.json.sources[0].id, "wikipedia:champions");
  const sent = await call(route.POST, "POST", { ids: [p.id], decision: "approved", note: "ok" }, { cookie: A });
  assert.equal(sent.status, 200, JSON.stringify(sent.json)); assert.equal(sent.json.approved, 1);
  assert.equal(mercer().end_date, "1991-12-29");
  assert.equal((await call(route.GET, "GET", undefined, { cookie: A, url: `${HOST}/api/review/updates?status=approved` })).json.items.length, 1);
  assert.equal((await call(route.GET, "GET", undefined, { cookie: A, url: `${HOST}/api/review/updates?status=bogus` })).status, 400);
  const stale = await call(route.POST, "POST", { ids: [p.id], decision: "approved" }, { cookie: A });
  assert.equal(stale.json.results[0].error, "not_pending");
  main.prepare("UPDATE title_reigns SET end_date = '1991-12-28' WHERE id = ?").run(mercer().id as number);
});

test("/api/health counts what is waiting, and says nothing when nothing is", async () => {
  reset();
  const health = await import("../app/api/health/route");
  const none = await (await health.GET()).json();
  assert.equal("updatesWaiting" in none.data, false);
  pages[WBO] = ORIGINAL[WBO].replace(MERCER_END, "|11 Jan – 29 Dec 1991");
  await watch();
  const some = await (await health.GET()).json();
  assert.equal(some.data.updatesWaiting, 1);
  assert.deepEqual(Object.keys(some.data).sort().filter((k) => k === "updatesWaiting"), ["updatesWaiting"]);
});
