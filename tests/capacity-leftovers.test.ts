import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/**
 * docs/capacity.md, "The leftovers": (1) the palette's near-spelling index is built by the first search that needs it, not by the warm-up; (2) the Ask name index is flat
 * (typed arrays, one string per distinct word). Neither may change an answer: the palette is asked the same queries with the index built early and built late, and the
 * Ask planner is asked the same questions as a frozen copy of the code before the change (tests/fixtures/ask-rules-before.ts), English and Arabic, ties included.
 */
const cleanup = tempDb("capacity-leftovers");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-cl-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;

// a stand-in Arabic spelling: letter for letter, enough for the index to see different words with different lengths
const LETTERS: Record<string, string> = { a: "ا", b: "ب", c: "ك", d: "د", e: "ي", f: "ف", g: "ج", h: "ه", i: "ي", j: "ج", k: "ك", l: "ل", m: "م", n: "ن", o: "و", p: "ب", q: "ق", r: "ر", s: "س", t: "ت", u: "و", v: "ف", w: "و", x: "كس", y: "ي", z: "ز" };
const arabic = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split("").map((c) => LETTERS[c] ?? (c === " " || c === "-" ? c : "")).join("").trim();

const FIRST = ["Tomás", "Marcus", "Marcos", "Niklas", "Lukas", "Ramiel", "José", "Wei", "Sven", "Conor", "Yazan", "Rakan", "Ignacio", "Maria Elena", "Dmitri", "Ali"];
const LAST = ["Villalba", "Villalta", "Quintero", "Kessler", "Hartmann", "Al-Qahtani", "van der Berg", "O'Brien", "Garcia", "De La Fuente", "dos Santos", "bin Hassan", "Zhang", "Featherstonehaugh", "Mora", "Stroud Jr."];
const names: string[] = [];
for (let i = 0; i < 150; i++) {
  const n = `${FIRST[(i * 7) % FIRST.length]} ${i % 5 === 0 ? "G. " : ""}${LAST[(i * 11 + (i >> 3)) % LAST.length]}`;
  if (!names.includes(n)) names.push(n);
}
for (const n of ["Tomás Villalba", "Tomás Villalta", "Zhang Wei", "Wei Zhang", "Wyatt G. Stroud", "Bartholomew Featherstonehaugh", "Yazan H. Al-Ghamdi"]) if (!names.includes(n)) names.push(n);

before(async () => {
  const feed = miniFeed();
  feed.boxers = names.map((n, i) => makeBoxer(`g${i}`, "Lightweight", { name: n }));
  feed.people = [...feed.people, { externalId: "T9", name: "Niklas G. Kessler" }, { externalId: "T8", name: "Wyatt Stroud" }, { externalId: "T7", name: "Ignacio Ferrandez" }];
  feed.bouts = []; feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = [];
  feed.stints = ["T9", "T8", "T7"].map((p, i) => ({ boxerExternalId: `g${i}`, role: "head_trainer" as const, personExternalId: p, start: "2020-01-01", end: null, source: "test" }));
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
});

const registry = () => (globalThis as unknown as { __ringsideShared?: Map<string, WeakMap<WeakKey, unknown>> }).__ringsideShared;

/** A second world that is the same data: every cache keyed by world starts empty for it. */
const copyOf = (x: World): World => ({ ...x }) as World;

const arTable = (): Record<string, string> => {
  const t: Record<string, string> = {};
  for (const b of w.boxers) t[b.name] = arabic(b.name);
  for (const p of w.people.values()) t[p.name] = arabic(p.name);
  for (const o of w.orgs.values()) t[o.name] = arabic(o.name);
  for (const e of w.events) { t[e.name] = arabic(e.name); t[e.city] = arabic(e.city); t[e.venue] = arabic(e.venue); }
  return t;
};

const typos = (s: string): string[] => {
  const out = [s];
  if (s.length > 5) out.push(s.slice(0, 3) + s.slice(4), s.slice(0, 4) + s[3] + s.slice(4), s.slice(0, 2) + s[3] + s[2] + s.slice(4), s.slice(0, -1));
  return out;
};

test("palette: the warm-up does not build the near-spelling index, the first search that finds nothing does, and a search that finds something never does", async () => {
  const S = await import("../lib/search");
  const { WARM_STEPS } = await import("../lib/warm");
  const { getNames } = await import("../lib/i18n/names");
  const { tEn } = await import("../lib/i18n/t");
  const w2 = copyOf(w);
  const near = () => registry()?.get("search.ts:near")?.get(w2);
  for (const step of WARM_STEPS.filter(([n]) => n.startsWith("global search"))) await step[1](w2);
  assert.ok(registry()?.get("search.ts:exact")?.get(w2), "the exact-match text is warmed");
  assert.equal(near(), undefined, "the near index is not built by the warm-up");
  S.globalSearch(w2, "rankings", tEn, await getNames("en"));
  S.globalSearch(w2, tEn.name(w.boxers[0].name), tEn, await getNames("en"));
  assert.equal(near(), undefined, "a search with an answer does not build it");
  S.globalSearch(w2, "zzqx", tEn, {});
  assert.ok(near(), "the first search with no answer builds it");
});

test("palette: the same answers whether the near index was built early or late, English and Arabic, accents and typos", async () => {
  const S = await import("../lib/search");
  const { makeT } = await import("../lib/i18n/t");
  const { tEn } = await import("../lib/i18n/t");
  const ar = arTable();
  const tAr = makeT("ar", {}, ar);
  const early = copyOf(w), late = copyOf(w);
  for (const table of [{}, ar]) { S.nearOf(early, table); S.exactOf(early, table); } // what the old warm-up did
  S.warmGlobalSearch(late, {}); S.warmGlobalSearch(late, ar); // what it does now
  const people = [...w.people.values()].map((p) => p.name), orgs = [...w.orgs.values()].map((o) => o.name), evs = w.events.map((e) => e.name), places = w.events.flatMap((e) => [e.city, e.venue]);
  const en = [
    ...names.slice(0, 40).flatMap((n) => typos(n.toLowerCase())), "tomas vilalba", "tomás villalba", "Tomas Villalba", "marcus quinterro", "wyat stroud", "zhang", "al qahtani", "alqahtani", "van der berg", "vanderberg", "o'brien", "obrien",
    ...[...people, ...orgs, ...evs, ...places].flatMap((n) => typos(n.toLowerCase())), "jugde two", "trainr one", "tset gym", "renoo", "arenna", "rankigns", "rankings", "weigh", "a", "", "zzzz", "figther 12",
  ];
  const arq = [...names.slice(0, 40).flatMap((n) => typos(arabic(n))), ...[...people, ...orgs, ...evs].flatMap((n) => typos(arabic(n))), "القاضي الثني", "الحكم", "ترتيب"];
  let nonEmpty = 0;
  for (const q of en) { const a = S.globalSearch(early, q, tEn, {}), b = S.globalSearch(late, q, tEn, {}); assert.deepEqual(b, a, `en: ${q}`); if (a.length) nonEmpty++; }
  for (const q of arq) { const a = S.globalSearch(early, q, tAr, ar), b = S.globalSearch(late, q, tAr, ar); assert.deepEqual(b, a, `ar: ${q}`); if (a.length) nonEmpty++; }
  assert.ok(nonEmpty > 100, `the sample finds things (${nonEmpty})`);
  assert.ok(en.length + arq.length > 300);
});

test("palette: the near index, now made from the exact index's folded text, is the index the old code made (same items, same words, same order), English and Arabic", async () => {
  const S = await import("../lib/search");
  const { normalize } = await import("../lib/fighter-search");
  const { buildWordIndex } = await import("../lib/fuzzy");
  const ar = arTable();
  for (const table of [{}, ar] as Record<string, string>[]) {
    const x = copyOf(w), n = S.nearOf(x, table);
    const group = <T,>(items: T[], parts: (i: T) => (string | undefined | null)[]) => ({ items, vocab: buildWordIndex(items.map((i) => normalize(parts(i).filter(Boolean).join(" ")))) });
    const old = {
      people: group([...w.people.values()], (p) => [p.name, table[p.name]]),
      events: group(w.events.filter((e) => e.status !== "cancelled"), (e) => [e.name, table[e.name], e.city, table[e.city], e.venue, table[e.venue]]),
      orgs: group([...w.orgs.values()], (o) => [o.name, table[o.name]]),
    };
    for (const k of ["people", "events", "orgs"] as const) {
      assert.ok(old[k].items.length > 0, k);
      assert.deepEqual(n[k].items, old[k].items, `${k} items`);
      assert.deepEqual([...n[k].vocab], [...old[k].vocab], `${k} vocabulary`);
    }
  }
});

test("palette: a swap does not carry the near index of the old world (it is per world, and only exists once someone needed it)", async () => {
  const S = await import("../lib/search");
  const a = copyOf(w), b = copyOf(w);
  S.warmGlobalSearch(a, {});
  S.warmGlobalSearch(b, {});
  S.nearOf(a, {});
  assert.ok(registry()?.get("search.ts:near")?.get(a));
  assert.equal(registry()?.get("search.ts:near")?.get(b), undefined, "the new world holds none until its first guess");
});

test("ask: the compact name index plans every question the frozen copy of the old code plans, English and Arabic", async () => {
  const fresh = await import("../lib/ask/rules");
  const old = await import("./fixtures/ask-rules-before");
  const ar = arTable();
  const wNew = copyOf(w), wOld = copyOf(w);
  const compare = (q: string, table: Record<string, string>, label: string) => {
    const a = old.planByRules(q, wOld, table), b = fresh.planByRules(q, wNew, table);
    assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)), `${label}: ${q}`);
    const na = old.namesIn(wOld, table, q).map((x) => x.id), nb = fresh.namesIn(wNew, table, q).map((x) => x.id);
    assert.deepEqual(nb, na, `${label} names: ${q}`);
    return nb.length;
  };
  let found = 0, asked = 0;
  const boxers = w.boxers;
  boxers.forEach((b, i) => {
    const other = boxers[(i * 13 + 5) % boxers.length];
    const surname = b.name.split(" ").slice(-1)[0];
    const english = [
      `tell me about ${b.name}`, `${b.name.toLowerCase()} record`, `who is ${b.name.normalize("NFD").replace(/[̀-ͯ]/g, "")}`, `how old is ${surname}`, `${b.name} vs ${other.name}`, `compare ${typos(b.name)[1]} and ${typos(other.name)[2]}`,
      ...typos(b.name.toLowerCase()).map((n) => `what is ${n}'s record`), `who is taller, ${typos(b.name)[3]} or ${other.name}`, `${b.name.replace(/\./g, "")} reach`, `${b.name.split(" ")[0]} ${surname.replace(/-/g, "")} stats`,
    ];
    for (const q of english) { found += compare(q, {}, "en") ? 1 : 0; asked++; }
    const a = arabic(b.name), o = arabic(other.name);
    const arabicQs = [`من هو ${a}`, `سجل ${a}`, `قارن بين ${a} و${o}`, ...typos(a).map((n) => `كم عمر ${n}`), `من هو اطول ${typos(a)[2]} ام ${o}`];
    for (const q of arabicQs) { found += compare(q, ar, "ar") ? 1 : 0; asked++; }
  });
  for (const t of w.people.values()) for (const q of [`who is ${t.name}`, `fighters trained by ${t.name}`, ...typos(t.name.toLowerCase()).map((n) => `fighters trained by ${n}`)]) { compare(q, {}, "en trainer"); asked++; }
  // the look-alike names the planner must not guess between: both versions refuse the same way
  for (const q of ["tell me about Tomás Vilalba", "who is Tomas Villalbaa", "who is Marcos Quinterro", "Zhang Wei vs Wei Zhang", "who is Wei Zhng", "tell me about Wyatt G Stroud", "Yazan Al Ghamdi reach", "Niklas Kessler trainer"]) { compare(q, {}, "ties"); asked++; }
  assert.ok(asked > 3000 && found > 1500, `asked ${asked}, found a fighter in ${found}`);
});
