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
