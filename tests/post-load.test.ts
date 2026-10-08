import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  badWords, checkFighterHtml, cornerShares, countrySpellings, countsSection, doctorRows, esc, expectedRecord, findDuplicateFighters, findGaps, gatherCounts, gatherSampleStats, gatherSurprises,
  loadedRecords, nextSteps, normaliseName, pageAge, pageForm, pageRecord, redactor, renderReport, seeded, selectSample, shuffled, surprisesSection, terminalSummary, venueSpellings, verdict, visibleText,
  type FighterStat, type Section,
} from "../lib/post-load";
import { CAPACITY_REFERENCE, descendants, parsePs, speedKinds, speedSection, type Server, type SpeedResult } from "../lib/post-load-live";

/**
 * `npm run post-load`: the judging functions are pure and are tested on leagues made by hand; the SQL is tested on a small database made here and opened READ-ONLY, which also shows that
 * no check needs to write. The running of a server and a browser is not tested here (it takes minutes); it was run end to end on a rehearsal league (PLAN).
 */
const ROOT = path.resolve(__dirname, "..");

test("the seeded generator repeats itself, and a shuffle is a permutation", () => {
  const a = seeded(7), b = seeded(7), c = seeded(8);
  const xs = Array.from({ length: 5 }, () => a()), ys = Array.from({ length: 5 }, () => b()), zs = Array.from({ length: 5 }, () => c());
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, zs);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  const s = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], seeded(3));
  assert.deepEqual([...s].sort((p, q) => p - q), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(s, shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], seeded(3)));
});

test("names meet across accents, case, punctuation and word order; people with no birth year are not called duplicates", () => {
  assert.equal(normaliseName("José  Ramírez"), normaliseName("RAMIREZ, jose"));
  const rows = [
    { id: 1, slug: "a", name: "Saúl Álvarez", birthYear: 1990 }, { id: 2, slug: "b", name: "SAUL ALVAREZ", birthYear: 1990 }, { id: 3, slug: "c", name: "Saul Alvarez", birthYear: 1991 },
    { id: 4, slug: "d", name: "John Smith", birthYear: null }, { id: 5, slug: "e", name: "Smith John", birthYear: null }, { id: 6, slug: "f", name: "Ana Díaz", birthYear: 1985 },
  ];
  const d = findDuplicateFighters(rows);
  assert.equal(d.strong.length, 1, "only the pair with the same name and the same birth year");
  assert.deepEqual(d.strong[0].map((r) => r.id).sort(), [1, 2]);
  assert.equal(d.unknownYear, 1, "two with no year are counted apart, as weak evidence");
});

test("a venue spelled two ways in one city is found, the same name in two cities is not", () => {
  const v = venueSpellings([
    { text: "Madison Square Garden", city: "New York", n: 9 }, { text: "MADISON SQUARE GARDEN", city: "New York", n: 2 }, { text: "The O2 Arena", city: "London", n: 3 }, { text: "O2 Arena", city: "London", n: 1 },
    { text: "Arena", city: "Leeds", n: 4 }, { text: "ARENA", city: "Cardiff", n: 4 }, { text: "Caesars Palace", city: "Las Vegas", n: 5 },
  ]);
  assert.equal(v.length, 2);
  assert.deepEqual(v.map((g) => g.city).sort(), ["London", "New York"]);
  assert.deepEqual(v.find((g) => g.city === "New York")!.spellings.map((s) => s.text), ["Madison Square Garden", "MADISON SQUARE GARDEN"], "the commoner spelling first");
});

test("a country spelled two ways is found through the app's own reading of country names", () => {
  const c = countrySpellings([{ text: "United States", n: 100 }, { text: "USA", n: 7 }, { text: "Mexico", n: 50 }, { text: "mexico", n: 1 }, { text: "England", n: 20 }, { text: "Unknown", n: 3 }, { text: "France", n: 5 }]);
  assert.deepEqual(c.map((x) => x.country).sort(), ["Mexico", "United States"]);
  assert.deepEqual(c.find((x) => x.country === "United States")!.spellings.map((s) => s.text), ["United States", "USA"]);
});

test("a year with far fewer rows than its neighbours is a gap; a quiet beginning, a thin league and the current year are not", () => {
  const years = new Map<number, number>();
  for (let y = 1990; y <= 2010; y++) years.set(y, 800);
  years.set(2000, 12); years.set(2005, 0);
  const g = findGaps(years, 2026);
  assert.deepEqual(g.map((x) => x.year), [2000, 2005]);
  assert.equal(g[0].n, 12);
  assert.equal(g[1].n, 0);
  // the span's own edges and a small league are never flagged
  assert.deepEqual(findGaps(new Map([[1990, 5], [1991, 0], [1992, 7], [1993, 6]]), 2026), []);
  const edge = new Map(years); edge.set(1990, 3);
  assert.ok(!findGaps(edge, 2026).some((x) => x.year === 1990), "the first year is the edge of the span");
  const now = new Map(years); now.set(2026, 10);
  assert.ok(!findGaps(now, 2026).some((x) => x.year === 2026));
  assert.deepEqual(findGaps(new Map([[1990, 800]]), 2026), []);
});

test("red's share of decided fights: a normal league is quiet, a year with the corners swapped stands out", () => {
  const normal = Array.from({ length: 10 }, (_, i) => ({ year: 2000 + i, red: 580, decided: 1000 }));
  assert.equal(cornerShares(normal).odd.length, 0);
  const swapped = [...normal.slice(0, 5), { year: 2005, red: 300, decided: 1000 }, ...normal.slice(6)];
  const s = cornerShares(swapped);
  assert.deepEqual(s.odd.map((o) => o.year), [2005]);
  assert.ok(Math.abs(s.overall - 0.556) < 0.01);
  assert.equal(cornerShares([{ year: 2001, red: 9, decided: 100 }]).odd.length, 0, "a small year is never flagged");
});

const stat = (id: number, o: Partial<FighterStat> = {}): FighterStat => ({ id, slug: `f-${id}`, name: `Fighter ${id}`, fights: 5, first: "2010-01-01", last: "2015-01-01", titleWins: 0, champion: false, disputed: false, ...o });

test("the sample takes ten from each group, never a fighter twice, the same ones for the same seed, and always 60 when the league is big enough", () => {
  const stats = Array.from({ length: 400 }, (_, i) => stat(i + 1, { fights: 1 + (i % 40), first: `${1990 + (i % 20)}-01-01`, last: `${2010 + (i % 15)}-01-01`, titleWins: i % 17 === 0 ? 3 : 0, champion: i % 50 === 0, disputed: i % 31 === 0 }));
  const a = selectSample(stats, 24), b = selectSample(stats, 24), c = selectSample(stats, 25);
  assert.equal(a.length, 60);
  assert.deepEqual(a.map((s) => s.id), b.map((s) => s.id));
  assert.notDeepEqual(a.map((s) => s.id), c.map((s) => s.id));
  assert.equal(new Set(a.map((s) => s.id)).size, 60);
  for (const g of ["active", "champion", "disputed", "career", "few", "random"]) assert.equal(a.filter((s) => s.group === g).length, 10, g);
  assert.ok(a.filter((s) => s.group === "active").every((s) => s.fights >= 36), "the most active are the ones with the most fights");
  assert.ok(a.filter((s) => s.group === "disputed").every((s) => s.disputed));
  assert.ok(a.filter((s) => s.group === "few").every((s) => s.fights <= 2));
  assert.ok(a.filter((s) => s.group === "champion").every((s) => s.champion || s.titleWins > 0));
  // official champions come before fighters who merely won title fights
  assert.ok(a.filter((s) => s.group === "champion").slice(0, 8).every((s) => s.champion));
});

test("a league with no champions and no disputed records still gets its sample, the shortfall made up at random", () => {
  const stats = Array.from({ length: 200 }, (_, i) => stat(i + 1, { fights: 1 + (i % 9) }));
  const s = selectSample(stats, 24);
  assert.equal(s.length, 60);
  assert.equal(s.filter((x) => x.group === "champion").length, 0);
  assert.equal(s.filter((x) => x.group === "random").length, 30, "its own 10 and the 20 that two empty groups could not give");
  assert.equal(new Set(s.map((x) => x.id)).size, 60);
  assert.equal(selectSample(stats.slice(0, 7), 24).length, 7, "a tiny league gives what it has");
});

test("the record a page must show follows the page's own rule: the fights, the supplier's total for a partial career, the total for a disputed one", () => {
  assert.deepEqual(expectedRecord({ loaded: { wins: 3, losses: 1, draws: 0, fights: 4 }, vendor: { wins: 3, losses: 1, draws: 0 }, disputed: false }), { text: "3-1-0", source: "loaded" });
  assert.deepEqual(expectedRecord({ loaded: { wins: 1, losses: 0, draws: 0, fights: 1 }, vendor: { wins: 19, losses: 0, draws: 1 }, disputed: false }), { text: "19-0-1", source: "supplier" });
  assert.deepEqual(expectedRecord({ loaded: { wins: 5, losses: 0, draws: 0, fights: 5 }, vendor: { wins: 3, losses: 0, draws: 0 }, disputed: true }), { text: "3-0-0", source: "disputed" });
  assert.deepEqual(expectedRecord({ loaded: { wins: 5, losses: 0, draws: 0, fights: 5 }, vendor: { wins: 3, losses: 0, draws: 0 }, disputed: false }), { text: "5-0-0", source: "loaded" }, "ahead of a total that lags: the loaded record stands");
  assert.deepEqual(expectedRecord({ loaded: undefined, vendor: null, disputed: false }), { text: "0-0-0", source: "loaded" });
});

const PAGE = `<html><head><title>Fighter 1 · Ringside</title><script>self.__next_f.push([1,"undefined null NaN"])</script><style>.x{}</style></head><body><nav>Skip</nav><main><h1>Fighter 1</h1>
  <div>Age 34 · Orthodox</div><div><span>Record</span> <strong>18-4-0</strong> 22 fights</div><div>Last 5 fights <b>W</b> <b>W</b> <b>W</b> <b>L</b> <b>W</b> Last fought 2 years ago</div></main></body></html>`;

test("a page is judged on what a reader sees: markup and script data are not text", () => {
  assert.ok(!visibleText(PAGE).includes("undefined"), "script contents are not visible text");
  assert.deepEqual(badWords(PAGE), []);
  const bad = PAGE.replace("Orthodox", "undefined").replace("2 years ago", "NaN years ago");
  assert.equal(badWords(bad).length, 2);
  assert.equal(badWords("<p>He fought a [object Object] and null</p>").length, 2);
  assert.deepEqual(badWords("<p>Nullify the innocuous nan</p>"), [], "only the whole words");
  assert.equal(esc("<a href=\"x\">&'"), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("record, age and form are read from the page; the 'Last' of 'Last fought' is not a loss", () => {
  assert.equal(pageRecord(PAGE), "18-4-0");
  assert.equal(pageAge(PAGE), 34);
  assert.deepEqual(pageForm(PAGE), ["W", "W", "W", "L", "W"]);
  assert.equal(pageForm("<p>Last 3 fights W D L Last fought 1 year ago</p>")?.length, 3);
  assert.deepEqual(pageForm("<p>Last fight <b>W</b> Last fought 1 year ago</p>"), ["W"], "one fight reads 'Last fight'");
  assert.equal(pageForm("<p>No bouts yet</p>"), null);
  assert.equal(pageRecord("<p>nothing</p>"), null);
});

test("a fighter page that disagrees with the database is reported, each way it can", () => {
  const ok = { record: "18-4-0", fights: 22, hasBirthYear: true };
  assert.deepEqual(checkFighterHtml(PAGE, 200, ok), []);
  assert.match(checkFighterHtml(PAGE, 200, { ...ok, record: "19-4-0" })[0], /record 18-4-0 on the page, 19-4-0 by the database/);
  assert.deepEqual(checkFighterHtml("", 404, ok), ["HTTP 404"]);
  assert.deepEqual(checkFighterHtml("", 0, ok), ["HTTP 0"]);
  assert.match(checkFighterHtml(PAGE.replace("Age 34", "Age 140"), 200, ok).join(), /age 140 is not plausible/);
  assert.match(checkFighterHtml(PAGE.replace("Age 34", "Age"), 200, ok).join(), /no age/);
  assert.match(checkFighterHtml(PAGE.replace(/Last 5 fights[\s\S]*?ago/, ""), 200, ok).join(), /no last-fights strip/);
  assert.deepEqual(checkFighterHtml(PAGE.replace(/Last 5 fights[\s\S]*?ago/, ""), 200, { ...ok, fights: 0 }), [], "a fighter with no fight has no strip");
  assert.match(checkFighterHtml(PAGE.replace("Orthodox", "[object Object]"), 200, ok).join(), /placeholder word/);
  assert.deepEqual(checkFighterHtml(PAGE.replace("18-4-0", "1-1-1"), 200, ok, { arabic: true }), [], "the Arabic page is checked for placeholders only (its record is written in the other direction)");
});

// ---- the SQL, on a small league made here and opened read-only ----
const SCHEMA = `
CREATE TABLE boxers (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, country TEXT, birth_year INTEGER, weight_class TEXT, sex TEXT DEFAULT 'male', photo_url TEXT, wikidata_id TEXT, rating REAL DEFAULT 1500, debut_date TEXT,
  vendor_wins INTEGER, vendor_losses INTEGER, vendor_draws INTEGER, vendor_ko_wins INTEGER, vendor_stopped INTEGER, record_disputed INTEGER);
CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT, date TEXT, venue TEXT, city TEXT, country TEXT, status TEXT);
CREATE TABLE bouts (id INTEGER PRIMARY KEY, event_id INTEGER, red_id INTEGER, blue_id INTEGER, winner_id INTEGER, method TEXT, title TEXT, status TEXT);
CREATE TABLE orgs (id INTEGER PRIMARY KEY, kind TEXT);
CREATE TABLE people (id INTEGER PRIMARY KEY);
CREATE TABLE boxer_media (boxer_id INTEGER PRIMARY KEY, status TEXT);
CREATE TABLE name_translations (en TEXT, locale TEXT, text TEXT, PRIMARY KEY (en, locale));
CREATE TABLE wikidata_boxers (qid TEXT PRIMARY KEY, matched_boxer_id INTEGER, ar_label TEXT);
CREATE TABLE official_rankings (boxer_id INTEGER, kind TEXT, vacant INTEGER);`;
const TODAY = "2026-10-03";

function league(faults: boolean): { file: string; clean: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-postload-test-"));
  const file = path.join(dir, "league.db");
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const nb = (id: number, name: string, extra: Record<string, string | number | null> = {}) => {
    const o: Record<string, string | number | null> = { slug: `f-${id}`, name, country: "Mexico", birth_year: 1990, weight_class: "Lightweight", sex: "male", photo_url: null, wikidata_id: null, vendor_wins: null, vendor_losses: null, vendor_draws: null, vendor_ko_wins: null, vendor_stopped: null, record_disputed: null, ...extra };
    db.prepare("INSERT INTO boxers (id, slug, name, country, birth_year, weight_class, sex, photo_url, wikidata_id, vendor_wins, vendor_losses, vendor_draws, vendor_ko_wins, vendor_stopped, record_disputed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, o.slug, o.name, o.country, o.birth_year, o.weight_class, o.sex, o.photo_url, o.wikidata_id, o.vendor_wins, o.vendor_losses, o.vendor_draws, o.vendor_ko_wins, o.vendor_stopped, o.record_disputed);
  };
  // 1: three wins and a loss, the supplier agrees; 2: the same fights from the other side, plus a draw; 3: a partial career; 4: a disputed one; 5: no fights
  nb(1, "Ana Díaz", { vendor_wins: 3, vendor_losses: 1, vendor_draws: 0, photo_url: "/p.jpg", wikidata_id: "Q1" });
  nb(2, "Bo Chan", { vendor_wins: 1, vendor_losses: 3, vendor_draws: 1 });
  nb(3, "Cy Dunn", { vendor_wins: 10, vendor_losses: 2, vendor_draws: 1 });
  nb(4, "Di Eng", { vendor_wins: 0, vendor_losses: 1, vendor_draws: 0, record_disputed: 1 });
  nb(5, "Ed Fox", { birth_year: null });
  db.prepare("INSERT INTO events (id, name, date, venue, city, country, status) VALUES (?,?,?,?,?,?,?)");
  const ev = db.prepare("INSERT INTO events (id, name, date, venue, city, country) VALUES (?,?,?,?,?,?)");
  const bt = db.prepare("INSERT INTO bouts (event_id, red_id, blue_id, winner_id, method, title, status) VALUES (?,?,?,?,?,?,?)");
  for (let i = 1; i <= 6; i++) ev.run(i, `Card ${i}`, `201${i}-05-01`, "Arena", "Leeds", "United Kingdom");
  bt.run(1, 1, 2, 1, "UD", null, null); bt.run(2, 1, 2, 1, "KO", "WBC World Lightweight", null); bt.run(3, 2, 1, 1, "TKO", null, null); bt.run(4, 1, 2, 2, "SD", null, null);
  bt.run(5, 2, 3, null, "DRAW", null, null); bt.run(6, 3, 4, 3, "UD", null, null); bt.run(6, 3, 4, null, null, null, null);
  if (faults) {
    nb(6, "ANA DIAZ ", { birth_year: 1990 }); nb(8, "Hal Ives", { country: "United States" }); nb(7, "Gus Hill", { country: "USA", vendor_wins: 2, vendor_ko_wins: 9, vendor_losses: 0, vendor_draws: 0, weight_class: "Strange" });
    ev.run(7, "Future card", "2027-03-01", "Arena", "Leeds", "United Kingdom"); ev.run(8, "Old card", "1700-01-01", "ARENA", "Leeds", "UK");
    bt.run(7, 1, 3, 1, "KO", null, null);   // a result for a fight not yet held
    bt.run(7, 6, 7, 3, "UD", null, null);   // a winner who was in neither corner
    bt.run(1, 7, 7, 7, "UD", null, null);   // a fighter against himself
    db.prepare("UPDATE boxers SET birth_year = 2020 WHERE id = 5").run();
  }
  db.close();
  return { file, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("loaded records are counted as the app counts them, and a no-contest is not a fight", () => {
  const { file, clean } = league(false);
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    const l = loadedRecords(db);
    assert.deepEqual(l.get(1), { wins: 3, losses: 1, draws: 0, fights: 4 });
    assert.deepEqual(l.get(2), { wins: 1, losses: 3, draws: 1, fights: 5 });
    assert.equal(l.get(5), undefined);
    db.close();
    const w = new DatabaseSync(file);
    w.prepare("INSERT INTO bouts (event_id, red_id, blue_id, winner_id, method) VALUES (1, 1, 2, NULL, 'NC')").run();
    w.close();
    const r = new DatabaseSync(file, { readOnly: true });
    assert.equal(loadedRecords(r).get(1)!.fights, 4, "NC is not counted");
    r.close();
  } finally { clean(); }
});

test("counts and completeness: full, partial, disputed and the rest are told apart, and nothing needs a write", () => {
  const { file, clean } = league(false);
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    const c = gatherCounts(db, TODAY);
    assert.equal(c.fighters, 5);
    assert.equal(c.bouts, 8 - 1);
    assert.equal(c.decided, 6);
    assert.equal(c.noResult, 1);
    assert.equal(c.events, 6);
    assert.equal(c.photo, 1);
    assert.equal(c.wikidata, 1);
    assert.deepEqual(c.record, { full: 2, partial: 1, disputed: 1, ahead: 0, noTotal: 0, noFights: 1 });
    assert.equal(c.titleBouts, 1);
    const { section } = countsSection(c, TODAY);
    assert.equal(section.number, 2);
    assert.ok(section.rows.some((r) => /5 fighters/.test(r.detail)));
    db.close();
  } finally { clean(); }
});

test("each heuristic finds the fault planted for it, and a clean league finds none", () => {
  const clean = league(false), bad = league(true);
  try {
    const db0 = new DatabaseSync(clean.file, { readOnly: true });
    const none = gatherSurprises(db0, TODAY);
    db0.close();
    for (const s of none) assert.ok(s.level === "pass" || s.level === "info" || s.id === "small-divisions", `${s.id} should be quiet on a clean league: ${s.level} ${s.count}`);
    assert.deepEqual(none.find((s) => s.id === "duplicate-fighters")!.examples, []);

    const db = new DatabaseSync(bad.file, { readOnly: true });
    const hits = new Map(gatherSurprises(db, TODAY).map((s) => [s.id, s]));
    db.close();
    assert.equal(hits.get("duplicate-fighters")!.count, 1);
    assert.match(hits.get("duplicate-fighters")!.examples[0], /Ana D/);
    assert.equal(hits.get("venue-spellings")!.count, 1);
    assert.match(hits.get("venue-spellings")!.examples[0], /Leeds.*"Arena".*"ARENA"/);
    assert.equal(hits.get("country-spellings")!.count, 2, "USA / United States, and UK / United Kingdom");
    assert.equal(hits.get("future-results")!.count, 2, "two bouts on the card dated after today carry a result");
    assert.equal(hits.get("future-results")!.level, "fail");
    assert.match(hits.get("future-results")!.examples[0], /2027-03-01 Future card/);
    const imp = hits.get("impossible-records")!;
    assert.equal(imp.level, "fail");
    assert.equal(imp.count, 3, "a winner in neither corner, a fighter against himself, more knockouts than wins");
    assert.ok(imp.examples.some((e) => /neither corner/.test(e)) && imp.examples.some((e) => /9 knockouts in 2 wins/.test(e)));
    assert.equal(hits.get("implausible-dates")!.count, 2, "a card dated 1700 and a fighter born in 2020");
    assert.ok(hits.get("small-divisions")!.examples.some((e) => /Strange/.test(e)));
    const sec = surprisesSection([...hits.values()]);
    assert.equal(sec.level, "fail");
    assert.match(sec.summary, /impossible-records/);
    assert.ok(sec.blocks.every((b) => b.kind !== "examples" || b.lines.length <= 10), "at most ten examples each");
  } finally { clean.clean(); bad.clean(); }
});

test("the examples of a heuristic are capped at ten however many there are", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-postload-test-"));
  try {
    const db = new DatabaseSync(path.join(dir, "x.db"));
    db.exec(SCHEMA);
    for (let i = 1; i <= 60; i++) db.prepare("INSERT INTO boxers (id, slug, name, country, birth_year, weight_class) VALUES (?,?,?,?,?,?)").run(i, `s${i}`, `Twin ${Math.ceil(i / 2)}`, "Mexico", 1990, "Lightweight");
    const s = gatherSurprises(db, TODAY).find((x) => x.id === "duplicate-fighters")!;
    assert.equal(s.count, 30);
    assert.equal(s.examples.length, 10);
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("sample statistics: champions are the official ones, activity and career span come from the bouts", () => {
  const { file, clean } = league(false);
  try {
    const rw = new DatabaseSync(file);
    rw.prepare("INSERT INTO official_rankings (boxer_id, kind, vacant) VALUES (3, 'champion', 0)").run();
    rw.prepare("INSERT INTO official_rankings (boxer_id, kind, vacant) VALUES (2, 'champion', 1)").run();
    rw.close();
    const db = new DatabaseSync(file, { readOnly: true });
    const s = new Map(gatherSampleStats(db).map((x) => [x.id, x]));
    assert.equal(s.get(1)!.fights, 4);
    assert.equal(s.get(1)!.titleWins, 1);
    assert.equal(s.get(1)!.first, "2011-05-01");
    assert.equal(s.get(1)!.last, "2014-05-01");
    assert.equal(s.get(3)!.champion, true);
    assert.equal(s.get(2)!.champion, false, "a vacant seat is nobody's");
    assert.equal(s.get(4)!.disputed, true);
    assert.equal(s.get(5)!.fights, 0);
    db.close();
  } finally { clean(); }
});

// ---- verdict, summary, redaction, report ----
const sec = (n: number, level: Section["level"], title = `S${n}`): Section => ({ id: `s${n}`, number: n, title, level, summary: `summary ${n}`, rows: [{ level: "pass", label: "l", detail: "d" }], blocks: [] });

test("the verdict is the worst section: a fail fails, a warn or a section that could not run warns, notes do not count", () => {
  assert.equal(verdict([sec(1, "pass"), sec(2, "pass"), sec(3, "info")]).level, "pass");
  assert.equal(verdict([sec(1, "pass"), sec(2, "warn")]).level, "warn");
  assert.equal(verdict([sec(1, "pass"), sec(2, "skip")]).level, "warn", "a section that did not run cannot make the verdict a pass");
  assert.equal(verdict([sec(1, "fail"), sec(2, "warn"), sec(3, "pass")]).level, "fail");
  assert.match(verdict([sec(1, "fail", "Audit")]).line, /^VERDICT: FAIL .*1 audit/);
  assert.match(verdict([sec(1, "pass")]).line, /^VERDICT: PASS/);
});

test("the terminal summary has one line per section with its tag, and ends on the verdict", () => {
  const ss = [sec(1, "pass"), sec(2, "warn"), sec(3, "fail"), sec(4, "skip"), sec(5, "info")];
  const lines = terminalSummary(ss, verdict(ss), ["head"], ["tail"]);
  assert.equal(lines[0], "head");
  assert.ok(lines.some((l) => /^PASS {2}1\./.test(l)) && lines.some((l) => /^WARN {2}2\./.test(l)) && lines.some((l) => /^FAIL {2}3\./.test(l)) && lines.some((l) => /^SKIP {2}4\./.test(l)) && lines.some((l) => /^NOTE {2}5\./.test(l)));
  assert.match(lines[lines.length - 2], /^VERDICT: FAIL/);
  assert.equal(lines[lines.length - 1], "tail");
});

test("the doctor judges a public deployment: its failures about a key are warnings here, a damaged database stays a failure", () => {
  const rows = doctorRows([
    { level: "fail", id: "api-key", message: "BOXING_API_KEY is not set" }, { level: "warn", id: "site-contact", message: "no contact" }, { level: "ok", id: "node", message: "Node 22" },
    { level: "ok", id: "sports-db", message: "5 boxers" }, { level: "fail", id: "sports-db", message: "cannot be read cleanly" }, { level: "info", id: "ai", message: "no key" },
  ]);
  assert.deepEqual(rows.map((r) => r.level), ["warn", "warn", "pass", "fail", "info"], "an ok that is not about the database is left out");
  assert.match(rows[0].detail, /not a problem with the loaded league/);
  assert.doesNotMatch(rows[3].detail, /not a problem/);
});

test("redaction: the home folder becomes ~, the temporary folder goes, and a secret setting's value is blanked wherever it is", () => {
  const redact = redactor({ home: "/Users/sam", tmp: ["/var/folders/xx/ringside-postload-ab12"], env: { BOXING_API_KEY: "sk-live-1234567890abcdef", ANTHROPIC_API_KEY: "short", SITE_URL: "https://example.org", MY_PASSWORD: "hunter2hunter2" } });
  const out = redact("db /Users/sam/ringside-real/real.db, copy /var/folders/xx/ringside-postload-ab12/league.db, key sk-live-1234567890abcdef, pw hunter2hunter2, short, https://example.org /Users/samuel/x");
  assert.equal(out, "db ~/ringside-real/real.db, copy (temporary copy), key [hidden], pw [hidden], short, https://example.org /Users/samuel/x");
  assert.equal(redactor({ home: "/", tmp: [], env: {} })("a /b"), "a /b", "a root home is never replaced");
});

test("the report is one self-contained page: no script, no outside file, nothing unescaped, no secret", () => {
  const ss: Section[] = [
    { ...sec(1, "pass", "Audit <b>and</b> doctor"), rows: [{ level: "warn", label: "a<script>alert(1)</script>", detail: "see https://example.org/ and ~/x" }], blocks: [{ kind: "table", head: ["a", "b"], rows: [["x", 1234]] }, { kind: "examples", title: "t", lines: ["<img src=x onerror=alert(1)>"] }] },
    { ...sec(2, "pass"), blocks: [{ kind: "bars", caption: "Bouts per year", unit: "bouts", data: [{ label: "2000", value: 5 }, { label: "2001", value: 0, flag: true }] }, { kind: "gallery", items: [{ caption: "home", src: "data:image/jpeg;base64,AAAA", alt: "Screenshot" }] }] },
  ];
  const v = verdict(ss);
  const html = renderReport(ss, v, { title: "Ringside post-load report", generated: "now", headline: ["h"], sourceLabel: "~/ringside-real/real.db", notes: ["n"] }, redactor({ home: "/Users/sam", tmp: [], env: { BOXING_API_KEY: "sk-live-1234567890abcdef" } }), ["plain /Users/sam/x sk-live-1234567890abcdef"]);
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script/i, "no script at all");
  assert.doesNotMatch(html, /<link |@import|src="https?:|href="https?:|url\(http/i, "no outside resource");
  assert.doesNotMatch(html, /<img src=x|<b>and<\/b>|alert\(1\)<\/script>/, "markup in the data is text");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("1,234"), "numbers are grouped");
  assert.ok(html.includes('class="tag pass"') && html.includes('class="tag warn"'));
  assert.ok(html.includes('role="img"') && html.includes("flag"), "the chart is named and the flagged year drawn apart");
  assert.ok(html.includes("data:image/jpeg;base64,AAAA"));
  assert.doesNotMatch(html, /sk-live|\/Users\/sam/);
  assert.ok(html.includes("name=\"robots\" content=\"noindex"));
  assert.ok(html.includes("plain ~/x [hidden]"));
});

test("next steps name the sections to read first, then the fighters to open, with numbers from the data", () => {
  const steps = nextSteps([sec(1, "pass"), sec(2, "warn", "Counts"), sec(5, "fail", "Accessibility")], { photoShare: 0, arabicShare: 0.5, wikidataShare: 0, heaviest: { division: "Heavyweight", top: ["A", "B"] }, lightest: { division: "Minimumweight", top: ["C"] }, disputedExample: "D E", arabicExample: "/ar/boxers/x" });
  assert.match(steps[0], /section 2 \(Counts\).*WARN/);
  assert.match(steps[1], /section 5 \(Accessibility\).*FAIL/);
  assert.ok(steps.some((s) => /Heavyweight: A, B.*Minimumweight \(C\)/.test(s)));
  assert.ok(steps.some((s) => /D E/.test(s)) && steps.some((s) => /\/ar\/boxers\/x/.test(s)));
  assert.ok(steps.some((s) => /0\.0%, 50\.0% and 0\.0%.*vendor:enrich/.test(s)));
  assert.ok(!nextSteps([{ ...sec(5, "skip"), summary: "skipped by --skip" }], { photoShare: 1, arabicShare: 1, wikidataShare: 1 }).some((s) => /section 5/.test(s)), "a section the owner left out is not nagged about");
  assert.ok(!nextSteps([sec(1, "pass")], { photoShare: 0.5, arabicShare: 0.5, wikidataShare: 0.5 }).some((s) => /vendor:enrich/.test(s)), "no enrichment advice when it has been done");
});

// ---- the live part, as far as it can be tested without a server ----
test("the process list is read with names that hold spaces, and a tree is everything started under a process", () => {
  const procs = parsePs("  PID  PPID COMM\n    1     0 init\n 4100     1 npm exec next s\n 4101  4100 next-server (v16.3.8)\n 4102  4101 node\n 5000     1 other\n");
  assert.deepEqual(procs.map((p) => p.pid), [1, 4100, 4101, 4102, 5000]);
  assert.equal(procs[2].comm, "next-server (v16.3.8)");
  assert.deepEqual(descendants(procs, 4100), [4100, 4101, 4102]);
  assert.deepEqual(descendants(procs, 5000), [5000]);
  assert.deepEqual(descendants(procs, 9), [9], "a process that is gone is just itself");
});

test("the reference timings are the ones in docs/capacity.md", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs", "capacity.md"), "utf8");
  const row = (label: string) => doc.split("\n").find((l) => l.includes(label)) ?? "";
  const after = (label: string) => Number((/\|\s*\*{0,2}(\d+)\*{0,2}\s*\|\s*\d+\s*\|$/.exec(row(label).trim()) ?? [])[1]);
  const p = CAPACITY_REFERENCE.p50Ms;
  assert.equal(after("| share image of a fighter"), p["share image (fighter)"]);
  assert.equal(after("| fighters list sorted or paged"), p["fighters list (sorted, paged)"]);
  assert.equal(after("| **fighter page**"), p.fighter);
  assert.equal(after("| event page"), p.event);
  assert.equal(after("| home |"), p.home);
  assert.equal(after("| **country page**"), p.country);
  assert.equal(after("| a division's rankings"), p["rankings (a division)"]);
  assert.equal(after("| ⌘K search API"), p.search);
  assert.equal(after("| the sitemap file"), p.sitemap);
  assert.ok(doc.includes(`${CAPACITY_REFERENCE.startSeconds[0]} to ${CAPACITY_REFERENCE.startSeconds[1]} s`), "start-up range");
  assert.ok(doc.includes(`${CAPACITY_REFERENCE.rssStartGb} GB right after start`));
  assert.ok(doc.includes(`${CAPACITY_REFERENCE.rssLoadGb[0]} to ${CAPACITY_REFERENCE.rssLoadGb[1]} GB under load`));
});

const stub = (kind: string, p95: number, errors = 0): SpeedResult["kinds"][number] => ({ kind, coldMs: 100, coldStatus: 200, serial: { n: 12, reqPerSec: 0, p50: 50, p95: 80, p99: 90, max: 95 }, conc: { n: 36, reqPerSec: 20, p50: 120, p95, p99: p95, max: p95 }, errors, avgBytes: 100000, refP50: CAPACITY_REFERENCE.p50Ms[kind] });
const server = (startMs: number, rss = 400): Server => ({ base: "http://localhost:1", pid: 1, child: null as never, startMs, rssAtStartMb: rss, health: { fighters: 35012, bouts: 150000 }, logFile: "", stop: async () => {} });
const machineStub = { cores: 4, cpu: "Test CPU", ramGb: 16, platform: "linux x64", node: "22", load1Start: 1 };

test("the speed section judges the start, the memory, the answers and the slowest page, and says how busy the machine was", () => {
  const ok: SpeedResult = { kinds: [stub("home", 300), stub("fighter", 400)], concurrency: 4, rssPeakMb: 1200, load1Start: 1, load1End: 2, seconds: 30 };
  const good = speedSection(server(15_000), ok, machineStub);
  assert.equal(good.level, "pass");
  assert.match(good.summary, /cold start 15\.0 s, 1200 MB peak/);
  assert.match(JSON.stringify(good.blocks), /4 cores \(Test CPU\), 16 GB RAM/);
  assert.equal(speedSection(server(70_000), ok, machineStub).level, "warn");
  assert.equal(speedSection(server(130_000), ok, machineStub).level, "fail");
  assert.equal(speedSection(server(15_000), { ...ok, rssPeakMb: 2500 }, machineStub).level, "warn");
  assert.equal(speedSection(server(15_000), { ...ok, rssPeakMb: 3500 }, machineStub).level, "fail");
  assert.equal(speedSection(server(15_000), { ...ok, kinds: [stub("home", 2000)] }, machineStub).level, "warn");
  assert.equal(speedSection(server(15_000), { ...ok, kinds: [stub("home", 6000)] }, machineStub).level, "fail");
  const failed = speedSection(server(15_000), { ...ok, kinds: [stub("home", 100, 3)] }, machineStub);
  assert.equal(failed.level, "fail");
  assert.match(failed.rows.find((r) => r.label === "answers")!.detail, /home \(3 failed/);
  const busy = speedSection(server(15_000), { ...ok, load1Start: 9, load1End: 9 }, machineStub);
  assert.equal(busy.rows.find((r) => r.label === "how busy the machine was")!.level, "warn");
  assert.equal(speedSection(server(1), null, machineStub, "skipped").level, "skip");
});

test("every kind of page is timed from paths that come from the data", () => {
  const kinds = speedKinds({ fighters: ["a", "b"], events: [1, 2], bouts: [1], divisions: ["lightweight"], countries: ["mexico"], searches: ["ana"], top: "a", other: "b", latestEvent: 2 }, 24);
  assert.deepEqual(kinds.map((k) => k.kind), ["home", "fighters list (sorted, paged)", "fighter", "event", "rankings (a division)", "country", "search", "share image (fighter)", "sitemap"]);
  assert.deepEqual(kinds.find((k) => k.kind === "fighter")!.paths, ["/boxers/a", "/boxers/b"]);
  assert.deepEqual(kinds.find((k) => k.kind === "share image (fighter)")!.paths, ["/boxers/a/opengraph-image", "/boxers/b/opengraph-image"]);
  assert.ok(kinds.find((k) => k.kind === "fighters list (sorted, paged)")!.paths.every((p) => /^\/boxers\?sort=\w+&page=\d+$/.test(p)));
  assert.equal(speedKinds({ fighters: ["a"], events: [], bouts: [], divisions: [], countries: [], searches: [], top: "a", other: "a", latestEvent: null }, 1).some((k) => k.kind === "event"), false, "a kind with nothing to ask for is left out, not asked as an empty path");
});

// ---- the command and its documentation ----
test("the command exists, is documented where a person on load day looks, and reads only settings the doctor knows", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["post-load"], "tsx scripts/post-load.ts");
  for (const f of ["docs/load-day.md", "docs/real-data-runbook.md"]) assert.match(fs.readFileSync(path.join(ROOT, f), "utf8"), /npm run post-load/, f);
  const src = fs.readFileSync(path.join(ROOT, "scripts", "post-load.ts"), "utf8");
  assert.doesNotMatch(src, /BOXING_API_KEY|readKeyFile|vendor-fetch/, "the command never reads or needs the vendor key");
  assert.match(src, /readOnly|copyFileSync/, "it copies before it opens");
  assert.doesNotMatch(src, /new DatabaseSync\(original\b/, "the original is never opened as a database");
});

