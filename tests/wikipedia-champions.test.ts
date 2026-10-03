import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";
import { fetchPage, importChampions, parseChampionList, parseReignDates, plain, resolveQids, type ChampionSource } from "../lib/importers/wikipedia-champions";

/**
 * The fixtures are real excerpts of Wikipedia's WBO and IBF lists (saved 2026-10-03): the layout, the citations that run over several
 * lines, the interim champions "promoted", the US-style date in one IBF row. The tests that follow pin what a reign is read as, and
 * that nothing is linked to a fighter except through a Wikidata ID.
 */
process.env.RINGSIDE_NO_SEED = "1";
process.env.WIKIMEDIA_CONTACT = "tests@example.invalid";
const cleanup = tempDb("wp-champions");
after(cleanup);
const fx = (n: string) => fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "wikipedia", n), "utf8");

test("a reign's dates are read the ways the lists write them, and anything else is refused rather than guessed", () => {
  const ok: [string, string | null, string | null, boolean][] = [
    ["6 May 1989 – 11 Jan 1991", "1989-05-06", "1991-01-11", false],
    ["11 Jan – 28 Dec 1991", "1991-01-11", "1991-12-28", false], // the start's year is the end's
    ["30 May – 1 Aug 1987", "1987-05-30", "1987-08-01", false],
    ["5 – 12 Jun 1990", "1990-06-05", "1990-06-12", false],
    ["17 May 1990 – 1991", "1990-05-17", "1991", false], // an end with only a year stays a year
    ["17 Dec 1994 – Mar 1995", "1994-12-17", "1995-03", false],
    ["30 Jan – Apr 2010", "2010-01-30", "2010-04", false],
    ["Feb – 5 Dec 2009", "2009-02", "2009-12-05", false],
    ["27 Feb 2010 –7 May 2011", "2010-02-27", "2011-05-07", false],
    ["4 May 1996 – Sep 7, 1998", "1996-05-04", "1998-09-07", false], // US-style, as one IBF row has it
    ["9 May 2026 – present", "2026-05-09", null, true],
    ["20 Jul 2026 – Present", "2026-07-20", null, true],
  ];
  for (const [text, start, end, current] of ok) assert.deepEqual(parseReignDates(text), { start, end, current }, text);
  for (const bad of ["", "bad", "1991", "11 Jan – 28 Dec", "31 Feb", "12 Foo 1990 – 1991", "5 Jan 1991 – 3 Jan 1991", "31 Feb 1990 – 1991", "1 Jan 1990 – 31 Apr 1990"]) assert.equal(parseReignDates(bad), null, JSON.stringify(bad));
});

test("wikitext is reduced to the words it shows: references, comments and templates go, links keep their text", () => {
  assert.equal(plain("Mercer was stripped of the title in [[December 1991]] for [[mandatory challenger|a refusal]].<ref>{{cite news |title=x |url=https://y}}</ref> <!-- hidden -->"), "Mercer was stripped of the title in December 1991 for a refusal.");
  assert.equal(plain("{{small|def. [[Johnny du Plooy]]}}"), "def. Johnny du Plooy");
  assert.equal(plain("'''bold''' and ''italic''<br/>two"), "bold and italic two");
});

test("the WBO excerpt: every reign read, none skipped, the sub-line facts right", () => {
  const notes = { rowsSkipped: 0, divisionUnknown: 0, datesUnread: 0, examples: [] as string[] };
  const r = parseChampionList(fx("wbo-excerpt.wikitext"), "WBO", notes);
  assert.deepEqual([notes.rowsSkipped, notes.datesUnread, notes.divisionUnknown, notes.examples.length], [0, 0, 0, 0], notes.examples.join("\n"));
  const per: Record<string, number> = {}; for (const x of r) per[x.division] = (per[x.division] ?? 0) + 1;
  assert.deepEqual(per, { Heavyweight: 26, Middleweight: 27, Minimumweight: 24 }, "'Mini flyweight' is the page's name for Minimumweight");
  const d = r.find((x) => x.division === "Heavyweight" && x.n === 1)!;
  assert.deepEqual([d.name, d.wikiTitle, d.start, d.end, d.current, d.wonVs, d.defences], ["Francesco Damiani", "Francesco Damiani", "1989-05-06", "1991-01-11", false, "Johnny du Plooy", 1]);
  const mercer = r.find((x) => x.name === "Ray Mercer")!;
  assert.equal(mercer.start, "1991-01-11"); assert.equal(mercer.end, "1991-12-28");
  assert.match(mercer.endNote!, /^Mercer was stripped of the title in December 1991 for signing for a bout against Larry Holmes/);
  assert.ok(!/cite|http|<ref/.test(mercer.endNote!), "no citation text in the note");
  const now = r.filter((x) => x.current);
  assert.deepEqual(now.map((x) => [x.division, x.name, x.start]), [["Heavyweight", "Daniel Dubois", "2026-05-09"], ["Middleweight", "Denzel Bentley", "2026-07-20"], ["Minimumweight", "Oscar Collazo", "2023-05-27"]]);
  assert.ok(r.every((x) => x.end || x.current), "every reign ends or is current");
  assert.equal(r.filter((x) => x.current).length, 3, "one current champion per division");
  const interim = r.find((x) => x.name === "Hassan N'Dam N'Jikam")!;
  assert.equal(interim.wonNote, "interim champion promoted"); assert.equal(interim.wonVs, null);
  const camacho = r.find((x) => /Camacho/.test(x.name) && x.n === 3);
  if (camacho) assert.equal(camacho.name, "Héctor Camacho", "the (2) counter is not part of the name");
  assert.ok(r.some((x) => x.endNote && /Eubank/.test(x.endNote)), "a note whose citation template runs over several lines is one note, not split cells");
  assert.ok(r.every((x) => x.n !== null && x.n >= 1 && x.start), "numbers and starts present");
  // the page itself numbers two consecutive minimumweight reigns "4" (Alex Sánchez, then Ricardo López): both are kept, in order, each with its own position
  const fours = r.filter((x) => x.division === "Minimumweight" && x.n === 4);
  assert.deepEqual(fours.map((x) => [x.name, x.seq]), [["Alex Sánchez", fours[0].seq], ["Ricardo López", fours[0].seq + 1]]);
  assert.deepEqual([fours[1].start, fours[1].end], ["1997-08-23", "1997-08"], "a month-precision end stays a month");
  assert.deepEqual(r.filter((x) => x.division === "Heavyweight").map((x) => x.seq), Array.from({ length: 26 }, (_, i) => i + 1), "positions count from 1 within a table");
});

test("the IBF excerpt: an inaugural title, a repeat reign, and the US-style date", () => {
  const notes = { rowsSkipped: 0, datesUnread: 0, divisionUnknown: 0, examples: [] as string[] };
  const r = parseChampionList(fx("ibf-excerpt.wikitext"), "IBF", notes);
  assert.deepEqual([notes.rowsSkipped, notes.datesUnread], [0, 0], notes.examples.join("\n"));
  const holmes = r.find((x) => x.name === "Larry Holmes")!;
  assert.deepEqual([holmes.wonNote, holmes.wonVs, holmes.start, holmes.end, holmes.defences], ["awarded inaugural title", null, "1983-12-11", "1985-09-21", 3]);
  const hol = r.filter((x) => x.division === "Heavyweight" && x.name === "Evander Holyfield");
  assert.equal(hol.length, 3, "three reigns, one per row; the (2) and (3) are counters, not different people");
  assert.ok(hol.every((x) => x.wikiTitle === "Evander Holyfield" || x.wikiTitle === null), "later rows may have no link of their own");
  const johnson = r.find((x) => x.division === "Flyweight" && x.name === "Mark Johnson")!;
  assert.deepEqual([johnson.start, johnson.end], ["1996-05-04", "1998-09-07"]);
});

test("the WBA excerpt: primary and secondary lineages, status labels beside names, rows with no number, and a division we do not list yet", () => {
  const notes = { rowsSkipped: 0, datesUnread: 0, divisionUnknown: 0, examples: [] as string[] };
  const r = parseChampionList(fx("wba-excerpt.wikitext"), "WBA", notes);
  const per: Record<string, number> = {}; for (const x of r) per[`${x.division}/${x.category}`] = (per[`${x.division}/${x.category}`] ?? 0) + 1;
  assert.equal(per["Cruiserweight/primary champion lineage"] > 20 && per["Cruiserweight/secondary champion lineage"] > 0, true, JSON.stringify(per));
  assert.equal(notes.divisionUnknown, 1, "Bridgerweight is not in our division list yet");
  assert.ok(r.some((x) => x.division === "Bridgerweight"), "kept under the page's own name, not dropped");
  const haye = r.filter((x) => x.name === "David Haye" && x.division === "Cruiserweight" && x.status);
  assert.deepEqual(haye.map((x) => [x.status, x.start, x.end, x.wonVs]), [["Undisputed champion", "2008-03-08", "2008-05-14", "Enzo Maccarinelli"], ["Unified champion", "2008-05-14", "2008-06-19", null]], "the label after the dash is the status, not part of the name");
  assert.ok(r.every((x) => !/ – |&ndash;|small/.test(x.name)), "no status text left in a name");
  assert.equal(haye[0].defences, 0, "'0<br>(3)': the first figure is the defences");
  assert.ok(r.some((x) => x.n === null), "a row with no number cell is still a reign");
  const knight = r.find((x) => x.name === "Joe Knight" && x.division === "Light Heavyweight")!;
  assert.deepEqual([knight.start, knight.end], ["1933-02-26", "1933-03-01"], "'Feb 26 – 1 Mar 1933': the start's year is the end's");
  // the one row the page gives a single date for is refused and counted, never stored with an invented end
  assert.equal(notes.rowsSkipped, 1); assert.match(notes.examples[0], /Tszyu/);
  assert.ok(!r.some((x) => x.name === "Kostya Tszyu" && x.start === "2002-08-05" && x.end === null && !x.current));
});

test("the WBC excerpt: typos in the page are refused and counted, never guessed", () => {
  const notes = { rowsSkipped: 0, datesUnread: 0, divisionUnknown: 0, examples: [] as string[] };
  const r = parseChampionList(fx("wbc-excerpt.wikitext"), "WBC", notes);
  assert.equal(notes.datesUnread, 3);
  assert.deepEqual(notes.examples.map((e) => e.replace(/^.*#\d+ /, "")), ["Rodolfo González: 10 No 1972 – 11 Apr 1974", "Hilario Zapata: 24 Ma 1980 – 6 Feb 1982", "Marco Antonio Barrera: 22 Jun 2002"], "'No' might be Nov and 'Ma' might be Mar or May: not our call");
  assert.ok(!r.some((x) => x.name === "Rodolfo González" && x.start?.startsWith("1972")), "the misspelt-month rows are not stored");
  assert.equal(r.filter((x) => x.division === "Bridgerweight").length, 5);
});

test("a division's sub-tables (super, regular, interim) are kept apart, and a table that is not a reign list is ignored", () => {
  const wt = `==Heavyweight==
===Super champion===
{| class="wikitable"
!No.
!Name
!Reign
!Defenses
|-
!1
| [[A One]]
|1 Jan 2000 – 2 Feb 2001
|2
|}
===Regular champion===
{| class="wikitable"
!No.
!Name
!Reign
!Defenses
|-
!1
| [[B Two]]
|1 Jan 2000 – 2 Feb 2001
|0
|}
==Lightweight==
{| class="wikitable"
|-
|style="background:#7CB9E8;" width=5px| ||Current champion
|}`;
  const r = parseChampionList(wt, "WBA");
  assert.deepEqual(r.map((x) => [x.division, x.category, x.n, x.name]), [["Heavyweight", "super champion", 1, "A One"], ["Heavyweight", "regular champion", 1, "B Two"]]);
});

// ---- fetching and storing, with Wikipedia mocked ------------------------------------------------------------------------------------------------
const SRC: ChampionSource[] = [{ org: "WBO", page: "List_of_WBO_world_champions", sex: "male" }, { org: "IBF", page: "List_of_IBF_world_champions", sex: "male" }];
const QIDS: Record<string, string> = { "Francesco Damiani": "Q1", "Ray Mercer": "Q2", "Larry Holmes": "Q3", "Johnny du Plooy": "Q9" };

function wikipedia(opts: { rate?: number } = {}) {
  const calls: string[] = []; let limited = opts.rate ?? 0;
  const pages: Record<string, string> = { List_of_WBO_world_champions: fx("wbo-excerpt.wikitext"), List_of_IBF_world_champions: fx("ibf-excerpt.wikitext") };
  const impl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); const p = url.searchParams; calls.push(`${p.get("action")}:${p.get("page") ?? (p.get("titles") ?? "").split("|").length}`);
    if (limited > 0) { limited--; return new Response("slow down", { status: 429, headers: { "retry-after": "7" } }); }
    if (p.get("action") === "parse") return Response.json({ parse: { title: p.get("page")!.replace(/_/g, " "), revid: 123, wikitext: pages[p.get("page")!] } });
    const titles = (p.get("titles") ?? "").split("|");
    return Response.json({ query: { pages: titles.map((t) => QIDS[t] ? { title: t, pageprops: { wikibase_item: QIDS[t] } } : { title: t, missing: true }) } });
  }) as typeof fetch;
  return { impl, calls, pages };
}

test("importing: rows stored with their source and revision, QIDs resolved from the article links, a re-run replaces and never duplicates, and the cache spares the pages", async () => {
  const db = await (await import("../lib/db")).getDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-cache-"));
  const w = wikipedia();
  const s = await importChampions(db, { sources: SRC, fetchImpl: w.impl, cacheDir: dir, sleep: async () => {}, now: "2026-10-03T00:00:00.000Z" });
  assert.equal(s.pages, 2); assert.equal(s.reigns, 26 + 27 + 24 + 26 + 26, "WBO heavyweight, middleweight and minimumweight, IBF heavyweight and flyweight");
  assert.equal(s.skipped, 0);
  const row = db.prepare("SELECT * FROM title_reigns WHERE org='WBO' AND division='Heavyweight' AND n=1").get() as Record<string, unknown>;
  assert.deepEqual([row.name, row.wikidata_id, row.won_vs, row.won_vs_wikidata_id, row.source, row.revision, row.start_date, row.end_date], ["Francesco Damiani", "Q1", "Johnny du Plooy", "Q9", "List_of_WBO_world_champions", "123", "1989-05-06", "1991-01-11"]);
  assert.equal((db.prepare("SELECT wikidata_id w FROM title_reigns WHERE name='Michael Moorer' LIMIT 1").get() as { w: string | null }).w, null, "an article with no Wikidata item is stored without one");
  const total = (db.prepare("SELECT COUNT(*) c FROM title_reigns").get() as { c: number }).c;
  assert.equal(total, s.reigns);
  const fetched = w.calls.length;
  const again = await importChampions(db, { sources: SRC, fetchImpl: w.impl, cacheDir: dir, sleep: async () => {} });
  assert.equal((db.prepare("SELECT COUNT(*) c FROM title_reigns").get() as { c: number }).c, total, "re-running does not duplicate");
  assert.equal(w.calls.slice(fetched).filter((c) => c.startsWith("parse")).length, 0, "the page text came from the cache");
  assert.equal(again.reigns, s.reigns);
  // a row removed upstream disappears on the next import
  const trimmed = w.pages.List_of_IBF_world_champions.replace(/!1\n\|align=left \|\s+\[\[Larry Holmes\]\][\s\S]*?\|3\n/, "");
  assert.notEqual(trimmed, w.pages.List_of_IBF_world_champions, "the fixture edit applied");
  w.pages.List_of_IBF_world_champions = trimmed;
  await importChampions(db, { sources: SRC, fetchImpl: w.impl, cacheDir: dir, sleep: async () => {}, refresh: true });
  assert.equal((db.prepare("SELECT COUNT(*) c FROM title_reigns WHERE name='Larry Holmes'").get() as { c: number }).c, 0, "gone upstream, gone here");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a reign is linked to a fighter only through a Wikidata ID that one of our fighters carries; a name alone never links", async () => {
  const db = await (await import("../lib/db")).getDb();
  const { linkReigns } = await import("../lib/importers/wikipedia-champions");
  db.exec(`INSERT INTO boxers (id, name, slug) VALUES (9001, 'Francesco Damiani', 'francesco-damiani'), (9002, 'Ray Mercer', 'ray-mercer'), (9003, 'Ray Mercer', 'ray-mercer-2')`);
  db.exec(`INSERT INTO wikidata_boxers (qid, name, matched_boxer_id, match_method) VALUES ('Q1', 'Francesco Damiani', 9001, 'boxrec')`);
  // Q2 is Ray Mercer on Wikidata, but none of our two Ray Mercers was matched to it: the name is not enough
  const n = linkReigns(db);
  assert.equal((db.prepare("SELECT boxer_id b FROM title_reigns WHERE name='Francesco Damiani' AND org='WBO'").get() as { b: number | null }).b, 9001);
  assert.equal((db.prepare("SELECT boxer_id b FROM title_reigns WHERE name='Ray Mercer' AND org='WBO'").get() as { b: number | null }).b, null, "two fighters with that name, none matched by ID: unlinked");
  assert.equal(n, (db.prepare("SELECT COUNT(*) c FROM title_reigns WHERE boxer_id IS NOT NULL").get() as { c: number }).c);
  // two Wikidata entries matched to one fighter would be ambiguous: neither is linked
  db.exec(`INSERT INTO wikidata_boxers (qid, name, matched_boxer_id, match_method) VALUES ('Q2', 'Ray Mercer', 9002, 'name+year'), ('Q3', 'Larry Holmes', 9002, 'name+year')`);
  linkReigns(db);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM title_reigns WHERE boxer_id = 9002").get() as { c: number }).c, 0, "one fighter claimed by two IDs is not linked to either");
});

test("Wikipedia's rate limit is waited out (Retry-After first), and it gives up with a plain message when it never relents", async () => {
  const waits: number[] = [];
  const w = wikipedia({ rate: 2 });
  const p = await fetchPage("List_of_IBF_world_champions", { fetchImpl: w.impl, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(p.revision, "123"); assert.deepEqual(waits, [7000, 7000], "twice limited, twice waited the Retry-After seconds");
  const never = wikipedia({ rate: 99 });
  await assert.rejects(() => fetchPage("List_of_WBA_world_champions", { fetchImpl: never.impl, sleep: async () => {} }), /kept refusing \(rate limit\): run again later/);
  assert.equal(never.calls.length, 6, "six attempts and no more");
});

test("it identifies itself to Wikimedia, and will not run without a contact", async () => {
  const saved = process.env.WIKIMEDIA_CONTACT; delete process.env.WIKIMEDIA_CONTACT;
  try { await assert.rejects(() => resolveQids(["A"], { fetchImpl: wikipedia().impl }), /Set WIKIMEDIA_CONTACT/); }
  finally { process.env.WIKIMEDIA_CONTACT = saved; }
  let ua = "";
  await resolveQids(["Francesco Damiani"], { fetchImpl: (async (_u: unknown, init?: RequestInit) => { ua = String((init?.headers as Record<string, string>)["User-Agent"]); return Response.json({ query: { pages: [] } }); }) as typeof fetch });
  assert.match(ua, /^RingsideBot\/0\.1 \(tests@example\.invalid\)$/);
});
