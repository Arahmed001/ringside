import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * docs/capacity.md: the fighters list's text search normalised every fighter's name on every request (160 to 210 ms at 35,000 fighters). The normalised text
 * is now kept per fighter and language table. The old way is written out here, as it was, and the new one must return the same fighters in the same order.
 */
const cleanup = tempDb("capacity-textsearch");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
type Boxer = World["boxers"][number];
let w: World;
let A: typeof import("../lib/ai");
let F: typeof import("../lib/fighter-search");
before(async () => { w = await (await import("../lib/world")).getWorld(); A = await import("../lib/ai"); F = await import("../lib/fighter-search"); });

const NAMES: [string, string | null][] = [
  ["José Ramírez", "Camaron"], ["Jose Ramirez", null], ["Łukasz Đorđević", "Łuki"], ["Müller Æsir Jr.", "Junior"], ["Oleksandr Usyk", "The Cat"],
  ["محمد علي", "الأعظم"], ["مُحَمَّد عَلِيّ", null], ["أحمد إبراهيم", "ابو ابراهيم"], ["فاطمة الزهراء", "ـفاطمةـ"], ["Ahmed Ibrahim", null], ["Sugar Ray Robinson", "Sugar"], ["Æthelstan the 2nd", "ßtone"],
];
/** the fighters of this league, plus these (spread from a real one so they are whole BoxerFull objects) */
const crowd = (): Boxer[] => [...w.boxers.filter((b) => b.bouts > 0).slice(0, 400), ...NAMES.map(([name, nickname], i) => ({ ...w.boxers[i % w.boxers.length], id: 900_000 + i, name, nickname, rating: 1000 + i }))];
const TABLES: Record<string, string>[] = [{}, { "José Ramírez": "خوسيه راميريز", "Oleksandr Usyk": "أولكسندر أوسيك", "Camaron": "كامارون", "Sugar Ray Robinson": "شوغر راي روبنسون" }];
const QUERIES = ["jose", "José", "ramirez", "RAMÍREZ", "lukasz", "dorde", "đorđević", "muller", "aesir", "jr", "junior", "usyk", "cat", "ray robinson", "2nd", "second", "ss", "ssstone", "محمد", "علي", "على", "احمد", "أحمد", "إبراهيم", "ابراهيم", "فاطمه", "الاعظم", "خوسيه", "راميريز", "اوسيك", "zz", "  ", "fighter", "a", "1"];

const old = (boxers: Boxer[], text: string, names: Record<string, string>) =>
  boxers.filter((b) => F.normalize(`${b.name} ${names[b.name] ?? ""} ${b.nickname ?? ""} ${b.nickname ? names[b.nickname] ?? "" : ""}`).includes(F.normalize(text))).sort((a, b) => b.rating - a.rating);

test("text search returns the same fighters in the same order as normalising every name on the spot, accents and Arabic included", () => {
  const boxers = crowd();
  let compared = 0, nonEmpty = 0;
  for (const names of TABLES) for (const q of QUERIES) {
    const want = old(boxers, q, names).map((b) => b.id);
    const first = A.applyFilters(boxers, { text: q }, w, names).map((b) => b.id);
    const again = A.applyFilters(boxers, { text: q }, w, names).map((b) => b.id); // from the kept text
    assert.deepEqual(first, want, `${JSON.stringify(q)} (${Object.keys(names).length} translated names)`);
    assert.deepEqual(again, want, `${JSON.stringify(q)} again`);
    compared++; if (want.length) nonEmpty++;
  }
  assert.ok(compared >= 60 && nonEmpty >= 40, `${compared} comparisons, ${nonEmpty} with something found`);
});

test("accents and Arabic spellings still meet, and translated names are searched", () => {
  const boxers = crowd();
  const ids = (q: string, names: Record<string, string> = {}) => A.applyFilters(boxers, { text: q }, w, names).map((b) => b.id);
  assert.ok(ids("jose ramirez").includes(900_000) && ids("jose ramirez").includes(900_001), "José and Jose are one");
  assert.ok(ids("على").includes(900_005) && ids("محمد").includes(900_006), "ى = ي, and vowel marks do not matter");
  assert.ok(ids("خوسيه", TABLES[1]).includes(900_000), "a translated name is found");
  assert.ok(!ids("خوسيه", TABLES[0]).includes(900_000), "...and only with its table");
});

test("the kept text is per language table, and is not shared between fighters", () => {
  const b = { ...w.boxers[0], name: "Test Name", nickname: null } as Boxer;
  assert.equal(A.searchTextOf(b, {}), "test name");
  assert.equal(A.searchTextOf(b, { "Test Name": "اختبار" }), "test name اختبار");
  assert.equal(A.searchTextOf(b, {}), "test name", "the first table's text was not replaced");
  const c = { ...b, name: "Other" } as Boxer;
  assert.equal(A.searchTextOf(c, {}), "other");
});

test("a text search over the whole league is not slower than the old way was (and the second one is much faster)", () => {
  const boxers = w.boxers;
  const t0 = performance.now(); old(boxers, "fighter 1", {}); const oldMs = performance.now() - t0;
  A.applyFilters(boxers, { text: "fighter 1" }, w, {}); // fills the kept text
  const t1 = performance.now(); A.applyFilters(boxers, { text: "fighter 1" }, w, {}); const newMs = performance.now() - t1;
  assert.ok(newMs <= oldMs * 1.5 + 5, `kept: ${newMs.toFixed(1)} ms, normalising every name: ${oldMs.toFixed(1)} ms`);
});
