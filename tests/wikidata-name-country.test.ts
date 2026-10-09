import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import type { DatabaseSync } from "node:sqlite";

const cleanup = tempDb("wikidata-name-country");
after(cleanup);
let wd: typeof import("../lib/importers/wikidata");
let db: DatabaseSync;
before(async () => { wd = await import("../lib/importers/wikidata"); db = await (await import("../lib/db")).getDb(); });

/**
 * A real league has almost no BoxRec numbers and a birth year for about half its fighters, so the first two ways of linking a fighter to Wikidata place a few
 * hundred of tens of thousands. The third: a name that belongs to exactly one unlinked fighter of ours and one staged entity, in the same country, with a life
 * that fits the career. Each fighter below is one of the cases that must (or must not) link. (round 133)
 */
test("a unique name in the same country links when the life fits the career, and in no other case", () => {
  const first = db.prepare("SELECT MIN(CAST(substr(e.date, 1, 4) AS INTEGER)) y FROM events e").get() as { y: number };
  const insB = db.prepare("INSERT INTO boxers (external_id, slug, name, country, birth_year, stance, weight_class, active, rating) VALUES (?,?,?,?,?,?,?,?,?)");
  let seq = 0;
  const mk = (n: string, country: string, by: number | null) => Number(insB.run(`nc-${++seq}`, `nc-${seq}-${n.toLowerCase().replace(/\W+/g, "-")}`, n, country, by, "Orthodox", "Lightweight", 1, 1500).lastInsertRowid);
  const ins = db.prepare("INSERT INTO wikidata_boxers (qid, name, birth_year, birth_date, country, death_date) VALUES (?,?,?,?,?,?)");
  const ids = {
    ok: mk("Nils Zorander", "Sweden", null), nation: mk("Gareth Pembrey", "Wales", null), stroke: mk("Michal Zbyszewski", "Poland", null),
    otherCountry: mk("Hadi Ravenswood", "Canada", null), twoOfOurs1: mk("Samir Tolkachev", "Russia", null), twoOfOurs2: mk("Samir Tolkachev", "Russia", null),
    twoOfTheirs: mk("Viktor Hallgren", "Finland", null), yearApart: mk("Emil Brandvold", "Norway", 1990), tooYoung: mk("Oskar Lindqvist", "Sweden", null), noCountry: mk("Pavel Nemecek", "Czechia", null),
  };
  ins.run("Q9001", "Nils Zorander", 1985, "1985-04-05", "Sweden", null);
  ins.run("Q9002", "Gareth Pembrey", null, null, "United Kingdom", null);
  ins.run("Q9003", "Michał Zbyszewski", 1970, null, "Poland", null);
  ins.run("Q9004", "Hadi Ravenswood", null, null, "Lebanon", null);
  ins.run("Q9005", "Samir Tolkachev", null, null, "Russia", null);
  ins.run("Q9006", "Viktor Hallgren", null, null, "Finland", null); ins.run("Q9007", "Viktor Hallgren", null, null, "Finland", null);
  ins.run("Q9008", "Emil Brandvold", 1960, null, "Norway", null);
  ins.run("Q9009", "Oskar Lindqvist", first.y + 5, null, "Sweden", null);
  ins.run("Q9010", "Pavel Nemecek", null, null, null, null);
  const s = wd.enrichFromWikidata(db);
  const q = (id: number) => (db.prepare("SELECT wikidata_id q FROM boxers WHERE id = ?").get(id) as { q: string | null }).q;
  assert.equal(q(ids.ok), "Q9001", "the name, the country, nothing against it"); assert.equal(q(ids.nation), "Q9002", "Wales is the United Kingdom's");
  assert.equal(q(ids.stroke), "Q9003", "Michal / Michał is one name");
  assert.equal(q(ids.otherCountry), null, "the same name in another country is another man");
  assert.equal(q(ids.twoOfOurs1), null); assert.equal(q(ids.twoOfOurs2), null, "two of ours with the name: nothing says which");
  assert.equal(q(ids.twoOfTheirs), null, "two entities with the name");
  assert.equal(q(ids.yearApart), null, "birth years nine years apart");
  assert.equal(q(ids.noCountry), null, "an entity with no country is not matched on a name alone");
  assert.ok(s.byNameCountry >= 3);
  assert.equal((db.prepare("SELECT match_method m FROM wikidata_boxers WHERE qid = 'Q9001'").get() as { m: string }).m, "name+country");
  assert.equal((db.prepare("SELECT birth_year y FROM boxers WHERE id = ?").get(ids.ok) as { y: number }).y, 1985, "an unknown birth year is filled from the match");
});
