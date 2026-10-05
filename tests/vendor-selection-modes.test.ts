import test from "node:test";
import assert from "node:assert/strict";
import { boxingDataApiProvider } from "../lib/providers/boxing-data-api";
import { chooseByMode, previewModes, rankByRecency } from "../lib/vendor-selection";
import { reconcileFeed } from "../lib/vendor-verify";
import { describePlan } from "../lib/vendor-backfill";
import { makeWorld, mockVendor } from "../lib/vendor-mock";

/** Three ways to choose the N fighters of a staged load (round 73): the most recent, those and all their opponents, or whole groups. */
const bout = (a: string, b: string, e: string, over: Record<string, unknown> = {}) => ({ redExternalId: a, blueExternalId: b, eventExternalId: e, status: "completed" as const, winnerExternalId: a, method: "UD" as const, ...over });
// two groups: {A,B,C} chained A-B, B-C (old), and {D,E} (newest); F alone with one fight against A that is a no-result (does not link)
const bouts = [bout("D", "E", "e4"), bout("A", "B", "e3"), bout("B", "C", "e2"), bout("F", "A", "e1", { winnerExternalId: null, method: null })];
const dateOf = new Map([["e4", "2026-04-01"], ["e3", "2026-03-01"], ["e2", "2026-02-01"], ["e1", "2026-01-01"]]);
const ranked = rankByRecency(bouts, dateOf); // D E A B C F

test("recent is the first N; opponents adds every opponent of the first N; groups takes whole groups that fit", () => {
  assert.deepEqual(ranked, ["D", "E", "A", "B", "C", "F"]);
  assert.deepEqual(chooseByMode(bouts, ranked, 3, "recent").chosen, ["D", "E", "A"]);
  const o = chooseByMode(bouts, ranked, 3, "opponents").chosen;
  assert.deepEqual(o.slice(0, 3), ["D", "E", "A"], "the first N keep their order");
  assert.deepEqual([...o].sort(), ["A", "B", "D", "E", "F"], "A's opponents are B and F (a no-result fight is still a fight against him)");
  const g = chooseByMode(bouts, ranked, 3, "groups");
  assert.deepEqual([...g.chosen].sort(), ["D", "E", "F"], "the group {A,B,C} has 3 members and only 1 place is left, so it is skipped; F (no counting fight) is a group of one");
  assert.equal(g.groupsTaken, 2); assert.equal(g.groupsSkipped, 1); assert.equal(g.largestGroup, 3);
  assert.deepEqual([...chooseByMode(bouts, ranked, 5, "groups").chosen].sort(), ["A", "B", "C", "D", "E"], "with room for it the whole group goes in");
});

test("the plan prints what each mode would ask for", () => {
  const m = previewModes(bouts, ranked, 3);
  assert.deepEqual([m.n, m.opponents, m.groups], [3, 5, 3]);
  const lines = describePlan({ fights: 4, events: 4, fighters: 3, requestsMade: 1, fighterRequests: 3, fightersCached: 0, allFighters: 6, selection: [{ fighters: 3, fights: 1, whole: 1, share: 1 / 3, closed: 2 }], modes: [m] } as never, { gapMs: 0 });
  assert.ok(lines.some((l) => /--with-opponents asks for\s+5 fighters/.test(l) && /--whole-groups asks for\s+3/.test(l)), lines.join("\n"));
});

const KEY = "sk-modes-test-key-0123456789abcdef0123456789012345";
const world = makeWorld({ fighters: 60, fights: 150, upcoming: 3, seed: 21 });
const run = async (extra: Record<string, unknown>) => {
  const v = mockVendor(world);
  const p = boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: v.fetchImpl, scheduleDays: 0, maxRequests: 100_000, retries: 0, gapMs: 0, log: () => {}, sleep: async () => {}, ...extra });
  const raw = { boxers: await p.fetchBoxers(), events: await p.fetchEvents(), bouts: await p.fetchBouts() };
  return { v, p, raw };
};

test("end to end: --with-opponents gives every one of the N a complete record, and fetches more than N", async () => {
  const plain = await run({ maxFighters: 12 });
  const withOpp = await run({ maxFighters: 12, selectMode: "opponents" });
  assert.equal(plain.v.stats.fighterOrder.length, 12);
  assert.ok(withOpp.v.stats.fighterOrder.length > 12, "the opponents were fetched too");
  const core = new Set(plain.v.stats.fighterOrder); // the same N most recent
  assert.ok(plain.v.stats.fighterOrder.every((id) => withOpp.v.stats.fighterOrder.includes(id)));
  const rec = reconcileFeed(withOpp.raw as never, withOpp.p.vendorRecords());
  assert.ok(rec.conflict === 0, "no fighter has more fights loaded than his career total");
  const plainRec = reconcileFeed(plain.raw as never, plain.p.vendorRecords());
  assert.ok(rec.complete > plainRec.complete, `more records add up (${rec.complete} against ${plainRec.complete})`);
  void core;
});

test("end to end: --whole-groups loads groups no fighter of which has a fight outside, so what loads is right", async () => {
  const g = await run({ maxFighters: 25, selectMode: "groups" });
  const rec = reconcileFeed(g.raw as never, g.p.vendorRecords());
  assert.ok(g.v.stats.fighterOrder.length <= 25, "never more than N");
  assert.equal(rec.conflict, 0);
  assert.equal(rec.partial, 0, "no record is short: every group is in whole");
});

// round 76: --cached-only
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("cached only: no request is made, the fighters not in the cache are left out, and the fights between the others still load", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bda-cachedonly-"));
  const filled = mockVendor(world);
  const common = { key: KEY, purpose: "evaluation" as const, scheduleDays: 0, maxRequests: 100_000, retries: 0, gapMs: 0, log: () => {}, sleep: async () => {}, cacheDir: dir };
  const full = boxingDataApiProvider({ ...common, fetchImpl: filled.fetchImpl });
  const all = { boxers: await full.fetchBoxers(), bouts: await full.fetchBouts() };
  const fighterFiles = fs.readdirSync(dir).filter((f) => /fighters/.test(f) && !/fights/.test(f));
  assert.equal(fighterFiles.length, all.boxers.length, "one cache file for each fighter");
  const gone = fighterFiles.slice(0, 10);
  for (const f of gone) fs.rmSync(path.join(dir, f));
  let calls = 0;
  const never = (async () => { calls++; throw new Error("a request was made"); }) as typeof fetch;
  const lines: string[] = [];
  const p = boxingDataApiProvider({ ...common, fetchImpl: never, cachedOnly: true, log: (m) => lines.push(m) });
  const boxers = await p.fetchBoxers(), bouts = await p.fetchBouts();
  assert.equal(calls, 0); assert.equal(p.requests(), 0);
  assert.ok(lines.some((l) => /--cached-only: \d+ of \d+ chosen fighters are in the cache; the other 10 are left for a later run/.test(l)) && !lines.some((l) => /skipped/.test(l)), "it says what it left out, and no fighter is reported as failed");
  assert.equal(boxers.length, all.boxers.length - 10, "the ten missing fighters are left out");
  const ids = new Set(boxers.map((b) => b.externalId));
  assert.ok(bouts.length > 0 && bouts.length < all.bouts.length);
  assert.ok(bouts.every((b) => ids.has(b.redExternalId) && ids.has(b.blueExternalId)), "every fight kept is between two fighters held");
  assert.ok(p.notes().boutsOutsideSelection > 0); assert.equal(p.notes().boutsDroppedUnknownFighter, 0, "left out by choice, not reported as fighters that could not be fetched (which would stop a load)");
  // and without the flag the same missing fighters would have been asked for
  const asks = mockVendor(world);
  await boxingDataApiProvider({ ...common, fetchImpl: asks.fetchImpl }).fetchBoxers();
  assert.ok(asks.stats.requests >= 10);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("cached only: an empty cache is an error about the fight list, not a silent empty league", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bda-cachedonly-empty-"));
  const never = (async () => { throw new Error("a request was made"); }) as typeof fetch;
  const p = boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: never, scheduleDays: 0, retries: 0, gapMs: 0, log: () => {}, cacheDir: dir, cachedOnly: true });
  const r = await p.fetchBoxers().then((b) => ({ n: b.length }), (e: Error) => ({ error: e.message }));
  assert.ok("error" in r && /\/v2\/fights\/ is not in the cache \(--cached-only makes no request\)/.test(r.error), JSON.stringify(r));
  fs.rmSync(dir, { recursive: true, force: true });
});
