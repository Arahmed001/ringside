import test from "node:test";
import assert from "node:assert/strict";
import { ORGS_PAGE, PEOPLE_PAGE, filterByName, pageRows, ranked } from "../lib/people-list";

/** The corners and officials leaderboards: a name filter that keeps each person's place in the ranking, forgives a slip, and pages. */
const NAMES = ["Marcus Quintero", "Tomás Villalba", "Rakan Al-Qahtani", "José Mora", "Marcos Quintero", "Zhang Wei", "Ñandú Pérez"];
const rows = NAMES.map((name) => ({ name }));
const nameOf = (r: { name: string }) => r.name;
const f = (q: string | undefined, names = {}) => filterByName(ranked(rows), nameOf, q, names);
const found = (q: string | undefined, names = {}) => f(q, names).rows.map((r) => `${r.rank}:${r.row.name}`);

test("an empty filter is everyone, each with the place in the ranking", () => {
  for (const q of [undefined, "", "   ", "!!"]) { assert.equal(f(q).rows.length, NAMES.length, String(q)); assert.equal(f(q).close, false); }
  assert.deepEqual(f("").rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7]);
});

test("a name is found by any of its words, in any order, ignoring accents and capitals, and keeps its rank", () => {
  assert.deepEqual(found("quintero"), ["1:Marcus Quintero", "5:Marcos Quintero"], "both, in ranking order, with the place each holds in the whole list");
  assert.deepEqual(found("villalba tomas"), ["2:Tomás Villalba"]);
  assert.deepEqual(found("JOSE"), ["4:José Mora"]);
  assert.deepEqual(found("nandu perez"), ["7:Ñandú Pérez"]);
  assert.deepEqual(found("al-qahtani"), ["3:Rakan Al-Qahtani"]);
  assert.deepEqual(found("marc"), ["1:Marcus Quintero", "5:Marcos Quintero"], "the start of a word is enough");
});

test("Arabic: found by the Arabic spelling when the table has it, and not when it has not", () => {
  const ar = { "Tomás Villalba": "توماس فيلالبا", "Rakan Al-Qahtani": "راكان القحطاني" };
  assert.deepEqual(found("فيلالبا", ar), ["2:Tomás Villalba"]);
  assert.deepEqual(found("القحطاني راكان", ar), ["3:Rakan Al-Qahtani"]);
  assert.deepEqual(found("فيلالبا"), [], "no table, no Arabic spelling to find");
});

test("when no name has what was typed, the nearest spellings are offered and the filter says so; a stranger gets nothing", () => {
  const near = f("Tomas Vilalba");
  assert.equal(near.close, true);
  assert.deepEqual(near.rows.map((r) => r.row.name), ["Tomás Villalba"]);
  assert.deepEqual(found("Marcis Quintero"), ["1:Marcus Quintero", "5:Marcos Quintero"], "equally near names both come, in ranking order");
  const slips = filterByName(ranked([{ name: "Gianni Vilalbx" }, { name: "Gianni Villalbe" }]), nameOf, "villalba", {});
  assert.deepEqual(slips.rows.map((r) => `${r.rank}:${r.row.name}`), ["2:Gianni Villalbe", "1:Gianni Vilalbx"], "one slip comes before two, whatever the ranking says");
  assert.equal(f("Zebulon Quackenbush").rows.length, 0);
  assert.equal(f("Zebulon Quackenbush").close, false, "nothing close is not 'the closest names'");
  assert.equal(f("quintero").close, false, "an exact match is not a guess");
  assert.deepEqual(found("Zhng Wi"), [], "a word of three letters or fewer must be exact, so two slips in two short words find no one");
});

test("a long list is paged, 50 at a time, each person keeping the place in the whole ranking", () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ name: `Person ${String.fromCharCode(65 + (i % 26))}${i}` }));
  const p = (page?: string, q?: string) => pageRows(many, nameOf, { q, page, names: {} });
  assert.equal(PEOPLE_PAGE, 50);
  assert.equal(p().pages, 3);
  assert.equal(p().shown.length, 50);
  assert.equal(p().shown[0].rank, 1);
  assert.deepEqual(p("2").shown.map((r) => r.rank), Array.from({ length: 50 }, (_, i) => 51 + i));
  assert.equal(p("3").shown.length, 20);
  assert.equal(p("3").shown[19].rank, 120, "the last person is reachable");
  assert.equal(p("3").of, 120);
  for (const bad of ["0", "-4", "abc", "2.7", "9999", ""]) { const x = p(bad); assert.ok(x.page >= 1 && x.page <= 3, bad); assert.ok(x.shown.length > 0, bad); }
  assert.equal(p("9999").page, 3, "past the end lands on the last page");
  // a filter pages the filtered list, and `of` stays the whole list
  const only = p(undefined, "person a");
  assert.ok(only.total > 0 && only.total < 120 && only.of === 120);
  assert.ok(only.shown.every((r) => r.row.name.toLowerCase().includes("person a")));
  assert.ok(only.shown.some((r) => r.rank > 26), "ranks are the whole list's, not renumbered");
  assert.equal(pageRows([], nameOf, { names: {} }).pages, 1, "an empty list is one empty page");
});

test("a list can ask for its own page size: the organisations index pages 36 cards at a time", () => {
  const gyms = Array.from({ length: 64 }, (_, i) => ({ name: `Gym ${i + 1}` }));
  assert.equal(ORGS_PAGE, 36);
  const one = pageRows(gyms, nameOf, { names: {}, size: ORGS_PAGE });
  assert.equal(one.pages, 2);
  assert.equal(one.shown.length, 36);
  const two = pageRows(gyms, nameOf, { names: {}, page: "2", size: ORGS_PAGE });
  assert.deepEqual([two.shown.length, two.shown[0].rank, two.shown[27].rank], [28, 37, 64], "the last gym is reachable");
  assert.equal(pageRows(gyms, nameOf, { names: {} }).pages, 2, "and the default is still 50");
  const found = pageRows(gyms, nameOf, { names: {}, q: "gym 6", size: ORGS_PAGE });
  assert.deepEqual(found.shown.map((r) => r.rank), [6, 16, 26, 36, 46, 56, 60, 61, 62, 63, 64], "a filter pages the filtered list (the word 6 is in every number that has a 6), with the whole list's ranks");
});
