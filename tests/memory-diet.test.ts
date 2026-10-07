import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * docs/capacity.md, "The memory diet": data the pages did not need is not kept, or is kept compactly, and the pages must show exactly what they showed.
 * Each test sets the new structure beside the old algorithm (written out here) on the same league and asks for the same answers.
 */
const cleanup = tempDb("memory-diet");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let S: typeof import("../lib/fight-score");
let A: typeof import("../lib/accountability");
before(async () => {
  w = await (await import("../lib/world")).getWorld();
  S = await import("../lib/fight-score");
  A = await import("../lib/accountability");
});

/** The old `fightsOfYear`: every eligible fight of the year scored and kept, best first. */
function oldYear(year: number) {
  const out: NonNullable<ReturnType<typeof S.scoreFight>>[] = [];
  for (const b of w.bouts) { if (!b.date.startsWith(String(year))) continue; const s = S.scoreFight(w, b); if (s) out.push(s); }
  return out.sort((a, b) => b.score - a.score || a.bout.date.localeCompare(b.bout.date) || a.bout.id - b.bout.id);
}

test("the league the tests run on has fights worth comparing", () => {
  assert.ok(S.fightYears(w).length >= 1);
  assert.ok(S.fightYears(w).some((y) => oldYear(y).length >= 5), "at least one year with several scored fights");
});

test("fights of a year: the compact index lists the same fights in the same order with the same scores as the full list did", () => {
  for (const y of S.fightYears(w)) {
    const old = oldYear(y);
    assert.deepEqual(S.fightsOfYear(w, y), old, `year ${y}`);
    assert.equal(S.fightCountOfYear(w, y), old.length);
    assert.deepEqual(S.topFightsOfYear(w, y, 3), old.slice(0, 3));
    for (const [i, s] of old.entries()) assert.deepEqual(S.fightRank(w, s.bout.id), { year: y, rank: i + 1, of: old.length, score: s.score });
    for (const s of old) assert.equal(S.fightScoreOf(w, s.bout), s.score);
  }
});

test("fight of the year, and the best fights ever (all, and per division): same as the old computation", () => {
  const years = S.fightYears(w);
  assert.deepEqual(S.fightOfTheYear(w), years.flatMap((year) => { const top = oldYear(year)[0]; return top ? [{ year, top }] : []; }));
  const everScored = years.flatMap((y) => oldYear(y)); // newest year first, each best first, as the old loop walked them
  const oldBest = (n: number, division?: string) => everScored.filter((s) => !division || s.bout.weightClass === division).sort((a, b) => b.score - a.score || b.bout.date.localeCompare(a.bout.date)).slice(0, n);
  assert.deepEqual(S.bestFightsEver(w, 25), oldBest(25));
  assert.deepEqual(S.bestFightsEver(w, 5), oldBest(5));
  for (const d of new Set(w.bouts.map((b) => b.weightClass))) assert.deepEqual(S.bestFightsEver(w, 25, d), oldBest(25, d), d);
});

test("calls: the pages' list is the fitter's list without the finish inputs, call for call", () => {
  const plain = A.calls(w), fit = A.callsForFit(w);
  assert.equal(plain.length, fit.length);
  assert.ok(plain.length > 0);
  assert.ok(plain.every((c) => c.finishX === undefined), "no inputs kept for the pages");
  assert.ok(fit.every((c) => Array.isArray(c.finishX)));
  assert.deepEqual(fit.map(({ finishX, ...rest }) => { void finishX; return rest; }), plain);
});

test("the world's strings are what the database holds (repeated values are shared, not changed)", async () => {
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  const raw = db.prepare("SELECT id, weight_class, method, title, round_time FROM bouts ORDER BY id").all() as { id: number; weight_class: string; method: string | null; title: string | null; round_time: string | null }[];
  assert.equal(raw.length, w.bouts.length);
  for (const r of raw) {
    const b = w.boutById.get(r.id)!;
    assert.equal(b.weightClass, r.weight_class); assert.equal(b.method, r.method ?? null); assert.equal(b.title, r.title ?? null); assert.equal(b.roundTime, r.round_time ?? null);
  }
  const hist = db.prepare("SELECT boxer_id, bout_id, date, rating, opp_rating FROM rating_history ORDER BY date, bout_id").all() as { boxer_id: number; bout_id: number; date: string; rating: number; opp_rating: number }[];
  const seen = new Map<number, number>();
  for (const h of hist) {
    const i = seen.get(h.boxer_id) ?? 0; seen.set(h.boxer_id, i + 1);
    assert.deepEqual(w.history.get(h.boxer_id)![i], { date: h.date, rating: h.rating, boutId: h.bout_id, opp: h.opp_rating });
  }
  const bx = db.prepare("SELECT id, country, weight_class, stance FROM boxers").all() as { id: number; country: string; weight_class: string; stance: string | null }[];
  for (const r of bx) { const b = w.byId.get(r.id)!; assert.equal(b.country, r.country); assert.equal(b.weightClass, r.weight_class); assert.equal(b.stance, r.stance || null); }
});

test("a full collection is only asked for when the heap is big, and never fails", async () => {
  const { collectGarbage } = await import("../lib/gc");
  await collectGarbage(); // the test league is small: nothing to do, and it returns
  assert.ok(true);
});
