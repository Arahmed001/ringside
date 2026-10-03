import test from "node:test";
import assert from "node:assert/strict";
import { archetype, styleMap, styleMapSample } from "../lib/style";
import type { BoxerFull } from "../lib/types";
import type { World } from "../lib/world";

/**
 * The style map plots fighters with eight or more bouts. These leagues are ones the real world passes through: nobody has eight yet (an empty
 * map), exactly one fighter has, or several have identical styles (no spread to scale by: the middle of the square, not NaN), and ordinary ones
 * (every point inside the square, the extremes touching its edges). Plain objects stand in for fighters; only the fields the map reads are set.
 */
const fighter = (id: number, over: Partial<BoxerFull> = {}): BoxerFull => ({
  id, name: `F${id}`, slug: `f${id}`, weightClass: "Lightweight", bouts: 12, wins: 8, losses: 4, kos: 3, koLosses: 1, koRate: 3 / 8, winRate: 8 / 12, avgRounds: 8,
  age: 30, stance: "Orthodox", reachCm: 180, heightCm: 175, rating: 1500, ...over,
}) as BoxerFull;
const worldOf = (boxers: BoxerFull[]) => ({ boxers, history: new Map() }) as unknown as World;

test("nobody with eight bouts: an empty map, not a crash", () => {
  assert.deepEqual(styleMap(worldOf([])), []);
  assert.deepEqual(styleMap(worldOf([fighter(1, { bouts: 7 }), fighter(2, { bouts: 3 })])), []);
  assert.deepEqual(styleMapSample(worldOf([])), { points: [], total: 0, perStyle: 400 });
});

test("one fighter, or fighters with identical styles, sit in the middle: there is no spread to scale by", () => {
  for (const league of [[fighter(1)], [fighter(1), fighter(2)], [fighter(1), fighter(2), fighter(3)]]) {
    const pts = styleMap(worldOf(league));
    assert.equal(pts.length, league.length);
    for (const p of pts) assert.deepEqual([p.x, p.y], [0.5, 0.5]);
  }
});

test("fighters of different styles fill the square: every point inside it, the extremes on its edges, nothing NaN", () => {
  const league = [
    fighter(1, { koRate: 0.8, winRate: 0.9, avgRounds: 4, age: 24, rating: 1700, bouts: 20 }), fighter(2, { koRate: 0.1, winRate: 0.7, avgRounds: 11, age: 36, stance: "Southpaw", reachCm: 190 }),
    fighter(3, { koRate: 0.5, winRate: 0.5, avgRounds: 8, age: 29, rating: 1450, losses: 6, koLosses: 5 }), fighter(4, { koRate: 0.3, winRate: 0.3, avgRounds: 9, age: 33, rating: 1380, bouts: 30 }),
    fighter(5, { koRate: 0.6, winRate: 0.65, avgRounds: 5, age: 27, stance: "Southpaw", rating: 1600 }),
  ];
  const pts = styleMap(worldOf(league));
  assert.equal(pts.length, 5);
  for (const p of pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  for (const axis of ["x", "y"] as const) { const v = pts.map((p) => p[axis]); assert.equal(Math.min(...v), 0); assert.equal(Math.max(...v), 1); }
  assert.deepEqual(new Set(pts.map((p) => p.boxer.id)), new Set([1, 2, 3, 4, 5]));
});

test("the sample keeps the highest-rated fighters of each style, and says how many there were", () => {
  // 30 technicians (low KO rate, winning) rated 1500..1529 and three knockout artists
  const techs = Array.from({ length: 30 }, (_, i) => fighter(100 + i, { koRate: 0.2, winRate: 0.75, rating: 1500 + i }));
  const kos = [fighter(1, { koRate: 0.8, winRate: 0.9 }), fighter(2, { koRate: 0.7, winRate: 0.8 }), fighter(3, { koRate: 0.6, winRate: 0.7 })];
  const s = styleMapSample(worldOf([...techs, ...kos]), 10);
  assert.equal(s.total, 33); assert.equal(s.perStyle, 10);
  const tech = s.points.filter((p) => archetype(p.boxer) === "Technician");
  assert.equal(tech.length, 10);
  assert.deepEqual(tech.map((p) => p.boxer.rating).sort((a, b) => a - b), Array.from({ length: 10 }, (_, i) => 1520 + i), "the ten best-rated technicians");
  assert.equal(s.points.filter((p) => archetype(p.boxer) === "Knockout Artist").length, 3, "a style under the cap keeps everyone");
});
