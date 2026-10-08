import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("watchlist");
after(cleanup);
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let watch: typeof import("../lib/watch");
before(async () => { w = await (await import("../lib/world")).getWorld(); watch = await import("../lib/watch"); });

test("the watchlist gives each followed fighter's record, last result and rating; unknown slugs are skipped", () => {
  const withFights = w.boxers.filter((b) => b.bouts > 2).slice(0, 3);
  assert.ok(withFights.length > 0);
  const rows = watch.watchEntries(w, [...withFights.map((b) => b.slug), "no-such-fighter", withFights[0].slug]);
  assert.equal(rows.length, withFights.length, "unknown slugs and repeats are dropped");
  for (const r of rows) {
    assert.ok(r.record && r.rating && r.last, r.slug);
    assert.ok(["W", "L", "D", "NC"].includes(r.last!.result));
    assert.ok(r.last!.boutId > 0 && r.last!.how && r.last!.opponent);
    // the page formats this date itself, in the visitor's language: a date already turned into words ("Oct 3, 2026") came out as "Invalid Date" (found by the browser suite, docs/e2e.md)
    assert.match(r.last!.date, /^\d{4}-\d{2}-\d{2}$/, r.slug);
  }
});

test("a fighter with an upcoming fight carries its date and bout for sorting and linking", () => {
  const up = w.bouts.find((x) => x.upcoming);
  if (!up) return;
  const [r] = watch.watchEntries(w, [up.redSlug]);
  assert.equal(r.nextBoutId !== undefined && r.nextDate !== undefined, true);
  assert.ok(r.next?.includes(" "));
});

test("the list is capped", () => {
  const many = Array.from({ length: watch.MAX_WATCH + 50 }, (_, i) => `x${i}`);
  assert.deepEqual(watch.watchEntries(w, many), []);
});

test("a damaged or foreign value in the browser's storage is treated as no list, never as something to crash on", async () => {
  const { cleanList } = await import("../lib/useWatchlist");
  for (const bad of [null, undefined, 123, "str", { a: 1 }, true]) assert.deepEqual(cleanList(bad), []);
  assert.deepEqual(cleanList(["a", "b"]), ["a", "b"]);
  assert.deepEqual(cleanList(["a", 1, null, "", "a", { x: 1 }, "b"]), ["a", "b"], "only non-empty, distinct strings are kept");
  assert.equal(cleanList(Array.from({ length: 300 }, (_, i) => `s${i}`)).length, 100, "capped like the server");
});
