import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";

/**
 * The champions watcher (PLAN 253), on the saved real excerpts of Wikipedia's WBO and IBF lists. What must hold: a page that has not changed proposes nothing; a corrected date is
 * one change; a row inserted in the middle of a page is one change, not a shift of every later row; a page that changes shape (or is blanked) proposes nothing; a rejected change
 * is not raised again; and nothing here ever writes to the reigns we hold.
 */
process.env.RINGSIDE_NO_SEED = "1";
process.env.WIKIMEDIA_CONTACT = "tests@example.invalid";
const cleanup = tempDb("watch-champions");
const accFile = path.join(os.tmpdir(), `ringside-test-watch-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

const fx = (n: string) => fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "wikipedia", n), "utf8");
const ORIGINAL: Record<string, string> = { List_of_WBO_world_champions: fx("wbo-excerpt.wikitext"), List_of_IBF_world_champions: fx("ibf-excerpt.wikitext") };
const QIDS: Record<string, string> = { "Francesco Damiani": "Q1", "Ray Mercer": "Q2", "Larry Holmes": "Q3", "Michael Moorer": "Q4" };
let pages: Record<string, string> = { ...ORIGINAL };
let revision = 100;
const impl = (async (input: RequestInfo | URL) => {
  const p = new URL(String(input)).searchParams;
  if (p.get("action") === "parse") return Response.json({ parse: { title: p.get("page")!.replace(/_/g, " "), revid: revision, wikitext: pages[p.get("page")!] } });
  return Response.json({ query: { pages: (p.get("titles") ?? "").split("|").map((t) => (QIDS[t] ? { title: t, pageprops: { wikibase_item: QIDS[t] } } : { title: t, missing: true })) } });
}) as typeof fetch;
const WBO = "List_of_WBO_world_champions";

let main: DatabaseSync, acc: DatabaseSync;
let run: typeof import("../lib/watch/run");
let props: typeof import("../lib/watch/proposals");
const ctx = () => ({ main, championSources: [{ org: "WBO", page: WBO, sex: "male" as const }, { org: "IBF", page: "List_of_IBF_world_champions", sex: "male" as const }], fetch: { fetchImpl: impl, sleep: async () => {} }, log: () => {} });
const snapshot = () => JSON.stringify(main.prepare("SELECT * FROM title_reigns ORDER BY id").all());

before(async () => {
  main = await (await import("../lib/db")).getDb();
  acc = (await import("../lib/accounts/store")).accountsDb();
  run = await import("../lib/watch/run");
  props = await import("../lib/watch/proposals");
  const { importChampions } = await import("../lib/importers/wikipedia-champions");
  await importChampions(main, { sources: [{ org: "WBO", page: WBO, sex: "male" }, { org: "IBF", page: "List_of_IBF_world_champions", sex: "male" }], fetchImpl: impl, sleep: async () => {} });
});
const reset = () => { pages = { ...ORIGINAL }; acc.exec("DELETE FROM proposals"); };

test("a page that has not changed proposes nothing, and a dry run stores nothing", async () => {
  reset();
  const before = snapshot();
  const r = await run.runWatch("champions", ctx(), acc);
  assert.deepEqual([r.changes, r.refused.length, r.proposals], [0, 0, { added: 0, updated: 0, unchanged: 0, remembered: 0, superseded: 0 }]);
  assert.ok(r.compared > 50);
  assert.equal(snapshot(), before, "the watcher never writes to the reigns we hold");
});

test("a corrected end date is one change, with the old and the new value and where it was read", async () => {
  reset();
  pages[WBO] = ORIGINAL[WBO].replace("|11 Jan – 28 Dec 1991", "|11 Jan – 29 Dec 1991");
  revision = 101;
  const before = snapshot();
  const r = await run.runWatch("champions", ctx(), acc);
  assert.equal(r.changes, 1);
  assert.equal(r.proposals!.added, 1);
  const [p] = props.listProposals(acc);
  assert.equal(p.kind, "reign_changed");
  assert.deepEqual([p.old, p.new], [{ end: "1991-12-28" }, { end: "1991-12-29" }]);
  assert.match(p.label, /Ray Mercer/);
  assert.equal((p.evidence as { revision: string }).revision, "101");
  assert.equal(snapshot(), before);
  const dry = await run.runWatch("champions", ctx(), acc, { dryRun: true });
  assert.equal(dry.changes, 1); assert.equal(dry.proposals, null);
  assert.equal(props.listProposals(acc).length, 1, "a dry run stores nothing");
});

test("a row inserted in the middle of a page is one added reign, not a shift of every later row", async () => {
  reset();
  pages[WBO] = ORIGINAL[WBO].replace("|-align=center\n!3\n|align=left | [[Michael Moorer]]", "|-align=center\n!3\n|align=left | [[Newly Crowned]]\n|1 Mar 1992 – 14 May 1992\n|0\n|-align=center\n!4\n|align=left | [[Michael Moorer]]");
  const r = await run.runWatch("champions", ctx(), acc);
  assert.equal(r.changes, 1);
  assert.equal(props.listProposals(acc)[0].kind, "reign_added");
  assert.match(props.listProposals(acc)[0].label, /Newly Crowned/);
});

test("a reign that disappears from the page is one removed reign", async () => {
  reset();
  pages[WBO] = ORIGINAL[WBO].replace(/\|-align=center\n!5\n\|align=left \| \[\[Michael Bentt\]\]\n[^\n]*\n[^\n]*\n/, "");
  const r = await run.runWatch("champions", ctx(), acc);
  assert.equal(r.changes, 1);
  assert.equal(props.listProposals(acc)[0].kind, "reign_removed");
  assert.match(props.listProposals(acc)[0].label, /Michael Bentt/);
});

test("a page that changes shape proposes nothing, and says why; a blanked page is refused too", async () => {
  reset();
  pages[WBO] = ORIGINAL[WBO].replace(/\n\|0\n/g, "\n|9\n");
  const r = await run.runWatch("champions", ctx(), acc);
  assert.equal(r.refused.length, 1);
  assert.match(r.refused[0].reason, /changed shape or was vandalised/);
  assert.equal(props.listProposals(acc).length, 0);
  assert.ok(r.compared > 0, "the other list is still compared");
  pages[WBO] = "This page has been blanked.";
  const blank = await run.runWatch("champions", ctx(), acc);
  assert.match(blank.refused[0].reason, /read as empty/);
  assert.equal(props.listProposals(acc).length, 0, "an empty read must never turn into 'everything was removed'");
});

test("nothing held yet is not a flood of additions: there is nothing to approve over", async () => {
  reset();
  main.exec("ALTER TABLE title_reigns RENAME TO title_reigns_held");
  main.exec("CREATE TABLE title_reigns AS SELECT * FROM title_reigns_held WHERE 0");
  try {
    const r = await run.runWatch("champions", ctx(), acc);
    assert.equal(r.refused.length, 2); assert.match(r.refused[0].reason, /nothing held yet/);
    assert.equal(props.listProposals(acc).length, 0);
  } finally { main.exec("DROP TABLE title_reigns; ALTER TABLE title_reigns_held RENAME TO title_reigns"); }
});

test("running again does not duplicate; a rejected change is not raised again until the page says something different; a change that goes away is superseded", async () => {
  reset();
  pages[WBO] = ORIGINAL[WBO].replace("|11 Jan – 28 Dec 1991", "|11 Jan – 29 Dec 1991");
  await run.runWatch("champions", ctx(), acc);
  const again = await run.runWatch("champions", ctx(), acc);
  assert.deepEqual([again.proposals!.added, again.proposals!.unchanged], [0, 1]);
  const id = props.listProposals(acc)[0].id;

  acc.prepare("UPDATE proposals SET status = 'rejected' WHERE id = ?").run(id);
  const after = await run.runWatch("champions", ctx(), acc);
  assert.deepEqual([after.proposals!.added, after.proposals!.remembered], [0, 1], "the same change, rejected before");

  pages[WBO] = ORIGINAL[WBO].replace("|11 Jan – 28 Dec 1991", "|11 Jan – 30 Dec 1991");
  const different = await run.runWatch("champions", ctx(), acc);
  assert.equal(different.proposals!.added, 1, "the page now says something else, so it is raised again");
  assert.equal(props.listProposals(acc).length, 1);

  pages[WBO] = ORIGINAL[WBO];
  const back = await run.runWatch("champions", ctx(), acc);
  assert.equal(back.proposals!.superseded, 1);
  assert.equal(props.listProposals(acc).length, 0, "the page went back, so nothing is left to approve");
});

test("an unknown source is refused by name, and a source that is switched off does not run", async () => {
  await assert.rejects(() => run.runWatch("boxrec", ctx(), acc), /No such source/);
  const src = run.SOURCES[0];
  src.enabled = false;
  try { await assert.rejects(() => run.runWatch("champions", ctx(), acc), /switched off/); } finally { src.enabled = true; }
});
