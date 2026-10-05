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

test("round 78 faults: wrong totals lower the vendor's wins (and are named), disagreeing duplicates are the same fight a day later with the other winner", () => {
  const base = results(league());
  const wrong = degradeWorld(league(), { seed: 2, wrongTotals: 5 });
  assert.equal(wrong.faults?.wrongTotals.length, 5); assert.equal(results(wrong), base - 5);
  const dis = degradeWorld(league(), { seed: 2, disagree: 4 });
  const copies = dis.fights.filter((f) => f.id.startsWith("g"));
  assert.equal(copies.length, 4); assert.equal(results(dis), base, "the vendor counts the original once");
  for (const c of copies) {
    const o = dis.fights.find((f) => f.a === c.a && f.b === c.b && !f.id.startsWith("g") && Date.parse(c.date) - Date.parse(f.date) === 86_400_000);
    assert.ok(o && o.winner !== null && o.winner !== c.winner, "the same fight a day earlier, with the other winner");
  }
});

test("round 82 fault: reversed winners change the fight list and leave the vendor's totals alone", () => {
  const clean = league(), w = degradeWorld(league(), { seed: 2, reversed: 7 });
  const changed = w.fights.filter((f, i) => f.winner !== clean.fights[i].winner);
  assert.equal(changed.length, 7); assert.ok(changed.every((f) => f.winner !== null && clean.fights.find((c) => c.id === f.id)!.winner !== null));
  assert.deepEqual([...w.careers], [...clean.careers], "the totals are the truth");
});
