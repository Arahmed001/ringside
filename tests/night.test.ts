import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * The night in review summarises a card from the recap of each of its fights, so it must never disagree with the bout pages.
 * Checked on every completed card in the league, then on a card small enough to read.
 */
const cleanup = tempDb("night");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let N: typeof import("../lib/night");
let R: typeof import("../lib/recap");
let A: typeof import("../lib/accountability");
before(async () => { w = await (await import("../lib/world")).getWorld(); N = await import("../lib/night"); R = await import("../lib/recap"); A = await import("../lib/accountability"); });

const completed = () => w.events.filter((e) => !e.upcoming && e.status !== "cancelled");

test("upcoming, cancelled and unknown cards have no review", () => {
  for (const e of w.events.filter((x) => x.upcoming || x.status === "cancelled")) assert.equal(N.buildNight(w, e.id), null);
  assert.equal(N.buildNight(w, 99999999), null);
  assert.ok(completed().filter((e) => N.buildNight(w, e.id)).length > 100);
});

test("every number agrees with the bout pages: decided and early finishes, belts, the surprise, the model's record, the fastest finish", () => {
  let nights = 0, withUpset = 0, withBelts = 0;
  for (const e of completed()) {
    const n = N.buildNight(w, e.id);
    if (!n) continue;
    nights++;
    const bouts = (w.boutsByEvent.get(e.id) ?? []).filter((b) => !b.upcoming && b.status !== "cancelled");
    const recaps = bouts.map((b) => R.buildRecap(w, b.id)).filter((r) => r !== null);
    assert.equal(n.decided, recaps.length);
    assert.equal(n.endedEarly, bouts.filter((b) => b.winnerId && ["KO", "TKO", "RTD"].includes(b.method ?? "")).length);
    assert.ok(n.endedEarly <= n.decided);
    assert.equal(n.crowned.length, recaps.filter((r) => r.title?.kind === "crowned").length);
    assert.equal(n.defended.length, recaps.filter((r) => r.title?.kind === "defended").length);
    if (n.upset) {
      withUpset++;
      const lowest = Math.min(...recaps.filter((r) => r.surprise).map((r) => r.surprise!.pWinner));
      assert.equal(n.upset.pWinner, lowest, "the surprise is the card's least likely winner");
      assert.ok(n.upset.pWinner < 0.4);
      assert.equal(A.callOf(w, n.upset.boutId)!.pWinner, n.upset.pWinner, "and it is the same number the bout page shows");
    } else assert.ok(recaps.every((r) => !r.surprise || r.surprise.pWinner >= 0.4), "no upset reported only when there was none");
    if (n.model) {
      const calls = bouts.map((b) => A.callOf(w, b.id)).filter((c) => c !== null);
      assert.deepEqual(n.model, { n: calls.length, right: calls.filter((c) => c.correct).length });
      assert.ok(n.model.right <= n.model.n);
    }
    if (n.fastest) {
      const early = bouts.filter((b) => ["KO", "TKO", "RTD"].includes(b.method ?? "") && b.endRound);
      assert.ok(early.every((b) => b.endRound! >= n.fastest!.round), "nothing ended in an earlier round");
    } else assert.equal(n.endedEarly === 0 || bouts.every((b) => !b.endRound), true);
    if (n.crowned.length + n.defended.length) withBelts++;
    if (n.streak) assert.ok(n.streak.n >= 3);
    for (const u of n.unbeatenEnded) assert.ok(u.n >= 5);
  }
  assert.ok(nights > 100 && withUpset > 20 && withBelts > 5, `${nights} nights, ${withUpset} with an upset, ${withBelts} with belts`);
});

test("the climb is a real rise within the top 15, and the streak is the card's longest", () => {
  let climbs = 0;
  for (const e of completed().slice(-150)) {
    const n = N.buildNight(w, e.id);
    if (!n) continue;
    const recaps = (w.boutsByEvent.get(e.id) ?? []).map((b) => R.buildRecap(w, b.id)).filter((r) => r !== null);
    if (n.climb) {
      climbs++;
      assert.ok(n.climb.after !== null && n.climb.after <= 15);
      assert.ok(n.climb.before === null || n.climb.before > n.climb.after!, "a climb goes up");
      assert.ok(recaps.some((r) => r.ranks.some((m) => m.boxerId === n.climb!.boxerId && m.before === n.climb!.before && m.after === n.climb!.after)));
    }
    if (n.streak) assert.equal(n.streak.n, Math.max(...recaps.map((r) => r.winStreak)));
  }
  assert.ok(climbs > 20);
});

test("sentences exist in both languages with no placeholders left, belts first, and Arabic has no English sentence words", async () => {
  const { getTFor } = await import("../lib/i18n/dicts");
  const en = await getTFor("en"), ar = await getTFor("ar");
  let belted = 0;
  for (const e of completed().slice(-120)) {
    const n = N.buildNight(w, e.id);
    if (!n) continue;
    const a = N.nightLines(n, w, en), b = N.nightLines(n, w, ar);
    assert.equal(a.length, b.length);
    assert.ok(a.length >= 1);
    for (const line of [...a, ...b]) assert.ok(!/[{}]/.test(line), `placeholder left in: ${line}`);
    for (const line of b) {
      const words = line.replace(/\p{Script=Arabic}[\p{Script=Arabic}ً-ٟ]*/gu, "").match(/[A-Za-z]{4,}/g) ?? [];
      assert.ok(!words.some((x) => ["fights", "decided", "champion", "defended", "fastest", "surprise", "unbeaten", "streak", "picked", "winners"].includes(x.toLowerCase())), `English left in Arabic: ${line}`);
    }
    if (n.crowned.length) { belted++; assert.match(a[0], /^New champion: /, "a new champion leads the night"); }
    assert.ok(a.some((l) => /fights? decided/.test(l)), "every review says how many fights were decided");
  }
  assert.ok(belted > 0);
});
