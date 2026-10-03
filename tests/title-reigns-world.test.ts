import test, { after } from "node:test";
import assert from "node:assert/strict";
import { miniFeed, providerOf, tempDb } from "./helpers";
import { fmtPartialDate } from "../lib/format";

process.env.RINGSIDE_NO_SEED = "1";
const cleanup = tempDb("title-reigns-world");
after(cleanup);

test("a linked reign reaches the world, an unlinked one does not, and partial dates are shown at the precision they were stated", async () => {
  const db = await (await import("../lib/db")).getDb();
  const { ingest } = await import("../lib/ingest");
  await ingest(db, providerOf(miniFeed()));
  const a = (db.prepare("SELECT id FROM boxers WHERE external_id = 'A'").get() as { id: number }).id;
  const ins = db.prepare(`INSERT INTO title_reigns (org, division, category, seq, n, name, status, wikidata_id, boxer_id, start_date, end_date, current, defences, source, revision)
    VALUES ('WBO', 'Lightweight', '', ?, ?, 'Fighter A', ?, 'Q1', ?, ?, ?, ?, ?, 'List_of_WBO_world_champions', '1')`);
  ins.run(1, 1, null, a, "1997-08-23", "1997-08", 0, 0);
  ins.run(2, 2, "Super champion", a, "2001", null, 1, 3);
  ins.run(3, 3, null, null, "1999-01-01", "2000-01-01", 0, 1); // a name we could not link
  const w = await (await import("../lib/world")).getWorld();
  const r = w.reignsByBoxer.get(a)!;
  assert.deepEqual(r.map((x) => [x.org, x.division, x.status, x.start, x.end, x.current, x.defences]), [["WBO", "Lightweight", null, "1997-08-23", "1997-08", false, 0], ["WBO", "Lightweight", "Super champion", "2001", null, true, 3]]);
  assert.equal([...w.reignsByBoxer.values()].flat().length, 2, "the unlinked reign is in no one's history");
  assert.equal(fmtPartialDate("1997-08-23"), "Aug 23, 1997"); assert.equal(fmtPartialDate("1997-08"), "Aug 1997"); assert.equal(fmtPartialDate("2001"), "2001");
});
