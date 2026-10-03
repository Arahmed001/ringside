import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";

/**
 * What the scale benchmark (npm run bench) found, kept as regressions: the world cache rebuilds only when the day or the
 * data changes and never twice at once; the lookup maps and memoised aggregates agree with the plain scans they replaced;
 * the type-ahead, watchlist and style-map samplers behave; and the demo generator still produces a valid feed when scaled.
 */
const cleanup = tempDb("scale");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let worldMod: typeof import("../lib/world");
let w: World;

before(async () => {
  worldMod = await import("../lib/world");
  w = await worldMod.getWorld();
});

test("simultaneous callers share one world instead of each building their own", async () => {
  worldMod.invalidateWorld();
  const worlds = await Promise.all([worldMod.getWorld(), worldMod.getWorld(), worldMod.getWorld(), worldMod.getWorld()]);
  assert.ok(worlds.every((x) => x === worlds[0]), "four callers that arrive together must get the same object");
  w = worlds[0];
});

test("the world is reused until the day or the data changes, not on a timer", async () => {
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 3 * 3600_000; // hours later, same pinned day: still the same world
    assert.equal(await worldMod.getWorld(), w);
  } finally { Date.now = realNow; }

  process.env.RINGSIDE_NOW = "2026-10-04"; // the calendar day rolls over: upcoming/past flags and ages must be recomputed
  const next = await worldMod.getWorld();
  assert.notEqual(next, w);
  assert.equal(next.today, "2026-10-04");
  process.env.RINGSIDE_NOW = "2026-10-03";
  w = await worldMod.getWorld();
  assert.equal(w.today, "2026-10-03");
});

test("a commit from another connection (a CLI importer) makes the next call rebuild", async () => {
  const before = await worldMod.getWorld();
  const target = before.boxers[0];
  const other = new DatabaseSync(process.env.DATABASE_PATH!);
  other.prepare("UPDATE boxers SET nickname = ? WHERE id = ?").run("Rebuilt Rex", target.id);
  other.close();
  const after = await worldMod.getWorld();
  assert.notEqual(after, before);
  assert.equal(after.byId.get(target.id)!.nickname, "Rebuilt Rex");
  assert.equal(await worldMod.getWorld(), after, "and then it is stable again");
  w = after;
});

test("eventById and boutById index every row, and agree with the arrays", () => {
  assert.equal(w.eventById.size, w.events.length);
  assert.equal(w.boutById.size, w.bouts.length);
  for (const b of w.bouts.slice(0, 500)) { assert.equal(w.boutById.get(b.id), b); assert.equal(w.eventById.get(b.eventId)?.id, b.eventId); }
  const total = [...w.officialsByPerson.values()].reduce((s, l) => s + l.length, 0);
  assert.equal(total, [...w.officialsByBout.values()].reduce((s, l) => s + l.length, 0), "every assignment is indexed by bout and by person");
});

test("upcomingEvents / recentEvents match the plain filters they replaced", async () => {
  const ev = await import("../lib/events");
  const liveCount = (id: number) => ev.liveBouts(w, id).length;
  const upNaive = w.events.filter((e) => e.upcoming && liveCount(e.id) > 0).sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(ev.upcomingEvents(w).map((e) => e.id), upNaive.map((e) => e.id));
  for (const n of [1, 5, 24, 100000]) {
    const recentNaive = w.events.filter((e) => !e.upcoming && e.status !== "cancelled" && liveCount(e.id) > 0).slice(-n).reverse();
    assert.deepEqual(ev.recentEvents(w, n).map((e) => e.id), recentNaive.map((e) => e.id), `recentEvents(${n})`);
  }
  assert.ok(ev.upcomingEvents(w).length > 0 && ev.recentEvents(w, 5).length === 5);
});

test("memoised aggregates equal the straightforward scans and are computed once per world", async () => {
  const an = await import("../lib/analytics");
  const { memo } = await import("../lib/memo");
  const m = await import("../lib/methods");
  const done = w.bouts.filter((b) => !b.upcoming && m.countsInRecord(b.method));

  const wcs = an.byWeightClass(w);
  for (const row of wcs) {
    const l = done.filter((b) => b.weightClass === row.weightClass);
    assert.equal(row.bouts, l.length, row.weightClass);
    assert.equal(row.koRate, l.length ? l.filter((b) => m.isStoppage(b.method)).length / l.length : 0, row.weightClass);
  }
  for (const row of an.finishHeat(w)) {
    const fin = done.filter((b) => b.weightClass === row.weightClass && m.isStoppage(b.method) && b.endRound);
    assert.equal(row.total, fin.length, row.weightClass);
    if (fin.length) assert.ok(Math.abs(row.cells.reduce((s, v) => s + v, 0) - 1) < 1e-9);
  }
  assert.equal(an.overview(w).bouts, done.length);
  assert.equal(Object.values(an.methodSplit(w)).reduce((s, v) => s + v, 0), done.length);

  // `since` restricts the upsets to recent bouts: the home page used to copy the whole league to do this
  const recent = an.biggestUpsets(w, 5, "2025-10-01");
  assert.ok(recent.length > 0 && recent.every((u) => u.bout.date >= "2025-10-01"));
  assert.ok(an.biggestUpsets(w, 5)[0].gap >= recent[0].gap);

  assert.equal(an.overview(w), an.overview(w), "second call returns the cached object");
  let calls = 0;
  memo(w, "probe", () => ++calls); memo(w, "probe", () => ++calls);
  assert.equal(calls, 1);
  let other = 0;
  memo({} as World, "probe", () => ++other);
  assert.equal(other, 1, "a different world has its own cache");
});

test("division weigh-in stats from one pass equal the per-division filters they replaced", async () => {
  const { divisionWeights } = await import("../lib/weights");
  const { DIVISIONS } = await import("../lib/divisions");
  const all: { wi: (typeof w.weighInsByBout extends Map<number, (infer V)[]> ? V : never); division: string }[] = [];
  for (const list of w.weighInsByBout.values()) for (const wi of list) { const b = w.boutById.get(wi.boutId); if (b && !b.upcoming) all.push({ wi, division: b.weightClass }); }
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const expected = DIVISIONS.map((d) => {
    const r = all.filter((x) => x.division === d.name && x.wi.officialLb !== null);
    const made = r.filter((x) => x.wi.madeWeight !== false);
    return {
      division: d.name, limitLb: d.lb, n: r.length,
      missRate: d.lb !== null && r.length ? r.filter((x) => x.wi.madeWeight === false).length / r.length : 0,
      avgUnderLimit: mean(d.lb !== null ? made.filter((x) => x.wi.limitLb !== null).map((x) => x.wi.limitLb! - x.wi.officialLb!) : []),
      avgGain: mean(r.filter((x) => x.wi.fightNightLb !== null).map((x) => x.wi.fightNightLb! - x.wi.officialLb!)),
      avgFightNight: mean(r.filter((x) => x.wi.fightNightLb !== null).map((x) => x.wi.fightNightLb!)),
    };
  });
  assert.ok(expected.some((e) => e.n > 0 && e.missRate > 0), "the demo has misses to compare, or this proves nothing");
  assert.deepEqual(divisionWeights(w), expected);
});

test("the organisations index picks the same cards as computing stats for every organisation first", async () => {
  const tm = await import("../lib/team");
  const ofKind = (k: string) => [...w.orgs.values()].filter((o) => o.kind === k);
  const gymsNaive = ofKind("gym").map((o) => ({ o, s: tm.orgStable(w, o.id, ["gym"]) })).sort((a, b) => b.s.currentFighters - a.s.currentFighters);
  const promosNaive = ofKind("promotion")
    .map((o) => ({ o, s: tm.orgStable(w, o.id, ["promoter"]), events: w.events.filter((e) => e.promoterOrgId === o.id && !e.upcoming).length }))
    .sort((a, b) => b.events - a.events);
  for (const top of [5, 36]) {
    const idx = tm.orgsIndex(w, top);
    assert.deepEqual(idx.gyms.map((g) => g.o.id), gymsNaive.slice(0, top).map((g) => g.o.id), `top ${top} gyms`);
    assert.deepEqual(idx.promos.map((p) => p.o.id), promosNaive.slice(0, top).map((p) => p.o.id), `top ${top} promotions`);
    assert.deepEqual(idx.gyms.map((g) => g.s.currentFighters), gymsNaive.slice(0, top).map((g) => g.s.currentFighters));
    assert.deepEqual(idx.promos.map((p) => p.events), promosNaive.slice(0, top).map((p) => p.events));
    assert.equal(idx.gymTotal, gymsNaive.length); assert.equal(idx.promoTotal, promosNaive.length);
  }
  assert.equal(tm.orgsIndex(w, 36), tm.orgsIndex(w, 36), "cached per world");
});

test("fighter type-ahead: prefix first, accents ignored, minimum bouts respected, limit applied", async () => {
  const { searchFighters, resolveFighter, normalize } = await import("../lib/fighter-search");
  assert.equal(normalize("  José   RAMÍREZ "), "jose ramirez");
  const star = [...w.boxers].sort((a, b) => b.bouts - a.bouts)[0];
  const first = star.name.split(" ")[0].toLowerCase();
  const hits = searchFighters(w, first.slice(0, 4), { limit: 8 });
  assert.ok(hits.length > 0 && hits.length <= 8);
  assert.ok(hits.every((h) => h.name.toLowerCase().includes(first.slice(0, 4)) || (h.nickname ?? "").toLowerCase().includes(first.slice(0, 4)) || h.aliases.some((a) => a.toLowerCase().includes(first.slice(0, 4)))));
  const prefix = hits.filter((h) => h.name.toLowerCase().startsWith(first.slice(0, 4)));
  assert.deepEqual(hits.slice(0, prefix.length).map((h) => h.id), prefix.map((h) => h.id), "names that start with the query come before the rest");
  // a query that matches some names at the start and others only at a later word ("mar": Marcus Reyes, Luis Martinez)
  let mixed: string | undefined;
  for (const b of w.boxers) {
    const q = b.name.split(" ")[0].toLowerCase().slice(0, 3);
    const found = searchFighters(w, q, { limit: 100 });
    const starts = found.filter((h) => h.name.toLowerCase().startsWith(q)).length;
    if (starts > 0 && starts < found.length && found.length < 100) { mixed = q; break; }
  }
  assert.ok(mixed, "the demo league has names that collide this way, or this check proves nothing");
  const mixedHits = searchFighters(w, mixed!, { limit: 100 });
  const firstOther = mixedHits.findIndex((h) => !h.name.toLowerCase().startsWith(mixed!));
  assert.ok(mixedHits.slice(firstOther).every((h) => !h.name.toLowerCase().startsWith(mixed!)), `"${mixed}": every name that starts with it is listed before any that merely contains it`);
  assert.equal(searchFighters(w, star.name.toUpperCase(), { limit: 1 })[0].id, star.id, "full name, any case");
  assert.deepEqual(searchFighters(w, "", {}), []);
  assert.ok(searchFighters(w, first.slice(0, 3), { limit: 50, minBouts: 5 }).every((h) => h.bouts >= 5));
  assert.equal(resolveFighter(w, star.slug, undefined)?.id, star.id, "a slug wins");
  assert.equal(resolveFighter(w, undefined, star.name)?.id, star.id, "a typed name resolves when there is no slug (no-JavaScript fallback)");
  assert.equal(resolveFighter(w, "no-such-slug", star.name), undefined, "an unknown slug is not silently replaced by the typed text");
  assert.equal(resolveFighter(w, undefined, "zzzzqqqq"), undefined);
});

test("/api/fighters and /api/watch answer with small, bounded payloads", async () => {
  const fighters = await import("../app/api/fighters/route");
  const watch = await import("../app/api/watch/route");
  const star = [...w.boxers].sort((a, b) => b.bouts - a.bouts)[0];

  const hits = await (await fighters.GET(new Request(`http://x/api/fighters?q=${encodeURIComponent(star.name.slice(0, 3))}&min=5`))).json();
  assert.ok(Array.isArray(hits) && hits.length > 0 && hits.length <= 8);
  assert.deepEqual(Object.keys(hits[0]).sort(), ["country", "division", "name", "record", "slug"]);
  assert.deepEqual(await (await fighters.GET(new Request("http://x/api/fighters?q=a"))).json(), [], "one letter is too short to search");

  const rows = await (await watch.GET(new Request(`http://x/api/watch?slugs=${star.slug},${star.slug},nobody-here`))).json();
  assert.equal(rows.length, 1, "unknown slugs are skipped and duplicates collapse");
  assert.equal(rows[0].name, star.name);
  assert.deepEqual(await (await watch.GET(new Request("http://x/api/watch"))).json(), []);
  const many = Array.from({ length: 500 }, (_, i) => `x${i}`).join(",");
  assert.deepEqual(await (await watch.GET(new Request(`http://x/api/watch?slugs=${many}`))).json(), [], "a huge list is capped, not looked up one by one forever");
});

test("the style map sends a capped sample, highest rated first, and says how many it dropped", async () => {
  const { styleMap, styleMapSample } = await import("../lib/style");
  const all = styleMap(w);
  const untouched = styleMapSample(w, 100000);
  assert.equal(untouched.points.length, all.length, "under the cap nothing is dropped (the demo league)");
  const capped = styleMapSample(w, 20);
  assert.equal(capped.total, all.length);
  const perStyle = new Map<string, number>();
  for (const p of capped.points) perStyle.set(p.arch, (perStyle.get(p.arch) ?? 0) + 1);
  assert.ok([...perStyle.values()].every((n) => n <= 20));
  for (const [arch, n] of perStyle) {
    const kept = capped.points.filter((p) => p.arch === arch).map((p) => p.boxer.rating);
    const universe = all.filter((p) => p.arch === arch).map((p) => p.boxer.rating).sort((a, b) => b - a);
    assert.deepEqual(kept.sort((a, b) => b - a), universe.slice(0, n), `${arch}: the kept points are the top ${n} by rating`);
  }
});

test("a scaled demo league is still a valid feed with unique names, even when the plain name pools run out", async () => {
  const { demoProvider } = await import("../lib/providers/demo");
  const { sanitizeFeed } = await import("../lib/validate");
  const feedOf = async (scale: number) => {
    const p = demoProvider(new Date("2026-10-03T12:00:00Z"), { scale });
    const [boxers, events, bouts, people, orgs, stints, weighIns, officials, scorecards, corners, punches, financials, purses, broadcasts, earnings] = await Promise.all([
      p.fetchBoxers(), p.fetchEvents(), p.fetchBouts(), p.fetchPeople!(), p.fetchOrgs!(), p.fetchStints!(), p.fetchWeighIns!(), p.fetchOfficials!(), p.fetchScorecards!(), p.fetchCorners!(), p.fetchPunchStats!(), p.fetchFinancials!(), p.fetchPurses!(), p.fetchBroadcasts!(), p.fetchEarnings!(),
    ]);
    return { boxers, events, bouts, people, orgs, stints, weighIns, officials, scorecards, corners, punches, financials, purses, broadcasts, earnings };
  };
  const one = await feedOf(1), three = await feedOf(3);
  assert.ok(three.boxers.length >= one.boxers.length * 2.5, "scale 3 is about three times the league");
  assert.ok(three.bouts.length >= one.bouts.length * 2.5);
  const gyms = three.orgs.filter((o) => o.kind === "gym");
  assert.equal(new Set(gyms.map((g) => g.name)).size, gyms.length, "no two gyms share a name (192 gyms from 96 plain combinations)");
  assert.equal(new Set(three.boxers.map((b) => b.name)).size, three.boxers.length, "no two fighters share a name");
  const { issues, dropped } = sanitizeFeed(three, { today: "2026-10-03" });
  const errors = issues.filter((i) => i.severity === "error");
  assert.equal(errors.length, 0, `scaled feed has validation errors: ${JSON.stringify(errors.slice(0, 3))}`);
  assert.deepEqual(Object.values(dropped).filter((n) => n > 0), [], "nothing is dropped");
});

test("start-up warm-up builds the shared world and never throws; the daily refresh lands just after UTC midnight", async () => {
  const warm = await import("../lib/warm");
  worldMod.invalidateWorld();
  const lines: string[] = [];
  await warm.warmWorld((m) => lines.push(m));
  assert.match(lines[0], /world ready in \d+ ms: \d+ fighters, \d+ bouts/);
  const built = await worldMod.getWorld();
  await warm.warmWorld(() => {});
  assert.equal(await worldMod.getWorld(), built, "warming an up-to-date world must not rebuild it");

  const DAY = 86_400_000, t0 = Date.parse("2026-10-03T23:59:00Z");
  assert.equal(warm.msUntilNextDay(t0), 60_000 + 5_000, "one minute to midnight plus the slack");
  assert.equal(warm.msUntilNextDay(Date.parse("2026-10-04T00:00:00Z")), DAY + 5_000, "exactly at midnight the next one is a day away");
  assert.ok(warm.msUntilNextDay(Date.now()) > 5_000 && warm.msUntilNextDay(Date.now()) <= DAY + 5_000);

  // a failing build is logged, not thrown, so the server still starts and the first request retries
  const db = await (await import("../lib/db")).getDb();
  worldMod.invalidateWorld();
  db.exec("ALTER TABLE honours RENAME TO honours_off");
  const bad: string[] = [];
  try { await warm.warmWorld((m) => bad.push(m)); } finally { db.exec("ALTER TABLE honours_off RENAME TO honours"); worldMod.invalidateWorld(); }
  assert.match(bad[0], /warm-up failed/);
  assert.ok((await worldMod.getWorld()).boxers.length > 0, "and the world builds once the problem is gone");
});
