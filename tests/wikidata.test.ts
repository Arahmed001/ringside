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

test("a fighter whose birth year is unknown can still be linked by BoxRec ID, and the match fills it; one whose year is known is never overwritten", () => {
  const rows = db.prepare("SELECT id, birth_year FROM boxers ORDER BY id LIMIT 3 OFFSET 20").all() as { id: number; birth_year: number }[];
  db.exec(`UPDATE boxers SET boxrec_id = '881', birth_year = NULL, birth_date = NULL, wikidata_id = NULL WHERE id = ${rows[0].id}`);
  db.exec(`UPDATE boxers SET boxrec_id = '882', wikidata_id = NULL WHERE id = ${rows[1].id}`);
  const ins = db.prepare("INSERT INTO wikidata_boxers (qid, name, birth_date, birth_year, birth_place, country, boxrec_id, residence) VALUES (?,?,?,?,?,?,?,?)");
  ins.run("QU1", "Anyone", "1983-06-06", 1983, "Somewhere", "X", "881", null);
  ins.run("QU2", "Anyone Else", "1950-01-01", rows[1].birth_year, "Elsewhere", "X", "882", null);
  const s = wd.enrichFromWikidata(db);
  const got = (id: number) => db.prepare("SELECT wikidata_id q, birth_year y FROM boxers WHERE id = ?").get(id) as { q: string | null; y: number | null };
  assert.deepEqual({ ...got(rows[0].id) }, { q: "QU1", y: 1983 }, "linked despite having no birth year to compare, and the year is filled from the match");
  assert.ok(s.filled.birthYear >= 1);
  assert.deepEqual({ ...got(rows[1].id) }, { q: "QU2", y: rows[1].birth_year }, "a known birth year is left as it was");
});

test("the extras query also asks for the Arabic label, the nickname and the English article title", () => {
  const q = wd.extrasQuery(["Q1", "Q2"]);
  assert.match(q, /LANG\(\?ar\) = "ar"/); assert.match(q, /wdt:P1449/); assert.match(q, /schema:isPartOf <https:\/\/en\.wikipedia\.org\/>/);
  assert.match(q, /VALUES \?b \{ wd:Q1 wd:Q2 \}/);
});

test("an Arabic name is shown only if it is Arabic script and nothing else; a nickname only if there is exactly one that a person could set; an article title only if it is safe in a link", () => {
  assert.equal(wd.cleanArabicName("محمد علي كلاي"), "محمد علي كلاي");
  assert.equal(wd.cleanArabicName("  أونيل   بيل "), "أونيل بيل", "spacing is tidied");
  assert.equal(wd.cleanArabicName("\u200fهنري ماسكه\u200e"), "هنري ماسكه", "direction marks are stripped");
  assert.equal(wd.cleanArabicName("علي\nكلاي"), "علي كلاي", "a line break is tidied to a space: the result is always one clean line");
  for (const bad of ["Muhammad Ali", "محمد Ali", "علي 2", "علي <b>", "", "   ", "ا".repeat(81), "- علي", "٣٠", undefined, null]) assert.equal(wd.cleanArabicName(bad as string | null | undefined), null, String(bad));
  assert.equal(wd.cleanNickname("The Greatest"), "The Greatest"); assert.equal(wd.cleanNickname("Sugar Ray"), "Sugar Ray");
  for (const bad of ["", "<script>", "x".repeat(41), "-dash first", "a\u0000b"]) assert.equal(wd.cleanNickname(bad), null, bad);
  assert.equal(wd.cleanWikiTitle("Muhammad Ali"), "Muhammad Ali");
  for (const bad of ["a|b", "[[x]]", "x{y}", "a<b", "a\nb", "", "x", "a#b", "a?b", "x".repeat(201)]) assert.equal(wd.cleanWikiTitle(bad), null, bad);
});

test("extras are read per boxer: the one Arabic label, the single nickname, the article title; several different nicknames, or an unsafe value, give none", () => {
  const e = (b: string, extra: Record<string, { value: string }>) => ({ b: { value: `http://www.wikidata.org/entity/${b}` }, ...extra });
  const m = wd.parseExtras([
    e("Q1", { ar: lit("جو لويس"), nick: lit("The Brown Bomber"), enwiki: lit("Joe Louis") }),
    e("Q1", { ar: lit("جو لويس"), nick: lit("The Brown Bomber"), award: lit("http://www.wikidata.org/entity/Q9"), awardLabel: lit("Fighter of the Year") }),
    e("Q2", { nick: lit("Iron") }), e("Q2", { nick: lit("Mike") }),
    e("Q3", { ar: lit("Latin Name"), enwiki: lit("bad|title"), nick: lit("<b>") }),
  ]);
  const q1 = m.get("Q1")!, q2 = m.get("Q2")!, q3 = m.get("Q3")!;
  assert.deepEqual([q1.arabicName, q1.nickname, q1.enwiki], ["جو لويس", "The Brown Bomber", "Joe Louis"], "the same value on several rows is one value");
  assert.equal(q1.awards.length, 1);
  assert.equal(q2.nickname, null, "two different nicknames: no telling which he goes by");
  assert.deepEqual([q3.arabicName, q3.nickname, q3.enwiki], [null, null, null]);
});

test("applying the labels fills blanks only: an Arabic name is added as unreviewed Wikidata unless one exists; a nickname and an article title only where there is none; nothing changes on a second run", () => {
  const rows = db.prepare("SELECT id, name, nickname FROM boxers ORDER BY id LIMIT 4 OFFSET 40").all() as { id: number; name: string; nickname: string | null }[];
  db.prepare("UPDATE boxers SET nickname = NULL, wikipedia_title = NULL WHERE id IN (?,?,?)").run(rows[0].id, rows[1].id, rows[2].id);
  db.prepare("UPDATE boxers SET nickname = 'Own Nick', wikipedia_title = 'Own title' WHERE id = ?").run(rows[3].id);
  db.prepare("DELETE FROM name_translations WHERE en IN (?,?,?,?)").run(...rows.map((r) => r.name));
  db.prepare("INSERT INTO name_translations (en, locale, text, source, reviewed) VALUES (?, 'ar', 'ترجمة شخص', 'editor', 1)").run(rows[1].name);
  const ins = db.prepare("INSERT INTO wikidata_boxers (qid, name, birth_year, ar_label, nickname, enwiki, matched_boxer_id) VALUES (?,?,?,?,?,?,?)");
  ins.run("QL0", "x", 1970, "اسم عربي", "The Nick", "Article Zero", rows[0].id);
  ins.run("QL1", "x", 1970, "اسم آخر", "Other Nick", "Article One", rows[1].id);
  ins.run("QL2", "x", 1970, "Latin only", "<b>", "bad|title", rows[2].id);
  ins.run("QL3", "x", 1970, "اسم رابع", "Wikidata Nick", "Article Three", rows[3].id);
  const s = wd.enrichFromWikidata(db);
  const tr = (n: string) => db.prepare("SELECT text, source, reviewed FROM name_translations WHERE en = ? AND locale = 'ar'").get(n) as { text: string; source: string; reviewed: number } | undefined;
  const b = (id: number) => db.prepare("SELECT nickname n, wikipedia_title w FROM boxers WHERE id = ?").get(id) as { n: string | null; w: string | null };
  assert.deepEqual({ ...tr(rows[0].name)! }, { text: "اسم عربي", source: "wikidata", reviewed: 0 }, "added, and not marked reviewed by a person");
  assert.deepEqual({ ...tr(rows[1].name)! }, { text: "ترجمة شخص", source: "editor", reviewed: 1 }, "a person's translation is never replaced");
  assert.equal(tr(rows[2].name), undefined, "a label with Latin letters is not stored");
  assert.deepEqual({ ...b(rows[0].id) }, { n: "The Nick", w: "Article Zero" }); assert.deepEqual({ ...b(rows[1].id) }, { n: "Other Nick", w: "Article One" });
  assert.deepEqual({ ...b(rows[2].id) }, { n: null, w: null }, "unsafe values are dropped");
  assert.deepEqual({ ...b(rows[3].id) }, { n: "Own Nick", w: "Own title" }, "a nickname and a title already there are kept");
  assert.ok(s.names.added >= 2 && s.names.kept >= 1 && s.filled.nickname >= 2 && s.filled.wikipedia >= 2);
  const again = wd.enrichFromWikidata(db);
  assert.deepEqual([again.names.added, again.filled.nickname, again.filled.wikipedia], [0, 0, 0], "a second run adds nothing");
});

test("a link to an article is built from its title: spaces become underscores, other characters are encoded", async () => {
  const { wikipediaUrl } = await import("../lib/facts");
  assert.equal(wikipediaUrl("Muhammad Ali"), "https://en.wikipedia.org/wiki/Muhammad_Ali");
  assert.equal(wikipediaUrl("Sugar Ray Leonard (boxer)"), "https://en.wikipedia.org/wiki/Sugar_Ray_Leonard_(boxer)");
  assert.match(wikipediaUrl('Weird "title" & more'), /^https:\/\/en\.wikipedia\.org\/wiki\/Weird_%22title%22_%26_more$/);
  assert.doesNotMatch(wikipediaUrl("a b/c"), / /);
});

const ex = (b: string, extra: Record<string, { value: string }>) => ({ b: lit(`http://www.wikidata.org/entity/${b}`), ...extra });

test("extras query asks for the Hall of Fame, Olympedia and award properties", () => {
  const q = wd.extrasQuery(["Q1", "Q2"]);
  assert.match(q, /VALUES \?b \{ wd:Q1 wd:Q2 \}/);
  assert.match(q, /wdt:P4474/); assert.match(q, /wdt:P8286/); assert.match(q, /pq:P585/);
});

test("extras parse: IDs validated, awards deduplicated, ordered by year, kinds told apart", () => {
  const e = wd.parseExtras([
    ex("Q10", { hof: lit("modern/leonardray"), oly: lit("12345"), award: lit("http://www.wikidata.org/entity/Q572227"), awardLabel: lit("International Boxing Hall of Fame"), awardYear: lit("1997-01-01T00:00:00Z") }),
    ex("Q10", { award: lit("http://www.wikidata.org/entity/Q572227"), awardLabel: lit("International Boxing Hall of Fame"), awardYear: lit("1997-01-01T00:00:00Z") }),
    ex("Q10", { award: lit("http://www.wikidata.org/entity/Q137999389"), awardLabel: lit("WBC World Light Heavyweight Champion") }),
    ex("Q10", { award: lit("http://www.wikidata.org/entity/Q7634895"), awardLabel: lit("BWAA Fighter of the Year"), awardYear: lit("1981-01-01T00:00:00Z") }),
    ex("Q10", { award: lit("http://www.wikidata.org/entity/Q999"), awardLabel: lit("Q999") }),
    ex("Q11", { hof: lit("../etc/passwd"), oly: lit("abc") }),
  ]);
  const a = e.get("Q10")!;
  assert.equal(a.ibhofId, "modern/leonardray"); assert.equal(a.olympediaId, "12345");
  assert.deepEqual(a.awards.map((x) => [x.label, x.year, x.kind]), [
    ["BWAA Fighter of the Year", 1981, "award"], ["International Boxing Hall of Fame", 1997, "hall_of_fame"], ["WBC World Light Heavyweight Champion", null, "title"],
  ], "one row per award and year; an unresolved label (bare Q-id) is dropped; undated awards sort last");
  const b = e.get("Q11")!;
  assert.equal(b.ibhofId, null, "a path-traversal-looking ID is rejected"); assert.equal(b.olympediaId, null, "a non-numeric Olympedia ID is rejected");
});

test("enrichment copies IDs and honours to linked fighters, replaces Wikidata's own rows, never touches other sources", () => {
  const [f] = db.prepare("SELECT id, name, birth_year FROM boxers ORDER BY id DESC LIMIT 1").all() as { id: number; name: string; birth_year: number }[];
  db.prepare("INSERT INTO wikidata_boxers (qid, name, birth_year, ibhof_id, olympedia_id, awards) VALUES (?,?,?,?,?,?)").run(
    "QH", f.name, f.birth_year, "classic/test", "999", JSON.stringify([{ qid: "Q1", label: "International Boxing Hall of Fame", year: 2005, kind: "hall_of_fame" }, { qid: "Q2", label: "Fighter of the Year", year: 2001, kind: "award" }]));
  db.prepare("INSERT INTO honours (boxer_id, kind, label, year, source) VALUES (?,?,?,?,?)").run(f.id, "award", "Editor's pick", 2020, "editor");
  const s = wd.enrichFromWikidata(db);
  const boxer = db.prepare("SELECT ibhof_id h, olympedia_id o FROM boxers WHERE id = ?").get(f.id) as { h: string | null; o: string | null };
  assert.equal(boxer.h, "classic/test"); assert.equal(boxer.o, "999");
  assert.ok(s.honours.hallOfFame >= 1 && s.honours.olympedia >= 1 && s.honours.rows >= 2);
  const rows = () => db.prepare("SELECT kind, label, year, source FROM honours WHERE boxer_id = ? ORDER BY source, year").all(f.id) as { kind: string; label: string; year: number; source: string }[];
  assert.deepEqual(rows().map((r) => `${r.source}:${r.label}:${r.year}`), ["editor:Editor's pick:2020", "wikidata:Fighter of the Year:2001", "wikidata:International Boxing Hall of Fame:2005"]);
  // Wikidata drops one award upstream: it disappears here, the editor's row stays, and a second run adds no duplicates
  db.prepare("UPDATE wikidata_boxers SET awards = ? WHERE qid = 'QH'").run(JSON.stringify([{ qid: "Q1", label: "International Boxing Hall of Fame", year: 2005, kind: "hall_of_fame" }]));
  wd.enrichFromWikidata(db); wd.enrichFromWikidata(db);
  assert.deepEqual(rows().map((r) => `${r.source}:${r.label}`), ["editor:Editor's pick", "wikidata:International Boxing Hall of Fame"]);
  // a feed-supplied ID is never overwritten
  db.prepare("UPDATE boxers SET ibhof_id = 'feed/own' WHERE id = ?").run(f.id);
  wd.enrichFromWikidata(db);
  assert.equal((db.prepare("SELECT ibhof_id h FROM boxers WHERE id = ?").get(f.id) as { h: string }).h, "feed/own");
});

test("the world carries a fighter's article title, so the profile can link to it; a fighter without one has none", async () => {
  const [a, b] = db.prepare("SELECT id FROM boxers ORDER BY id LIMIT 2 OFFSET 80").all() as { id: number }[];
  db.prepare("UPDATE boxers SET wikipedia_title = 'Some Article' WHERE id = ?").run(a.id);
  db.prepare("UPDATE boxers SET wikipedia_title = NULL WHERE id = ?").run(b.id);
  const w = await (await import("../lib/world")).getWorld();
  assert.equal(w.byId.get(a.id)!.wikipediaTitle, "Some Article");
  assert.equal(w.byId.get(b.id)!.wikipediaTitle, null);
});
