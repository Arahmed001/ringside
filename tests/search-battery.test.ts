import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { searchCases, type SearchCase } from "./search-battery";

const cleanup = tempDb("search-battery");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let ar: Record<string, string>;
let cases: SearchCase[];
let find: typeof import("../lib/fighter-search").searchFighters;
before(async () => {
  w = await (await import("../lib/world")).getWorld();
  ar = await (await import("../lib/i18n/names")).getNames("ar");
  find = (await import("../lib/fighter-search")).searchFighters;
  cases = searchCases(w, ar);
});

function rates(group?: SearchCase["group"], kind?: RegExp) {
  const sel = cases.filter((c) => (!group || c.group === group) && (!kind || kind.test(c.kind)));
  let top1 = 0, top8 = 0;
  for (const c of sel) {
    const hits = find(w, c.q, { limit: 8, names: c.ar ? ar : {} });
    const i = hits.findIndex((b) => b.id === c.target);
    if (i === 0) top1++;
    if (i >= 0) top8++;
  }
  return { n: sel.length, top1: top1 / sel.length, top8: top8 / sel.length };
}

test("the battery has the volume and variety it claims: thousands of queries, five groups, both languages", () => {
  assert.ok(cases.length >= 3000, `${cases.length} queries`);
  assert.deepEqual([...new Set(cases.map((c) => c.group))].sort(), ["A", "AR", "B", "C", "D"]);
  assert.ok(new Set(cases.map((c) => c.kind)).size >= 25);
  assert.ok(cases.filter((c) => c.ar).length >= 500);
});

test("names typed as written are found first (the control): nothing the forgiveness added may cost exact search anything", () => {
  const control = rates(undefined, /as written \(control\)/);
  assert.ok(control.top8 === 1 && control.top1 >= 0.97, JSON.stringify(control));
});

test("a fighter is in the first eight results for the slips people make: letters missing, wrong, swapped, doubled, vowels confused, initials, hyphens, nicknames", () => {
  for (const [g, floor] of [["A", 0.99], ["B", 0.97], ["C", 0.95], ["D", 0.98], ["AR", 0.96]] as const) {
    const r = rates(g);
    assert.ok(r.top8 >= floor, `group ${g}: ${(100 * r.top8).toFixed(1)}% in the top eight, wanted ${100 * floor}% (${r.n} queries)`);
  }
});

test("and usually first: group A and D one-slip kinds are the first result at least 90% of the time", () => {
  for (const k of [/missing from the surname/, /missing from the first name/, /swapped in the surname/, /wrong in the surname/, /neighbouring key hit in the surname/, /SHOUTED/, /stray letter/, /hyphen dropped/]) {
    const r = rates(undefined, k);
    assert.ok(r.top1 >= 0.9, `${k}: first result ${(100 * r.top1).toFixed(1)}% (${r.n})`);
  }
});

test("nothing is found for what is not a name: the far-off strings return no fighter", () => {
  for (const junk of ["qqqqqqqq", "zzzzzzzzz", "xqjvkw", "mmmmmmm", "qwertyuiop", "jjjjjjjjj"]) assert.deepEqual(find(w, junk, { limit: 8 }).map((b) => b.name), [], junk);
});
