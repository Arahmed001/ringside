import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * The palette's exact match reads an index of each person, event and organisation's folded text, built once per world and table of translated names. It must
 * give exactly what folding every name on every keystroke gave: these tests compare it with that plain version over many queries, and check the index is shared.
 */
const cleanup = tempDb("search-exact");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let ar: Record<string, string>;
let S: typeof import("../lib/search");
let normalize: (s: string) => string;
let tEn: typeof import("../lib/i18n/t").tEn;
before(async () => {
  w = await (await import("../lib/world")).getWorld();
  ar = await (await import("../lib/i18n/names")).getNames("ar");
  S = await import("../lib/search");
  normalize = (await import("../lib/fighter-search")).normalize;
  tEn = (await import("../lib/i18n/t")).tEn;
});

/** The plain version: fold every name for every query, as the palette did before the index. */
function plain(query: string, names: Record<string, string>, perGroup = 5) {
  const q = normalize(query), words = q.split(" ");
  const match = (...parts: (string | undefined | null)[]) => { const hay = normalize(parts.filter(Boolean).join(" ")); return words.every((x) => hay.includes(x)) ? (hay.startsWith(q) ? 0 : 1) : -1; };
  const people = [...w.people.values()].map((p) => ({ p, r: match(p.name, names[p.name]) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name)).slice(0, perGroup).map((x) => `/people/${x.p.slug}`);
  const events: { e: (typeof w.events)[number]; r: number }[] = [];
  for (let i = w.events.length - 1; i >= 0 && events.length < perGroup; i--) {
    const e = w.events[i];
    const r = match(e.name, names[e.name], e.city, names[e.city], e.venue, names[e.venue]);
    if (r >= 0 && e.status !== "cancelled") events.push({ e, r });
  }
  const evs = events.sort((a, b) => a.r - b.r).map((x) => `/events/${x.e.id}`);
  const orgs = [...w.orgs.values()].map((o) => ({ o, r: match(o.name, names[o.name]) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r || a.o.name.localeCompare(b.o.name)).slice(0, perGroup).map((x) => `/orgs/${x.o.slug}`);
  return { people, events: evs, orgs };
}
const hits = (query: string, names: Record<string, string>) => {
  const out = S.globalSearch(w, query, tEn, names);
  const of = (kind: string) => out.filter((h) => h.kind === kind).map((h) => h.href);
  return { people: of("person"), events: of("event"), orgs: of("org") };
};

function queries(): string[] {
  const people = [...w.people.values()], events = w.events, orgs = [...w.orgs.values()];
  const qs: string[] = [];
  for (const p of people.slice(0, 40)) { const [a, ...rest] = p.name.split(" "); qs.push(p.name, a, rest.join(" "), a.slice(0, 3), p.name.toUpperCase(), ` ${p.name} `); }
  for (const e of events.filter((_, i) => i % 40 === 0).slice(0, 40)) { qs.push(e.name, e.city, e.venue, e.name.split(" ")[0], `${e.city} ${e.name.split(" ")[0]}`); }
  for (const o of orgs.slice(0, 30)) qs.push(o.name, o.name.split(" ")[0], o.name.slice(-4));
  qs.push("ga", "xx", "zzzq", "boxing", "night", "la", "san", "é", "jose", "of");
  return qs.filter((x) => x.trim().length >= 2);
}

test("with no translated names, the indexed match gives the same people, events and organisations as folding every name for every query", () => {
  const qs = queries();
  assert.ok(qs.length > 300);
  let nonEmpty = 0;
  for (const q of qs) {
    const want = plain(q, {}), got = hits(q, {});
    assert.deepEqual(got, want, `query "${q}"`);
    if (want.people.length + want.events.length + want.orgs.length) nonEmpty++;
  }
  assert.ok(nonEmpty > 200, "most of the queries find something, or this proves little");
});

test("with the Arabic names, the same: Arabic queries and English ones find what the plain version finds", () => {
  const arOf = (names: string[]) => names.map((n) => ar[n]).filter(Boolean).flatMap((n) => [n, n.split(" ")[0], n.slice(0, 4)]);
  const arQs = [...arOf([...w.people.values()].slice(0, 60).map((p) => p.name)), ...arOf([...w.orgs.values()].slice(0, 40).map((o) => o.name)), ...arOf(w.events.filter((_, i) => i % 30 === 0).flatMap((e) => [e.name, e.city, e.venue]))];
  assert.ok(arQs.length > 50, "the demo league has Arabic names");
  const kinds = new Set(arQs.flatMap((q) => Object.entries(hits(q, ar)).filter(([, v]) => v.length).map(([k]) => k)));
  assert.deepEqual([...kinds].sort(), ["events", "orgs", "people"], "Arabic queries find people, events and organisations, or the comparison proves nothing for some kind");
  for (const q of [...arQs, ...queries().slice(0, 80)]) assert.deepEqual(hits(q, ar), plain(q, ar), `query "${q}"`);
});

test("the index is built once per world and table: the same table gives the same index, an empty table is always one table, another table is another index", () => {
  const a = S.exactOf(w, ar);
  assert.equal(S.exactOf(w, ar), a);
  assert.equal(S.exactOf(w, {}), S.exactOf(w, {}), "a fresh empty object each time is still one table");
  assert.notEqual(S.exactOf(w, {}), a);
  assert.equal(a.people.length, w.people.size);
  assert.equal(a.orgs.length, w.orgs.size);
  assert.equal(a.events.length, w.events.filter((e) => e.status !== "cancelled").length, "called-off events are left out");
  assert.ok(a.events.length < 2 || a.events[0].e.date >= a.events[a.events.length - 1].e.date, "newest first");
  // the index is folded text: nothing in it is searched in its original spelling
  assert.ok(a.people.every((x) => x.hay === normalize(x.hay)));
});
