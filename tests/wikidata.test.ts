import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";

const cleanup = tempDb("wikidata");
after(cleanup);
const lit = (value: string) => ({ value });
let wd: typeof import("../lib/importers/wikidata");
let db: DatabaseSync;
before(async () => { wd = await import("../lib/importers/wikidata"); db = await (await import("../lib/db")).getDb(); });

// Fixtures copied from a live Wikidata Query Service response (2026-10-03)
const LIVE = [
  { b: lit("http://www.wikidata.org/entity/Q335701"), bLabel: lit("Francisco Rodríguez"), dob: lit("1945-09-20T00:00:00Z"), dobPrec: lit("11"), pobLabel: lit("Cumaná"), ctzLabel: lit("Venezuela"), h: lit("1.74"), m: lit("60"), img: lit("http://commons.wikimedia.org/wiki/Special:FilePath/Francisco%20%C2%ABMorochito%C2%BB%20Rodr%C3%ADguez.jpg"), dod: lit("2024-04-23T00:00:00Z") },
  { b: lit("http://www.wikidata.org/entity/Q335798"), bLabel: lit("Sugar Ray Leonard"), dob: lit("1956-05-17T00:00:00Z"), dobPrec: lit("11"), pobLabel: lit("Wilmington"), ctzLabel: lit("United States"), h: lit("1.7907"), img: lit("http://commons.wikimedia.org/wiki/Special:FilePath/Sugar%20Ray%20Leonard.jpg"), boxrec: lit("269") },
  { b: lit("http://www.wikidata.org/entity/Q335855"), bLabel: lit("Jake LaMotta"), dob: lit("1922-07-10T00:00:00Z"), dobPrec: lit("11"), pobLabel: lit("The Bronx"), ctzLabel: lit("United States"), h: lit("1.73"), img: lit("http://commons.wikimedia.org/wiki/Special:FilePath/Jake%20LaMotta%20signed%20photo%20postcard%201952.JPG"), dod: lit("2017-09-19T00:00:00Z"), boxrec: lit("9030") },
];

test("live response shapes parse into clean records", () => {
  const p = wd.parseBindings(LIVE);
  const leonard = p.get("Q335798")!, rodriguez = p.get("Q335701")!, lamotta = p.get("Q335855")!;
  assert.equal(leonard.heightCm, 179, "1.7907 m is 179 cm (the raw value was 70.5 inches)");
  assert.equal(rodriguez.heightCm, 174); assert.equal(rodriguez.weightKg, 60);
  assert.equal(leonard.birthDate, "1956-05-17"); assert.equal(leonard.birthYear, 1956);
  assert.equal(lamotta.imageFile, "Jake LaMotta signed photo postcard 1952.JPG");
  assert.equal(leonard.boxrecId, "269"); assert.equal(rodriguez.boxrecId, null);
  assert.equal(lamotta.deathDate, "2017-09-19");
});

test("edge cases: precision, conflicts, units, unresolved labels", () => {
  const e = wd.parseBindings([
    { b: lit("http://www.wikidata.org/entity/Q1"), bLabel: lit("Multi Value"), dob: lit("1980-01-01T00:00:00Z"), dobPrec: lit("9"), pobLabel: lit("Q999"), h: lit("1.80"), m: lit("70") },
    { b: lit("http://www.wikidata.org/entity/Q1"), h: lit("1.82") }, { b: lit("http://www.wikidata.org/entity/Q1"), h: lit("1.78") },
    { b: lit("http://www.wikidata.org/entity/Q2"), bLabel: lit("Conflicting"), dob: lit("1990-03-04T00:00:00Z"), dobPrec: lit("11") },
    { b: lit("http://www.wikidata.org/entity/Q2"), dob: lit("1990-03-05T00:00:00Z"), dobPrec: lit("11") },
    { b: lit("http://www.wikidata.org/entity/Q3"), bLabel: lit("Silly"), h: lit("17.4"), m: lit("5") },
    { b: lit("http://www.wikidata.org/entity/Q3"), teacherLabel: lit("A Trainer") }, { b: lit("http://www.wikidata.org/entity/Q3"), teacherLabel: lit("A Trainer") },
  ]);
  const q1 = e.get("Q1")!, q2 = e.get("Q2")!, q3 = e.get("Q3")!;
  assert.ok(q1.birthYear === 1980 && q1.birthDate === null, "a year-precision date gives a year, not an invented day");
  assert.equal(q1.birthPlace, null, "an unresolved label (bare Q-id) is ignored");
  assert.equal(q1.heightCm, 180, "several heights: the median");
  assert.ok(q2.birthDate === null && q2.birthYear === 1990, "two different exact dates: refuse to pick");
  assert.ok(q3.heightCm === null && q3.weightKg === null, "implausible values are dropped");
  assert.equal(q3.teachers.length, 1);
});

test("the query reads unit-normalised quantities and batches by id", () => {
  const q = wd.batchQuery(["Q1", "Q2"]);
  assert.match(q, /psn:P2048/); assert.match(q, /psn:P2067/); assert.match(q, /VALUES \?b \{ wd:Q1 wd:Q2 \}/);
});

test("enrichment links by BoxRec ID or by unique name + birth year, and only fills blanks", () => {
  const mine = db.prepare("SELECT id, name, birth_year, birth_date, birth_place FROM boxers ORDER BY id LIMIT 6").all() as { id: number; name: string; birth_year: number; birth_date: string | null; birth_place: string | null }[];
  db.exec(`UPDATE boxers SET boxrec_id = '777' WHERE id = ${mine[0].id}`);
  const ins = db.prepare("INSERT INTO wikidata_boxers (qid, name, birth_date, birth_year, birth_place, country, boxrec_id, residence) VALUES (?,?,?,?,?,?,?,?)");
  ins.run("QA", "Totally Different Name", "1970-02-02", mine[0].birth_year, "Wikidata City", "X", "777", "Wikidata Residence");
  ins.run("QB", mine[1].name.toUpperCase() + "!", "1971-03-03", mine[1].birth_year, "Elsewhere", "X", null, null);
  ins.run("QC", mine[2].name, null, mine[2].birth_year, "P1", "X", null, null); ins.run("QD", mine[2].name, null, mine[2].birth_year, "P2", "X", null, null);
  ins.run("QE", mine[3].name, "1960-01-01", mine[3].birth_year + 9, "Wrong", "X", null, null);
  const s = wd.enrichFromWikidata(db);
  const got = (id: number) => db.prepare("SELECT wikidata_id q, birth_date d, birth_place bp FROM boxers WHERE id = ?").get(id) as { q: string | null; d: string | null; bp: string | null };
  assert.equal(got(mine[0].id).q, "QA"); assert.equal(s.byBoxrecId, 1);
  assert.equal(got(mine[0].id).d, mine[0].birth_date, "our own birth date is never overwritten");
  assert.equal(got(mine[0].id).bp, mine[0].birth_place, "our own birthplace is never overwritten");
  assert.equal(got(mine[1].id).q, "QB"); assert.equal(s.byNameYear, 1);
  assert.equal(got(mine[2].id).q, null, "two candidates: ambiguous, left unlinked"); assert.ok(s.ambiguous >= 1);
  assert.equal(got(mine[3].id).q, null, "same name but a different birth year: not him");
  db.exec(`UPDATE boxers SET birth_place = NULL, wikidata_id = NULL WHERE id = ${mine[1].id}`);
  wd.enrichFromWikidata(db);
  assert.equal(got(mine[1].id).bp, "Elsewhere", "a blank field is filled");
});
