import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * The post-fight recap says what one result changed. It is built from facts that the rest of the site already holds
 * (ratings, rankings, lineage, streaks), so the strongest test is that it agrees with them for every decided fight in the league.
 */
const cleanup = tempDb("recap");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let R: typeof import("../lib/recap");
let lineage: typeof import("../lib/lineage");
before(async () => { w = await (await import("../lib/world")).getWorld(); R = await import("../lib/recap"); lineage = await import("../lib/lineage"); });

const decided = () => w.bouts.filter((b) => !b.upcoming && b.method && b.winnerId && b.method !== "NC" && !["DRAW", "TDRAW"].includes(b.method));

test("only decided fights have a recap: not upcoming, cancelled, drawn or no-contest", () => {
  assert.ok(decided().length > 1000);
  for (const b of w.bouts.filter((x) => x.upcoming)) assert.equal(R.buildRecap(w, b.id), null);
  for (const b of w.bouts.filter((x) => x.status === "cancelled")) assert.equal(R.buildRecap(w, b.id), null);
  for (const b of w.bouts.filter((x) => !x.upcoming && (x.method === "DRAW" || x.method === "TDRAW" || x.method === "NC"))) assert.equal(R.buildRecap(w, b.id), null);
  assert.equal(R.buildRecap(w, 99999999), null);
  for (const b of decided().slice(0, 50)) assert.ok(R.buildRecap(w, b.id));
});

test("ratings: the recap's before and after are the ratings the site holds, and the exchange is zero-sum", () => {
  for (const b of decided().slice(-400)) {
    const r = R.buildRecap(w, b.id)!;
    const pre = w.boutPre.get(b.id)!;
    const win = r.ratings.find((x) => x.id === r.winnerId)!, lose = r.ratings.find((x) => x.id === r.loserId)!;
    assert.equal(win.before, r.winnerId === b.redId ? pre.red : pre.blue);
    assert.equal(lose.before, r.loserId === b.redId ? pre.red : pre.blue);
    assert.equal(win.after, w.history.get(r.winnerId)!.find((h) => h.boutId === b.id)!.rating);
    assert.ok(win.after > win.before && lose.after < lose.before, "the winner gains and the loser loses");
    assert.ok(Math.abs((win.after - win.before) + (lose.after - lose.before)) < 1e-6, "Elo is zero-sum");
  }
});

test("title changes agree with the lineage: every new champion and every defence is reported, with the right number", () => {
  let crowned = 0, defended = 0;
  for (const belt of lineage.belts(w)) {
    for (const reign of belt.reigns) {
      const rc = R.buildRecap(w, reign.boutId);
      if (rc) { assert.equal(rc.title?.kind, "crowned", `belt ${belt.slug} reign ${reign.n}`); assert.equal(rc.title && "beltSlug" in rc.title ? rc.title.beltSlug : null, belt.slug); crowned++; }
      reign.defenses.forEach((d, i) => {
        const rd = R.buildRecap(w, d.boutId);
        if (rd) { assert.deepEqual(rd.title, { kind: "defended", beltSlug: belt.slug, number: i + 1 }); defended++; }
      });
    }
  }
  assert.ok(crowned > 5 && defended > 5, `${crowned} crowned, ${defended} defended`);
  // a dethroned reign is described with its length and defences
  const dethroned = lineage.belts(w).flatMap((b) => b.reigns.filter((r) => r.endedBy === "lost" && r.endedByBoutId));
  assert.ok(dethroned.length > 0);
  const sample = dethroned[0];
  const t = R.buildRecap(w, sample.endedByBoutId!)!.title;
  assert.ok(t && t.kind === "crowned" && t.days === sample.days && t.defenses === sample.defenses.length);
});

test("streaks agree with each fighter's current streak, and records with their final record", () => {
  let checked = 0;
  for (const f of w.boxers) {
    const list = (w.boutsByBoxer.get(f.id) ?? []).filter((x) => !x.upcoming && x.method && x.method !== "NC");
    const last = list[list.length - 1];
    if (!last || !last.winnerId) continue;
    const r = R.buildRecap(w, last.id)!;
    if (last.winnerId === f.id) {
      if (f.streak.type === "W") { assert.equal(r.winStreak, f.streak.count, f.name); checked++; }
      const rec = r.records.find((x) => x.id === f.id)!.rec;
      assert.deepEqual([rec.w, rec.l, rec.d], [f.wins, f.losses, f.draws], `${f.name}'s record after their last fight`);
    }
  }
  assert.ok(checked > 100);
});

test("ranks: only real movements within the top 15 are reported, and the winner of a fight never loses ground to the loser", () => {
  let moves = 0;
  for (const b of decided().slice(-600)) {
    const r = R.buildRecap(w, b.id)!;
    for (const m of r.ranks) {
      moves++;
      assert.notEqual(m.before, m.after);
      assert.ok((m.before ?? 99) <= 15 || (m.after ?? 99) <= 15);
      assert.ok((m.before ?? 1) >= 1 && (m.after ?? 1) >= 1);
    }
    const wm = r.ranks.find((m) => m.boxerId === r.winnerId), lm = r.ranks.find((m) => m.boxerId === r.loserId);
    if (wm && wm.before !== null && wm.after !== null) assert.ok(wm.after <= wm.before + 3, "a winner may be passed by same-night results, but not dive");
    if (lm && lm.before !== null && lm.after !== null) assert.ok(lm.after >= lm.before - 3);
  }
  assert.ok(moves > 50, `${moves} moves`);
});

test("surprise tiers follow the model's probability for the winner, and the sentence matches the tier", async () => {
  assert.deepEqual([0.1, 0.249, 0.25, 0.399, 0.4, 0.599, 0.6, 0.749, 0.75, 0.95].map(R.tierOf),
    ["major-upset", "major-upset", "upset", "upset", "close", "close", "expected", "expected", "heavy-favourite", "heavy-favourite"]);
  const { tEn } = await import("../lib/i18n/t");
  const up = decided().map((b) => R.buildRecap(w, b.id)!).find((r) => r.surprise?.tier === "major-upset")!;
  assert.ok(R.recapLines(up, w, tEn).some((l) => /^A major upset: the model gave .+ only \d+%\.$/.test(l)));
  const fav = decided().map((b) => R.buildRecap(w, b.id)!).find((r) => r.surprise?.tier === "heavy-favourite")!;
  assert.ok(R.recapLines(fav, w, tEn).some((l) => /^As expected: the model had .+ at \d+%\.$/.test(l)));
  // when a belt changes hands that leads; otherwise the surprise does
  const crowned = decided().map((b) => R.buildRecap(w, b.id)!).find((r) => r.title?.kind === "crowned" && r.surprise)!;
  assert.match(R.recapLines(crowned, w, tEn)[0], /took the|won the vacant|first champion|beat the champion/);
  const plain = decided().map((b) => R.buildRecap(w, b.id)!).find((r) => !r.title && r.surprise)!;
  assert.match(R.recapLines(plain, w, tEn)[0], /model/);
});

test("sentences exist in both languages with no leftover placeholders, and Arabic has no English sentence in it", async () => {
  const { getTFor } = await import("../lib/i18n/dicts");
  const en = await getTFor("en"), ar = await getTFor("ar");
  const ids = decided().slice(-300).map((b) => b.id);
  for (const id of ids) {
    const r = R.buildRecap(w, id)!;
    const a = R.recapLines(r, w, en), b = R.recapLines(r, w, ar);
    assert.equal(a.length, b.length);
    for (const line of [...a, ...b]) assert.ok(!/[{}]/.test(line), `placeholder left in: ${line}`);
    for (const line of b) {
      const words = line.replace(/\p{Script=Arabic}[\p{Script=Arabic}ً-ٟ]*/gu, "").match(/[A-Za-z]{4,}/g) ?? [];
      // only proper names (fighters, belts, bodies) may remain in Latin letters; sentence words may not
      assert.ok(!words.some((x) => ["gained", "rating", "points", "ranking", "climbed", "unbeaten", "model", "records", "defence", "champion"].includes(x.toLowerCase())), `English left in Arabic recap: ${line}`);
    }
  }
});
