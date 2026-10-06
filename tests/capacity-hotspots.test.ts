import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { tEn } from "../lib/i18n/t";
import { DIVISIONS } from "../lib/divisions";

/**
 * docs/capacity.md: the two things a fighter page recomputed for the whole league on every view (the nearest styles, and the opponents to suggest)
 * now share work between views. These tests keep the old algorithms here, written out plainly, and require the new code to give exactly the same answers,
 * ties included, for a spread of fighters.
 */
const cleanup = tempDb("capacity-hotspots");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let S: typeof import("../lib/style");
let M: typeof import("../lib/matchmaking");
let P: typeof import("../lib/predict");
before(async () => { w = await (await import("../lib/world")).getWorld(); S = await import("../lib/style"); M = await import("../lib/matchmaking"); P = await import("../lib/predict"); });

/** a spread of fighters: the busiest, the idlest, and every so often in between, so ties and thin careers are both in */
const sample = () => [...w.boxers].sort((a, b) => a.id - b.id).filter((_, i) => i % 37 === 0).slice(0, 30);

test("similarTo returns what sorting every fighter by distance returned, for any n", () => {
  const dist = (x: number[], y: number[]) => Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0));
  const old = (b: (typeof w.boxers)[number], n: number) => {
    const vb = S.vector(b, w);
    return w.boxers.filter((o) => o.id !== b.id && o.bouts >= 5).map((o) => ({ boxer: o, d: dist(vb, S.vector(o, w)) })).sort((x, y) => x.d - y.d).slice(0, n).map((x) => ({ boxer: x.boxer, match: Math.max(0, Math.round(100 - x.d * 38)) }));
  };
  let compared = 0;
  for (const b of sample()) for (const n of [0, 1, 4, 5, 60]) {
    const got = S.similarTo(b, w, n), want = old(b, n);
    assert.deepEqual(got.map((x) => [x.boxer.id, x.match]), want.map((x) => [x.boxer.id, x.match]), `${b.name}, n=${n}`);
    compared++;
  }
  assert.ok(compared >= 100);
});

test("similarTo never offers the fighter themselves, and takes the same pool after being called twice", () => {
  const b = sample()[3];
  const a1 = S.similarTo(b, w, 10), a2 = S.similarTo(b, w, 10);
  assert.deepEqual(a1.map((x) => x.boxer.id), a2.map((x) => x.boxer.id));
  assert.ok(a1.every((x) => x.boxer.id !== b.id));
});

test("suggestOpponents returns what scoring and sorting a full pairing for every candidate returned", () => {
  const di = new Map(DIVISIONS.map((d, i) => [d.name, i]));
  const gym = (id: number) => (w.stintsByBoxer.get(id) ?? []).find((s) => s.role === "gym" && s.end === null)?.orgId ?? null;
  const booked = (id: number) => (w.boutsByBoxer.get(id) ?? []).some((x) => x.upcoming && x.status !== "cancelled");
  const old = (boxer: (typeof w.boxers)[number], n: number) => {
    const g = gym(boxer.id), mine = di.get(boxer.weightClass) ?? 0, out: ReturnType<typeof M.pairing>[] = [];
    for (const c of w.boxers) {
      if (c.id === boxer.id || c.sex !== boxer.sex || !c.active || c.bouts < 4 || booked(c.id)) continue;
      if (Math.abs((di.get(c.weightClass) ?? -9) - mine) > 1) continue;
      if (g !== null && gym(c.id) === g) continue;
      if (Math.abs(c.rating - boxer.rating) > 260) continue;
      out.push(M.pairing(w, boxer, c, tEn, { subjectIsA: true }));
    }
    return out.sort((x, y) => y.score - x.score || y.b.rating - x.b.rating).slice(0, n);
  };
  let withSuggestions = 0;
  const actives = [...w.boxers].filter((b) => b.active && b.bouts >= 4).sort((a, b) => a.id - b.id).filter((_, i) => i % 11 === 0).slice(0, 25);
  for (const b of actives) for (const n of [3, 6, 25]) {
    const got = M.suggestOpponents(w, b, n, tEn), want = old(b, n);
    assert.deepEqual(got, want, `${b.name}, n=${n}`);
    if (got.length) withSuggestions++;
  }
  assert.ok(withSuggestions >= 30, `only ${withSuggestions} comparisons had suggestions`);
});

test("winChances is the win probability of predict, to the last digit", () => {
  const xs = sample();
  for (let i = 0; i + 1 < xs.length; i++) {
    const p = P.predict(xs[i], xs[i + 1]), c = P.winChances(P.featuresOf(xs[i]), P.featuresOf(xs[i + 1]));
    assert.equal(c.pA, p.pA);
    assert.equal(c.pB, p.pB);
  }
});

test("similarTo keeps league order among equally near fighters (a stable sort did), on a league where many are identical", () => {
  const f = (id: number, rating: number) => ({ id, name: `F${id}`, bouts: 12, wins: 8, losses: 4, kos: 3, koLosses: 1, koRate: 3 / 8, winRate: 8 / 12, avgRounds: 8, age: 30, stance: "Orthodox", reachCm: 180, heightCm: 175, rating }) as unknown as World["boxers"][number];
  // ratings repeat in a pattern, so there are ties at several distances; the first fighter's twins come after it in the list
  const boxers = Array.from({ length: 40 }, (_, i) => f(i + 1, 1500 + (i % 4) * 50));
  const fake = { boxers, history: new Map() } as unknown as World;
  const dist = (x: number[], y: number[]) => Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0));
  for (const b of [boxers[0], boxers[5], boxers[22]]) for (const n of [1, 3, 9, 12, 100]) {
    const want = boxers.filter((o) => o.id !== b.id).map((o) => ({ id: o.id, d: dist(S.vector(b, fake), S.vector(o, fake)) })).sort((x, y) => x.d - y.d).slice(0, n).map((x) => x.id);
    assert.deepEqual(S.similarTo(b, fake, n).map((x) => x.boxer.id), want, `${b.id}, n=${n}`);
  }
});
