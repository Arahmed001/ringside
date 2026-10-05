import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { makeBoxer, miniFeed, providerOf, tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";

/**
 * The real league is loaded in two goes: a partial load now, the complete one when the vendor cache is full, both into the
 * same database. The Wikidata staging table and what the enrichment wrote on our fighters must come through the second load
 * untouched: the ids that the staging rows link to must not change, and no staged row may disappear.
 */
process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("reload-staging", "2026-10-03");
after(cleanup);

let db: DatabaseSync;
let ids: Record<string, number>;
const idsOf = () => Object.fromEntries((db.prepare("SELECT external_id e, id FROM boxers").all() as { e: string; id: number }[]).map((r) => [r.e, r.id]));
const wd = () => db.prepare("SELECT qid, matched_boxer_id m, match_method, ar_label FROM wikidata_boxers ORDER BY qid").all() as { qid: string; m: number | null; match_method: string | null; ar_label: string | null }[];

before(async () => {
  const { getDb } = await import("../lib/db");
  const { ingest } = await import("../lib/ingest");
  db = await getDb();
  const first = miniFeed(); // fighters A and B
  await ingest(db, providerOf(first, "vendor"));
  ids = idsOf();
  const ins = db.prepare("INSERT INTO wikidata_boxers (qid, name, birth_year, matched_boxer_id, match_method, ar_label, fetched_at) VALUES (?,?,?,?,?,?,?)");
  ins.run("Q1", "Fighter A", 1994, ids.A, "boxrec", "المقاتل أ", "2026-10-05");
  ins.run("Q2", "Somebody Else", 1980, null, null, null, "2026-10-05");
  ins.run("Q3", "Another One", 1975, null, null, null, "2026-10-05");
  db.prepare("UPDATE boxers SET nickname = ?, birth_place = ? WHERE id = ?").run("The Test", "Monterrey, Mexico", ids.A);
  // the complete load: the same two fighters, more fighters and fights, A's division now read differently
  const second = miniFeed();
  second.boxers = [makeBoxer("A", "Welterweight"), makeBoxer("B"), makeBoxer("C"), makeBoxer("D")];
  second.bouts.push({ externalId: "E1-2", eventExternalId: "E1", redExternalId: "C", blueExternalId: "D", weightClass: "Lightweight", rounds: 10, winnerExternalId: "C", method: "UD", endRound: 10, title: null, position: 1 });
  await ingest(db, providerOf(second, "vendor"));
});

test("a second, fuller load keeps every staged Wikidata row and the link to our fighter", () => {
  assert.deepEqual(wd().map((r) => r.qid), ["Q1", "Q2", "Q3"], "no staged row lost");
  const q1 = wd().find((r) => r.qid === "Q1")!;
  assert.equal(q1.m, ids.A);
  assert.equal(q1.match_method, "boxrec");
  assert.equal(q1.ar_label, "المقاتل أ");
});

test("our fighters keep their ids, so the links stay valid, and what the enrichment wrote on them stays", () => {
  const after = idsOf();
  assert.equal(after.A, ids.A);
  assert.equal(after.B, ids.B);
  assert.ok(after.C && after.D, "new fighters are added");
  const a = db.prepare("SELECT nickname, birth_place FROM boxers WHERE id = ?").get(ids.A) as { nickname: string; birth_place: string };
  assert.deepEqual({ ...a }, { nickname: "The Test", birth_place: "Monterrey, Mexico" });
  assert.equal((db.prepare("SELECT COUNT(*) c FROM bouts").get() as { c: number }).c, 2, "the new fight is added, the old one not duplicated");
});
