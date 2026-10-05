import test from "node:test";
import assert from "node:assert/strict";
import { degradeWorld, makeWorld } from "../lib/vendor-mock";

/** `degradeWorld` lays the first real fetch's faults over a clean league (round 77): the load-day paths need a vendor that does not always add up. */
const league = () => makeWorld({ fighters: 120, fights: 400, years: 5, seed: 9, upcoming: 0 });
const results = (w: ReturnType<typeof makeWorld>) => [...w.careers.values()].reduce((n, c) => n + c.wins + c.losses + c.draws, 0);
const undecided = (w: ReturnType<typeof makeWorld>) => w.fights.filter((f) => f.status === "FINISHED" && f.winner === null && f.outcome === "UD").length;

test("each fault changes the league in its own way: unrecorded fights leave the vendor's totals, duplicates do not change them, prior careers add to them", () => {
  const base = results(league()), baseUndecided = undecided(league());
  const un = degradeWorld(league(), { seed: 1, unrecorded: 10 });
  assert.equal(results(un), base - 20, "ten fights, two results each, left out of the vendor's totals");
  assert.equal(undecided(un), baseUndecided + 10, "and they now show no winner with a decision outcome");
  const dup = degradeWorld(league(), { seed: 1, duplicates: 6 });
  assert.equal(dup.fights.length, 406); assert.equal(results(dup), base, "the vendor counts a duplicated fight once");
  const copies = dup.fights.filter((f) => f.id.startsWith("d"));
  assert.equal(copies.length, 6);
  assert.ok(copies.every((c) => dup.fights.some((o) => o.id !== c.id && o.event === c.event && o.a === c.a && o.b === c.b && o.winner === c.winner)), "each copy has its original: same pair, same card, same result");
  const prior = degradeWorld(league(), { seed: 1, priorShare: 0.3 });
  assert.ok(results(prior) > base + 100, `earlier careers added (${results(prior)} against ${base})`);
  assert.equal(prior.fights.length, 400);
  assert.deepEqual([...degradeWorld(league(), { seed: 1, priorShare: 0.3 }).careers], [...prior.careers], "deterministic for a seed");
  assert.equal(results(degradeWorld(league(), {})), base, "no options, no change");
});
