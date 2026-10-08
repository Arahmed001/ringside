import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";

process.env.WIKIMEDIA_CONTACT = "tests@invalid.example"; // identifies the bot; no real request is ever made (fetch is mocked)
process.env.WIKIDATA_GAP_MS = "0";
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("wikidata-import");
after(cleanup);

let wd: typeof import("../lib/importers/wikidata");
let db: DatabaseSync;
before(async () => { wd = await import("../lib/importers/wikidata"); db = await (await import("../lib/db")).getDb(); });

/** A fake Wikidata Query Service holding 7 boxers; Q3 is in the Hall of Fame and Q5 has an Olympedia ID. */
const ALL = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"];
let calls: { list: number; bio: number; extras: number; bioIds: string[]; extraIds: string[] };
const fresh = () => { calls = { list: 0, bio: 0, extras: 0, bioIds: [], extraIds: [] }; };
fresh();
const realFetch = globalThis.fetch;
const v = (value: string) => ({ value });
const ent = (q: string) => v(`http://www.wikidata.org/entity/${q}`);
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  if (new URL(String(url)).hostname !== "query.wikidata.org") return new Response("{}", { status: 404 });
  const q = String(init?.body instanceof URLSearchParams ? init.body.get("query") : "");
  const json = (bindings: unknown[]) => new Response(JSON.stringify({ results: { bindings } }), { status: 200 });
  const ids = [...q.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
  if (/wdt:P4474/.test(q)) {
    calls.extras++; calls.extraIds.push(...ids);
    return json(ids.flatMap((id): Record<string, { value: string }>[] => id === "Q3" ? [{ b: ent(id), hof: v("modern/q3") }] : id === "Q5" ? [{ b: ent(id), oly: v("55") }] : id === "Q4" ? [{ b: ent(id), ar: v("اسم عربي"), nick: v("Four"), enwiki: v("Boxer Q4") }] : []));
  }
  if (/\?bLabel/.test(q)) {
    calls.bio++; calls.bioIds.push(...ids);
    return json(ids.map((id) => ({ b: ent(id), bLabel: v(`Boxer ${id}`), dob: v("1990-01-01T00:00:00Z"), dobPrec: v("11") })));
  }
  calls.list++;
  const limit = Number(q.match(/LIMIT (\d+)/)?.[1] ?? 5000), offset = Number(q.match(/OFFSET (\d+)/)?.[1] ?? 0);
  return json(ALL.slice(offset, offset + limit).map((id) => ({ b: ent(id) })));
}) as typeof fetch;
afterEach(() => { fresh(); });
test.after(() => { globalThis.fetch = realFetch; });

const staged = () => db.prepare("SELECT qid, ibhof_id h, olympedia_id o, extras_at e FROM wikidata_boxers ORDER BY qid").all() as { qid: string; h: string | null; o: string | null; e: string | null }[];

test("a first run stages everyone in batches, with extras, and records that extras were checked (even when empty)", async () => {
  const s = await wd.importWikidata(db, { batch: 3 });
  assert.deepEqual(s, { listed: 7, stored: 7, batches: 3, skipped: 0 });
  assert.deepEqual(calls.bioIds, ALL); assert.equal(calls.extras, 3);
  const rows = staged();
  assert.equal(rows.length, 7);
  assert.ok(rows.every((r) => r.e), "a boxer with no extras answer is still marked checked, or --extras-only would refetch it forever");
  assert.equal(rows.find((r) => r.qid === "Q3")!.h, "modern/q3"); assert.equal(rows.find((r) => r.qid === "Q5")!.o, "55");
});

test("a second run skips boxers fetched recently, and --force refetches them", async () => {
  const s = await wd.importWikidata(db, { batch: 3 });
  assert.deepEqual(s, { listed: 7, stored: 0, batches: 0, skipped: 7 });
  assert.equal(calls.bio, 0); assert.equal(calls.extras, 0);
  const f = await wd.importWikidata(db, { batch: 3, force: true });
  assert.equal(f.stored, 7); assert.deepEqual(calls.bioIds, ALL);
});

test("an interrupted run continues where it stopped: only the missing boxers are fetched", async () => {
  db.exec("DELETE FROM wikidata_boxers WHERE qid IN ('Q5','Q6','Q7')");
  const s = await wd.importWikidata(db, { batch: 3 });
  assert.deepEqual(calls.bioIds, ["Q5", "Q6", "Q7"]);
  assert.deepEqual({ stored: s.stored, skipped: s.skipped }, { stored: 3, skipped: 4 });
});

test("boxers fetched long ago are refreshed; --max-age-days controls what counts as recent", async () => {
  db.exec("UPDATE wikidata_boxers SET fetched_at = '2020-01-01T00:00:00.000Z' WHERE qid IN ('Q1','Q2')");
  const s = await wd.importWikidata(db, { batch: 10 });
  assert.deepEqual(calls.bioIds, ["Q1", "Q2"]); assert.equal(s.skipped, 5);
  fresh();
  assert.equal((await wd.importWikidata(db, { batch: 10, maxAgeDays: 0 })).stored, 7, "0 days: everything is stale");
});

test("--extras-only fills boxers staged before extras existed, without listing or refetching biographies", async () => {
  db.exec("UPDATE wikidata_boxers SET ibhof_id = NULL, olympedia_id = NULL, awards = NULL, extras_at = NULL WHERE qid IN ('Q3','Q4','Q5')");
  const before = db.prepare("SELECT name, fetched_at FROM wikidata_boxers WHERE qid = 'Q3'").get() as { name: string; fetched_at: string };
  const s = await wd.importWikidata(db, { batch: 2, extrasOnly: true });
  assert.equal(calls.list, 0, "no id listing"); assert.equal(calls.bio, 0, "no biography query");
  assert.deepEqual(calls.extraIds, ["Q3", "Q4", "Q5"]); assert.equal(calls.extras, 2);
  assert.deepEqual({ listed: s.listed, stored: s.stored, batches: s.batches }, { listed: 3, stored: 3, batches: 2 });
  const rows = staged();
  assert.equal(rows.find((r) => r.qid === "Q3")!.h, "modern/q3"); assert.equal(rows.find((r) => r.qid === "Q5")!.o, "55");
  assert.ok(rows.every((r) => r.e));
  assert.deepEqual({ ...(db.prepare("SELECT name, fetched_at FROM wikidata_boxers WHERE qid = 'Q3'").get() as object) }, { ...before }, "the biography row is untouched");
  fresh();
  assert.equal((await wd.importWikidata(db, { extrasOnly: true })).stored, 0, "nothing left to fill: no requests");
  assert.equal(calls.extras, 0);
});

test("--limit applies to --extras-only too, and --no-extras leaves extras alone", async () => {
  db.exec("UPDATE wikidata_boxers SET extras_at = NULL");
  assert.equal((await wd.importWikidata(db, { extrasOnly: true, limit: 2 })).stored, 2);
  fresh();
  db.exec("UPDATE wikidata_boxers SET extras_at = NULL, ibhof_id = 'keep/me' WHERE qid = 'Q1'");
  await wd.importWikidata(db, { force: true, extras: false, batch: 10 });
  assert.equal(calls.extras, 0);
  const q1 = staged().find((r) => r.qid === "Q1")!;
  assert.equal(q1.h, "keep/me", "a biography-only refresh must not blank the extras");
  assert.equal(q1.e, null, "and must not claim they were checked");
});

test("boxers staged before their Arabic names, nicknames and article titles were read are picked up by --extras-only and filled, and a second run asks for nothing", async () => {
  db.exec("UPDATE wikidata_boxers SET labels_at = NULL, ar_label = NULL, nickname = NULL, enwiki = NULL"); // staged by an older version: extras were read, labels were not
  const s = await wd.importWikidata(db, { batch: 4, extrasOnly: true });
  assert.equal(s.stored, 7, "every boxer without labels_at is asked for again");
  assert.deepEqual(calls.extraIds, ALL); assert.equal(calls.list, 0); assert.equal(calls.bio, 0);
  const q4 = db.prepare("SELECT ar_label a, nickname n, enwiki w, labels_at l FROM wikidata_boxers WHERE qid = 'Q4'").get() as { a: string | null; n: string | null; w: string | null; l: string | null };
  assert.deepEqual({ a: q4.a, n: q4.n, w: q4.w }, { a: "اسم عربي", n: "Four", w: "Boxer Q4" });
  assert.ok(q4.l, "marked as read, even for the boxers that have none (or they would be asked for again forever)");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM wikidata_boxers WHERE labels_at IS NULL").get() as { c: number }).c, 0);
  fresh();
  assert.equal((await wd.importWikidata(db, { extrasOnly: true })).stored, 0); assert.equal(calls.extras, 0);
});

test("a query the service keeps timing out on is retried as halves, so the run goes on instead of stopping", async () => {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const q = String(init?.body instanceof URLSearchParams ? init.body.get("query") : "");
    if (/\?bLabel/.test(q) && [...q.matchAll(/wd:(Q\d+)/g)].length > 2) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    return inner(url, init);
  }) as typeof fetch;
  try {
    const s = await wd.importWikidata(db, { batch: 7, force: true });
    assert.equal(s.stored, 7);
    assert.equal(staged().length, 7);
  } finally { globalThis.fetch = inner; }
});
