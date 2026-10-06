import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/** docs/capacity.md: a country page used to scan every event and every bout on each view; the per-world lists must give the same answers. */
const cleanup = tempDb("capacity-countries");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let C: typeof import("../lib/countries");
before(async () => { w = await (await import("../lib/world")).getWorld(); C = await import("../lib/countries"); });

test("a country page's events and coming fights are what scanning every event and bout gave, for every country and any limit", () => {
  const slugs = C.countryList(w).map((c) => c.slug);
  assert.ok(slugs.length >= 5);
  const of = new Map(w.boxers.filter((b) => b.country).map((b) => [b.id, C.countrySlug(b.country)] as const));
  let withEvents = 0, withNext = 0;
  for (const slug of slugs) for (const limits of [{ top: 12, next: 8, events: 6 }, { top: 3, next: 100, events: 1000 }]) {
    const v = C.countryView(w, slug, limits)!;
    const here = (id: number) => of.get(id) === slug;
    const next = w.bouts.filter((b) => b.upcoming && b.status !== "cancelled" && (here(b.redId) || here(b.blueId))).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id)).slice(0, limits.next);
    const held = w.events.filter((e) => !!e.country && C.countrySlug(e.country) === slug && e.status !== "cancelled" && !e.upcoming).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
    assert.deepEqual(v.next.map((b) => b.id), next.map((b) => b.id), `${slug}: next`);
    assert.deepEqual(v.events.map((e) => e.id), held.slice(0, limits.events).map((e) => e.id), `${slug}: events`);
    assert.equal(v.eventCount, held.length, `${slug}: count`);
    if (held.length) withEvents++;
    if (next.length) withNext++;
  }
  assert.ok(withEvents > 0 && withNext > 0, "the demo league has events and coming fights in some country");
});

test("what a country page returns can be changed by the caller without changing the next view", () => {
  const slug = C.countryList(w)[0].slug;
  const first = C.countryView(w, slug, { top: 0, next: 0, events: 5 })!;
  const n = first.events.length;
  first.events.pop();
  assert.equal(C.countryView(w, slug, { top: 0, next: 0, events: 5 })!.events.length, n);
});
