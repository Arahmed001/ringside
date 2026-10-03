import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";
import { allowedSlips, editDistance, prefixDistance } from "../lib/fuzzy";

/**
 * A league of eight fighters worked out by hand, to check what a forgiving name search should and should not do. Near-duplicates are on purpose
 * (Villalba and Villalta are one letter apart): a search that forgives must still put the one you meant first, and must not forgive its way to a stranger.
 */
const cleanup = tempDb("search-forgiving");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-sf-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let find: typeof import("../lib/fighter-search").searchFighters;
const NAMES: Record<string, string> = { "Tomás Villalba": "توماس فيلالبا", "Rakan Al-Qahtani": "راكان القحطاني" };
const q = (query: string, opts: { forgiving?: boolean; names?: Record<string, string>; limit?: number } = {}) => find(w, query, { limit: 8, ...opts }).map((b) => b.name);

before(async () => {
  const feed = miniFeed();
  feed.boxers = [
    makeBoxer("x1", "Lightweight", { name: "Tomás Villalba" }), makeBoxer("x2", "Lightweight", { name: "Tomás Villalta" }), makeBoxer("x3", "Lightweight", { name: "Rakan Al-Qahtani" }),
    makeBoxer("x4", "Lightweight", { name: "Zhang Wei" }), makeBoxer("x5", "Lightweight", { name: "Wei Zhang" }), makeBoxer("x6", "Lightweight", { name: "Yazan H. Al-Ghamdi", nickname: "The Hammer" }),
    makeBoxer("x7", "Lightweight", { name: "Bartholomew Featherstonehaugh" }), makeBoxer("x8", "Lightweight", { name: "José Mora" }),
  ];
  feed.events = [{ externalId: "E1", name: "Night", date: "2025-01-10", venue: "Arena", city: "Reno", country: "United States" }, { externalId: "E2", name: "Called Off", date: "2025-02-10", venue: "Zephyr Hall", city: "Quito", country: "Ecuador", status: "cancelled" } as never];
  feed.people = [...feed.people, { externalId: "Q1", name: "Marcos Quintero" }, { externalId: "Q2", name: "Marcus Quintero" }];
  feed.bouts = []; feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = []; feed.stints = [];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
  find = (await import("../lib/fighter-search")).searchFighters;
});

test("edit distance: insertions, deletions, substitutions and a swap of neighbours are one each, and it stops counting past the limit", () => {
  assert.equal(editDistance("villalba", "villalba", 2), 0);
  assert.equal(editDistance("vilalba", "villalba", 2), 1, "a letter missing");
  assert.equal(editDistance("villalbaa", "villalba", 2), 1, "a letter added");
  assert.equal(editDistance("villalta", "villalba", 2), 1, "a letter wrong");
  assert.equal(editDistance("vilalbal", "villalba", 2), 2, "a swap of neighbours elsewhere plus a drop");
  assert.equal(editDistance("zhnag", "zhang", 2), 1, "two neighbours swapped is one slip, not two");
  assert.equal(editDistance("abc", "xyzxyz", 2), 3, "past the limit it says limit + 1, not the true distance");
  assert.equal(editDistance("abcdefgh", "ab", 2), 3, "lengths too far apart");
  assert.equal(prefixDistance("vill", "villalba", 1), 0, "what you have typed so far is the start of the word");
  assert.equal(prefixDistance("vilal", "villalba", 1), 1, "a slip in a half-typed word");
  assert.equal(prefixDistance("xyzw", "villalba", 1) > 1, true);
  assert.deepEqual([3, 4, 6, 7, 12].map(allowedSlips), [0, 1, 1, 2, 2]);
});

test("a letter missing, wrong or swapped still finds the fighter, and the one meant comes first", () => {
  assert.deepEqual(q("tomas vilalba"), ["Tomás Villalba", "Tomás Villalta"], "Villalta is two slips from 'vilalba' (second), Villalba is one (first)");
  assert.deepEqual([...q("tomas villalva")].sort(), ["Tomás Villalba", "Tomás Villalta"], "a tie between two names one letter away: both are offered");
  assert.deepEqual(q("tomsa villalba"), ["Tomás Villalba", "Tomás Villalta"], "first-name letters swapped: the one whose surname is exact first, the other (a slip in each word) second");
  assert.deepEqual([...q("zhnag wei")].sort(), ["Wei Zhang", "Zhang Wei"], "a swapped pair finds both Zhangs (the order of the two words typed does not matter)");
  assert.deepEqual(q("bartholomew featherstonehaug"), ["Bartholomew Featherstonehaugh"], "typed so far is exact (a prefix), no forgiveness needed");
  assert.deepEqual(q("bartholomw featherstonehaug"), ["Bartholomew Featherstonehaugh"], "and a slip in a half-typed word");
});

test("a hyphen or space run together or dropped, an initial with a full stop, and punctuation or shouting around a name", () => {
  assert.deepEqual(q("alqahtani"), ["Rakan Al-Qahtani"], "'Al-Qahtani' typed as one word");
  assert.deepEqual(q("rakan alqahtni"), ["Rakan Al-Qahtani"], "run together and a letter missing");
  assert.deepEqual(q("al qahtani"), ["Rakan Al-Qahtani"]);
  assert.deepEqual(q("al-qahtani"), ["Rakan Al-Qahtani"]);
  assert.deepEqual(q("Y. Al-Ghamdi"), ["Yazan H. Al-Ghamdi"], "an initial with a full stop (this found nothing before)");
  assert.deepEqual(q("yazan alghamdi"), ["Yazan H. Al-Ghamdi"]);
  assert.deepEqual(q("  TOMAS   VILLALBA!! "), ["Tomás Villalba"]);
  assert.deepEqual(q("“tomas villalba”?"), ["Tomás Villalba"]);
  assert.deepEqual(q("the hammer"), ["Yazan H. Al-Ghamdi"], "a nickname");
  assert.deepEqual(q("the hamer"), ["Yazan H. Al-Ghamdi"], "a nickname with a slip");
});

test("it does not forgive too much: short words are exact, nonsense finds nothing, and an exact match is never padded with near ones", () => {
  assert.deepEqual(q("wai"), [], "three letters: no slips allowed ('wai' is not 'wei')");
  assert.deepEqual(q("r alqahtani"), ["Rakan Al-Qahtani"], "an initial that starts a word, with the other word run together");
  assert.deepEqual(q("k alqahtani"), [], "an initial must start a word: there is a k inside 'Rakan' but no word starts with one");
  assert.deepEqual(q("xyz"), []);
  assert.deepEqual(q("joe mora"), [], "'joe' is one letter from 'jose' but three-letter words get no slips");
  assert.deepEqual(q("jose mora"), ["José Mora"], "and with the accent folded the real name is found");
  assert.deepEqual(q("josé mroa"), ["José Mora"], "while a longer word may slip (a swap in 'mora' is one)");
  assert.deepEqual(q("qqqqqqqq"), []);
  assert.deepEqual(q("tomas zzzzzzz"), [], "one word right does not carry a wrong one");
  // as the START of a long word only what was typed counts: two slips in four letters is half of it, however long the name ("ramil abat" must not offer Bautista)
  assert.deepEqual(q("abrt featherstonehaugh"), ["Bartholomew Featherstonehaugh"], "'abrt' is one swap from the start 'bart'");
  assert.deepEqual(q("bxrx featherstonehaugh"), [], "'bxrx' is two slips from the start 'bart': half the typed word");
  assert.deepEqual(q("bart featherstonehaugh"), ["Bartholomew Featherstonehaugh"], "and 'bart' is just its start");
  assert.deepEqual(q("bartt featherstonehaugh"), ["Bartholomew Featherstonehaugh"], "one slip in five letters is forgiven");
  // but as a whole long word two slips are two slips
  assert.deepEqual(q("bartholomw featherstonehag"), ["Bartholomew Featherstonehaugh"]);
  assert.deepEqual(q("w"), q("w", { forgiving: false }), "an initial alone is the old substring search");
  assert.ok(q("w").length >= 3);
  // an exact result is exactly what the old search gave: no near names appended
  assert.deepEqual(q("tomas villalba"), ["Tomás Villalba"], "Villalta is one letter away and is NOT added to an exact match");
  assert.deepEqual(q("tomas villalba"), q("tomas villalba", { forgiving: false }));
  assert.deepEqual(q("tomas vilalba", { forgiving: false }), [], "with forgiveness off, a slip finds nothing, as before");
});

test("Arabic: a letter missing or a look-alike letter, and the spelling variants that were already folded", () => {
  const n = { names: NAMES };
  assert.deepEqual(q("توماس فيلالبا", n), ["Tomás Villalba"]);
  assert.deepEqual(q("توماس فيلابا", n), ["Tomás Villalba"], "a letter missing");
  assert.deepEqual(q("راكان القحطاني", n), ["Rakan Al-Qahtani"]);
  assert.deepEqual(q("راكان القحطنى", n), ["Rakan Al-Qahtani"], "ya spelled with alef maqsura, and a letter missing");
  assert.deepEqual(q("راكان", { names: {} }), [], "without the Arabic names there is nothing to find");
});

test("the recent answers are kept, per question and per option, and are the same list each time", () => {
  const a = find(w, "tomas vilalba", { limit: 8 }), b = find(w, "tomas vilalba", { limit: 8 });
  assert.equal(a, b, "the same array: it came from the cache");
  assert.notEqual(find(w, "tomas vilalba", { limit: 1 }), a, "a different limit is a different question");
  assert.notEqual(find(w, "tomas vilalba", { limit: 8, forgiving: false }), a, "and so is forgiveness");
  assert.equal(find(w, "tomas vilalba", { limit: 1 }).length, 1);
  // English callers each pass their own empty table (the API route did, a fresh {} per request); an empty table is one table, so the index and the cache are shared
  assert.equal(find(w, "tomas vilalba", { limit: 8, names: {} }), a, "a fresh empty table gets the same index and the same cached answer");
  assert.equal(find(w, "tomas vilalba", { limit: 8, names: {} }), find(w, "tomas vilalba", { limit: 8, names: {} }));
});

test("getNames('en') is one shared table, not a new object on every call (the search index is kept per table)", async () => {
  const { getNames, NO_NAMES } = await import("../lib/i18n/names");
  assert.equal(await getNames("en"), NO_NAMES);
  assert.equal(await getNames("en"), await getNames("en"));
  assert.ok(Object.isFrozen(NO_NAMES));
});

test("the palette (⌘K): near spellings of a fighter show up only when nothing else matched", async () => {
  const { globalSearch } = await import("../lib/search");
  const { tEn } = await import("../lib/i18n/t");
  const names = (query: string) => globalSearch(w, query, tEn, {}).filter((h) => h.kind === "fighter").map((h) => h.title);
  assert.deepEqual(names("tomas vilalba"), ["Tomás Villalba", "Tomás Villalta"], "nothing else matched, so the guess is shown");
  // 'rankings' is a page: a fighter-name guess beside it would be noise, and 'rankigns' (a typo) is no page, so there the guess is allowed to show
  const exactPage = globalSearch(w, "rankings", tEn, {});
  assert.ok(exactPage.some((h) => h.kind === "page") && !exactPage.some((h) => h.kind === "fighter"));
  const withPageAndFighter = globalSearch(w, "weigh", tEn, {});
  assert.ok(!withPageAndFighter.some((h) => h.kind === "fighter"), "a page matched, so no near-name guesses");
});

test("the palette guesses trainers, judges, gyms and venues too, when nothing else matched, and shows every kind of guess together", async () => {
  const { globalSearch } = await import("../lib/search");
  const { tEn } = await import("../lib/i18n/t");
  const hits = (query: string, names: Record<string, string> = {}) => globalSearch(w, query, tEn, names).map((h) => `${h.kind}:${h.title}`);
  assert.deepEqual(hits("jugde two"), ["person:Judge Two"], "two letters swapped in a person's name");
  assert.deepEqual(hits("trainr one"), ["person:Trainer One"], "a letter missing");
  assert.deepEqual(hits("tset gym"), ["org:Test Gym"], "a gym with two letters swapped");
  assert.ok(hits("renoo").some((h) => h.startsWith("event:")), "a city with a letter added finds the events held there");
  assert.ok(hits("arenna").some((h) => h.startsWith("event:")), "a venue");
  // the nearest spelling comes first, not the first alphabetically: "Marcus" is 1 slip, "Marcos" 2, and "Marcos" sorts first
  assert.deepEqual(hits("marcus quinterro"), ["person:Marcus Quintero", "person:Marcos Quintero"], "fewest slips first");
  assert.deepEqual(hits("zephir hal"), [], "an event that was called off is not guessed");
  assert.deepEqual(hits("quito"), [], "(nor found by its city: it never took place)");
  // an exact match anywhere means no guessing at all
  assert.deepEqual(hits("judge two").filter((h) => !h.startsWith("person:Judge Two")), [], "an exact name: only what matches exactly");
  assert.ok(!hits("gym").some((h) => !/Test Gym|gym/i.test(h)), "'gym' matches the gym exactly, so nothing is guessed beside it");
  // a typo in a page name is not turned into a list of people
  assert.deepEqual(hits("rankigns"), [], "nothing is near enough to guess");
  // Arabic names are searched and forgiven too
  assert.deepEqual(hits("القاضي الثاني", { "Judge Two": "القاضي الثاني" }), ["person:Judge Two"]);
  // the index behind the guesses is built once per world and table, and an empty table is one table (English callers each bring their own)
  const { nearOf } = await import("../lib/search");
  assert.equal(nearOf(w, {}), nearOf(w, {}));
  const table = { "Judge Two": "القاضي الثاني" };
  assert.equal(nearOf(w, table), nearOf(w, table));
  assert.notEqual(nearOf(w, table), nearOf(w, {}), "a table with names is a different index");
  assert.deepEqual(hits("القاضي الثني", { "Judge Two": "القاضي الثاني" }), ["person:Judge Two"], "a letter missing in the Arabic");
});
