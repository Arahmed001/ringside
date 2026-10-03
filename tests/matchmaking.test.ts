import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { tEn } from "../lib/i18n/t";

const cleanup = tempDb("matchmaking");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let M: typeof import("../lib/matchmaking");
let D: typeof import("../lib/divisions");
before(async () => { w = await (await import("../lib/world")).getWorld(); M = await import("../lib/matchmaking"); D = await import("../lib/divisions"); });

const booked = (id: number) => (w.boutsByBoxer.get(id) ?? []).some((b) => b.upcoming && b.status !== "cancelled");
const gymOf = (id: number) => (w.stintsByBoxer.get(id) ?? []).find((s) => s.role === "gym" && s.end === null)?.orgId ?? null;
const star = () => [...w.boxers].filter((b) => b.active && b.bouts >= 10).sort((a, b) => b.rating - a.rating)[8];

test("a pairing's score is 0-100, built from six parts in 0-1 that the weights add up over", () => {
  const sum = Object.values(M.WEIGHTS).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, "weights sum to 1");
  const s = star();
  for (const p of M.suggestOpponents(w, s, 20)) {
    assert.ok(p.score >= 0 && p.score <= 100 && Number.isInteger(p.score));
    for (const v of Object.values(p.parts)) assert.ok(v >= 0 && v <= 1);
    const expected = Math.round(100 * (Object.keys(M.WEIGHTS) as (keyof typeof M.WEIGHTS)[]).reduce((t, k) => t + M.WEIGHTS[k] * p.parts[k], 0));
    assert.equal(p.score, expected);
    assert.ok(Math.abs(p.pA + p.pB + p.pDraw - 1) < 1e-6);
    assert.ok(p.reasons.length > 0 && p.reasons.every((r) => !/\{\w+\}/.test(r)), "reasons are filled-in sentences");
  }
});

test("opponent suggestions only offer fighters who could actually be booked", () => {
  const s = star();
  const di = D.DIVISIONS.findIndex((d) => d.name === s.weightClass);
  const out = M.suggestOpponents(w, s, 50);
  assert.ok(out.length > 0);
  for (const p of out) {
    const c = p.b;
    assert.notEqual(c.id, s.id);
    assert.equal(c.sex, s.sex, "men fight men, women fight women");
    assert.ok(c.active, "not retired");
    assert.ok(!booked(c.id), "not already booked");
    assert.ok(c.bouts >= 4);
    assert.ok(Math.abs(D.DIVISIONS.findIndex((d) => d.name === c.weightClass) - di) <= 1, "the same division or one either side");
    assert.ok(Math.abs(c.rating - s.rating) <= 260, "a fight nobody would sign is not suggested");
    const g = gymOf(s.id);
    assert.ok(g === null || gymOf(c.id) !== g, "not a training partner");
  }
  assert.deepEqual(out.map((p) => p.score), [...out.map((p) => p.score)].sort((a, b) => b - a), "best first");
  assert.equal(M.suggestOpponents(w, s, 3).length, 3);
  assert.deepEqual(M.suggestOpponents(w, s, 3).map((p) => p.b.id), out.slice(0, 3).map((p) => p.b.id), "n only truncates");
});

test("closer fights, fresh opponents and live belts score higher, and the parts say why", () => {
  const s = star();
  const all = M.suggestOpponents(w, s, 200);
  const near = all.filter((p) => Math.abs(p.pA - p.pB) < 0.2), far = all.filter((p) => Math.abs(p.pA - p.pB) > 0.7);
  if (near.length && far.length) assert.ok(Math.max(...near.map((p) => p.parts.competitive)) > Math.max(...far.map((p) => p.parts.competitive)));
  for (const p of all) {
    assert.equal(p.parts.competitive, Math.max(0, Math.min(1, 1 - Math.abs(p.pA - p.pB))), "competitiveness is how close the model has it");
    if (p.meetings.length === 0) { assert.equal(p.parts.novelty, 1); assert.ok(p.reasons.includes(tEn("They have never met"))); }
    else { assert.ok(p.parts.novelty < 1); assert.ok(p.reasons.some((r) => /rematch/i.test(r))); }
  }
  const sym = M.pairing(w, all[0].a, all[0].b), rev = M.pairing(w, all[0].b, all[0].a);
  assert.equal(sym.score, rev.score, "a pairing does not depend on which corner is listed first");
  assert.ok(Math.abs(sym.pA - rev.pB) < 1e-9);
});

test("fights to make: one per division and sex, nobody booked, best first, cached", () => {
  const f = M.fightsToMake(w, 40);
  assert.ok(f.length > 5);
  const keys = f.map((p) => `${p.a.sex}|${p.division}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const p of f) { assert.ok(!booked(p.a.id) && !booked(p.b.id)); assert.equal(p.a.sex, p.b.sex); assert.equal(p.a.weightClass, p.division); assert.equal(p.b.weightClass, p.division); const g = gymOf(p.a.id); assert.ok(g === null || g !== gymOf(p.b.id)); }
  assert.deepEqual(f.map((p) => p.score), [...f.map((p) => p.score)].sort((a, b) => b - a));
  assert.equal(M.fightsToMake(w, 8), M.fightsToMake(w, 8));
  assert.equal(M.fightsToMake(w, 3).length, 3);
});

test("the dream-fight builder says why a fight might never happen, and what the records say", () => {
  const men = w.boxers.filter((b) => b.sex === "male" && b.bouts >= 8);
  const woman = w.boxers.find((b) => b.sex === "female" && b.bouts >= 5)!;
  const a = men.find((b) => b.weightClass === "Welterweight")!, light = men.find((b) => b.weightClass === "Lightweight")!, heavy = men.find((b) => b.weightClass === "Heavyweight")!;
  assert.ok(M.dreamFight(w, a, woman).flags.some((f) => /sexes/.test(f)));
  const cross = M.dreamFight(w, light, a);
  assert.ok(cross.flags.some((f) => /Different divisions/.test(f)));
  assert.match(cross.catchweight ?? "", /^14[0-7] lb catchweight$|^1[34]\d lb catchweight$/, "midway between 135 and 147 lb");
  assert.equal(M.dreamFight(w, light, a).catchweight, `${Math.round((135 + 147) / 2)} lb catchweight`);
  assert.match(M.dreamFight(w, a, heavy).catchweight ?? "", /heavier/i, "no limit at heavyweight: the heavier division sets it");
  assert.equal(M.dreamFight(w, a, men.find((b) => b.weightClass === "Welterweight" && b.id !== a.id)!).catchweight, null, "same division: no catchweight");
  const retired = w.boxers.find((b) => !b.active && b.sex === "male" && b.bouts >= 8)!;
  assert.ok(M.dreamFight(w, a, retired).flags.some((f) => /retired or inactive/.test(f)));

  // meetings and common opponents against a brute-force count
  const x = w.boxers.filter((b) => b.bouts >= 15).find((b) => (w.boutsByBoxer.get(b.id) ?? []).some((bt) => bt.method && bt.method !== "NC"))!;
  const bout = (w.boutsByBoxer.get(x.id) ?? []).find((bt) => !bt.upcoming && bt.method && bt.method !== "NC")!;
  const y = w.byId.get(bout.redId === x.id ? bout.blueId : bout.redId)!;
  const d = M.dreamFight(w, x, y);
  const fought = (w.boutsByBoxer.get(x.id) ?? []).filter((bt) => !bt.upcoming && bt.method && bt.method !== "NC" && (bt.redId === y.id || bt.blueId === y.id)).length;
  assert.equal(d.p.meetings.length, fought); assert.ok(fought >= 1);
  assert.ok(d.flags.some((f) => /already fought/.test(f)));
  const opps = (b: typeof x) => new Set((w.boutsByBoxer.get(b.id) ?? []).filter((bt) => !bt.upcoming && bt.method && bt.method !== "NC").map((bt) => (bt.redId === b.id ? bt.blueId : bt.redId)));
  const common = [...opps(x)].filter((id) => opps(y).has(id) && id !== x.id && id !== y.id);
  assert.equal(d.common.length, Math.min(8, common.length));
  for (const c of d.common) assert.ok(common.includes(c.opponent.id));
});

test("the same code speaks Arabic: no unfilled placeholders and Arabic letters in the reasons", async () => {
  const { getTFor } = await import("../lib/i18n/dicts");
  const ar = await getTFor("ar");
  const s = star();
  const p = M.suggestOpponents(w, s, 3, ar)[0];
  assert.ok(p.reasons.every((r) => /[؀-ۿ]/.test(r) && !/\{\w+\}/.test(r)), p.reasons.join(" | "));
  const d = M.dreamFight(w, s, w.boxers.find((b) => b.sex === "female" && b.bouts >= 5)!, ar);
  assert.ok(d.flags.every((f) => /[؀-ۿ]/.test(f) && !/\{\w+\}/.test(f)));
});
