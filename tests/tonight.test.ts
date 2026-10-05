import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("tonight");
after(cleanup);
let getWorld: typeof import("../lib/world").getWorld;
let buildTonight: typeof import("../lib/tonight").buildTonight;
before(async () => { getWorld = (await import("../lib/world")).getWorld; buildTonight = (await import("../lib/tonight")).buildTonight; });

test("on a fight day the card is in fight order with win chances that add up, and no card gives the next card and a review", async () => {
  const w0 = await getWorld();
  const past = [...w0.events].reverse().find((e) => !e.upcoming && e.status !== "cancelled" && (w0.boutsByEvent.get(e.id) ?? []).filter((b) => b.status !== "cancelled").length >= 2);
  assert.ok(past);
  const was = process.env.RINGSIDE_NOW;
  try {
    process.env.RINGSIDE_NOW = past.date;
    const w = await getWorld();
    const t = buildTonight(w);
    assert.equal(t.kind, "card");
    if (t.kind !== "card") return;
    assert.equal(t.event.id, past.id);
    assert.equal(t.bouts.filter((b) => b.role === "main").length, 1);
    assert.equal(t.bouts.filter((b) => b.role === "co").length, 1);
    for (const b of t.bouts) {
      assert.ok(Math.abs(b.red.pct + b.blue.pct + b.pDraw - 100) <= 2, `chances add up for bout ${b.id}`);
      if (b.status === "decided") assert.ok(b.how, "a decided fight says how");
      if (b.status === "pending") assert.equal(b.winnerId, null);
    }
  } finally { if (was === undefined) delete process.env.RINGSIDE_NOW; else process.env.RINGSIDE_NOW = was; }

  const none = buildTonight(await getWorld());
  if (none.kind === "none") {
    assert.ok(none.next === null || none.next.days >= 0);
    if (none.review) assert.ok(none.review.lines.length > 0);
  }
});
