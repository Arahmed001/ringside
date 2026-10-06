import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { firstDir, nextSort, parseSort, sortQuery, sortRanked } from "../lib/table-sort";
import { pageRanked, ranked } from "../lib/people-list";

const COLS = { rank: { textual: true }, name: { textual: true }, ko: { textual: false } };
const DEF = { key: "rank" as const, dir: "asc" as const };
type Row = { name: string; ko: number | null };
const rows: Row[] = [{ name: "Zed", ko: 40 }, { name: "Émile", ko: null }, { name: "adam", ko: 70 }, { name: "Bo", ko: 40 }, { name: "Cy", ko: 10 }];

test("the sort asked for in the address: a known column, its direction or its first one; anything else is the default (round 121)", () => {
  assert.deepEqual(parseSort({}, COLS, DEF), DEF);
  assert.deepEqual(parseSort({ sort: "ko" }, COLS, DEF), { key: "ko", dir: "desc" }, "figures start with the most");
  assert.deepEqual(parseSort({ sort: "name" }, COLS, DEF), { key: "name", dir: "asc" }, "text starts at A");
  assert.deepEqual(parseSort({ sort: "ko", dir: "asc" }, COLS, DEF), { key: "ko", dir: "asc" });
  assert.deepEqual(parseSort({ sort: "ko", dir: "sideways" }, COLS, DEF), { key: "ko", dir: "desc" });
  for (const bad of ["nope", "", "constructor", "__proto__", "toString"]) assert.deepEqual(parseSort({ sort: bad }, COLS, DEF), DEF, bad);
  assert.deepEqual(parseSort({ sort: ["ko", "name"] }, COLS, DEF), { key: "ko", dir: "desc" }, "a repeated parameter: the first");
  assert.equal(firstDir(true), "asc"); assert.equal(firstDir(false), "desc");
});

test("clicking a column: the sorted one flips, another starts in its first direction; the default has a clean address", () => {
  assert.deepEqual(nextSort({ key: "ko", dir: "desc" }, "ko", false), { key: "ko", dir: "asc" });
  assert.deepEqual(nextSort({ key: "ko", dir: "asc" }, "ko", false), { key: "ko", dir: "desc" });
  assert.deepEqual(nextSort({ key: "ko", dir: "asc" }, "name", true), { key: "name", dir: "asc" });
  assert.deepEqual(nextSort(DEF, "rank", true), { key: "rank", dir: "desc" }, "the ranking can be turned over (worst first)");
  assert.deepEqual(sortQuery(DEF, DEF), {}); assert.deepEqual(sortQuery({ key: "ko", dir: "desc" }, DEF), { sort: "ko", dir: "desc" });
});

test("sorted rows keep their place in the whole ranking; missing values go last either way; ties keep ranking order; text ignores accents and capitals", () => {
  const r = ranked(rows);
  const ko = (b: Row) => b.ko;
  assert.deepEqual(sortRanked(r, { key: "ko", dir: "desc" }, ko).map((x) => `${x.row.name}#${x.rank}`), ["adam#3", "Zed#1", "Bo#4", "Cy#5", "Émile#2"], "most first; the tie (Zed, Bo) in ranking order; the unknown last");
  assert.deepEqual(sortRanked(r, { key: "ko", dir: "asc" }, ko).map((x) => x.row.name), ["Cy", "Zed", "Bo", "adam", "Émile"], "least first; the unknown still last");
  assert.deepEqual(sortRanked(r, { key: "name", dir: "asc" }, (b) => b.name).map((x) => x.row.name), ["adam", "Bo", "Cy", "Émile", "Zed"], "É sorts as E, capitals do not count");
  assert.deepEqual(sortRanked(r, { key: "name", dir: "desc" }, (b) => b.name).map((x) => x.row.name), ["Zed", "Émile", "Cy", "Bo", "adam"]);
  assert.deepEqual(sortRanked(r, { key: "rank", dir: "desc" }, () => null).map((x) => x.rank), [5, 4, 3, 2, 1], "the place itself, turned over");
  assert.deepEqual(sortRanked(r, { key: "rank", dir: "asc" }, () => null).map((x) => x.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(sortRanked(r, { key: "ko", dir: "desc" }, (b) => (b.ko === null ? NaN : b.ko)).at(-1)?.row.name, "Émile", "NaN counts as missing");
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3, 4, 5], "the input is not changed");
  const shuffled = [r[3], r[0], r[4], r[2], r[1]]; // not in ranking order: a tie is still broken by the place, not by where the row happened to be
  assert.deepEqual(sortRanked(shuffled, { key: "ko", dir: "desc" }, ko).map((x) => x.rank), [3, 1, 4, 5, 2]);
});

test("a sorted list is paged and filtered as a whole, each fighter keeping the place held in the division", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ name: `Fighter ${String(i).padStart(2, "0")}`, ko: i % 7 }));
  const sorted = sortRanked(ranked(many), { key: "ko", dir: "desc" }, (b) => b.ko);
  const p1 = pageRanked(sorted, (b) => b.name, { page: "1", names: {}, size: 25 }), p3 = pageRanked(sorted, (b) => b.name, { page: "3", names: {}, size: 25 });
  assert.equal(p1.of, 60); assert.equal(p1.pages, 3); assert.equal(p3.shown.length, 10);
  assert.deepEqual(p1.shown.slice(0, 8).map((x) => x.row.ko), Array(8).fill(6), "the first page starts with all eight of the best"); assert.equal(p1.shown[8].row.ko, 5);
  assert.equal(p1.shown[0].row.ko, 6); assert.equal(p3.shown.at(-1)?.row.ko, 0);
  assert.equal(p1.shown[0].rank, many.findIndex((m) => m.ko === 6) + 1, "the place in the unsorted division");
  const f = pageRanked(sorted, (b) => b.name, { q: "fighter 07", names: {}, size: 25 });
  assert.deepEqual(f.shown.map((x) => x.rank), [8], "a name filter on a sorted list still reports the real place");
});

test("the division table has sortable headings, whole-division sorting and a clean default (round 121)", () => {
  const root = path.resolve(__dirname, "..");
  const page = fs.readFileSync(path.join(root, "app/[locale]/rankings/[division]/page.tsx"), "utf8");
  for (const col of ["rank", "name", "record", "ko", "last", "rating"]) assert.match(page, new RegExp(`column="${col}"`), `${col} is sortable`);
  assert.match(page, /sortRanked\(ranked\(rankedBoxers\(/, "the whole division is sorted before it is paged");
  assert.match(page, /\.\.\.sortQ, \.\.\.\(n > 1/, "the pager keeps the sort"); assert.match(page, /hidden=\{\{ \.\.\.\(sex === "female" \? \{ sex \} : \{\}\), \.\.\.sortQ \}\}/, "the name filter keeps the sort");
  const th = fs.readFileSync(path.join(root, "components/SortTh.tsx"), "utf8");
  assert.match(th, /aria-sort=/); assert.match(th, /aria-hidden/); assert.match(th, /Sort by \{column\}/);
});
