import test from "node:test";
import assert from "node:assert/strict";
import { boxingDataApiProvider } from "../lib/providers/boxing-data-api";
import { makeWorld, mockVendor, type MockOptions, type MockWorld } from "../lib/vendor-mock";

/**
 * The docs say page numbers stop at 10,000 documents; a full history is about 160,000 fights. What the real API does past that point is not
 * known (an error, or an empty page that looks like the end of the list), so the adapter must not depend on it: past the reachable limit it
 * asks for the history in date windows. These tests shrink the limit to 300 so a 1,200-fight league reaches it.
 */
const KEY = "sk-paging-test-key-0123456789abcdef0123456789";
// the paging tests count the bouts of a random league, where the same two fighters meet twice within a day by chance: the importer would (rightly) merge those, so it is off here (round 78)
const load = async (w: MockWorld, o: MockOptions, extra: Record<string, unknown> = {}) => {
  const v = mockVendor(w, o);
  const logs: string[] = [];
  const p = boxingDataApiProvider({ key: KEY, purpose: "evaluation", fetchImpl: v.fetchImpl, scheduleDays: 0, maxRequests: 100_000, mergeDuplicates: false, log: (m) => logs.push(m), ...extra });
  const bouts = await p.fetchBouts();
  return { bouts, v, logs, p };
};
const world = makeWorld({ fighters: 120, fights: 1200, upcoming: 0, seed: 11 });

for (const beyond of ["reject", "silent"] as const) for (const totalPages of ["true", "capped"] as const) {
  test(`past the page limit (${beyond}, total_pages ${totalPages}) every fight still arrives, once, by date windows`, async () => {
    const { bouts, v } = await load(world, { offsetLimit: 300, beyond, totalPages }, { offsetLimit: 300 });
    assert.equal(bouts.length, 1200, "no fight lost");
    assert.equal(new Set(bouts.map((b) => b.externalId)).size, 1200, "none twice");
    const lists = v.stats.byPath["/v2/fights/"];
    assert.ok(lists < (1200 / 100) * 4, `a sensible number of list requests (${lists}): the pages plus a little for the windows`);
  });
}

test("a league inside the limit is read exactly as before: no date parameters (a limited plan refuses them) and one request per page", async () => {
  const small = makeWorld({ fighters: 60, fights: 250, upcoming: 0, seed: 3 }); // 3 pages; the limit below reaches 4
  const seen: string[] = [];
  const v = mockVendor(small, { offsetLimit: 400, historyDays: 365 * 40 });
  const p = boxingDataApiProvider({ key: KEY, purpose: "evaluation", scheduleDays: 0, offsetLimit: 400, mergeDuplicates: false, fetchImpl: (async (u: RequestInfo | URL) => { seen.push(String(u)); return v.fetchImpl(u); }) as typeof fetch });
  assert.equal((await p.fetchBouts()).length, 250);
  assert.equal(seen.filter((u) => u.includes("/v2/fights/")).length, 3, "three list pages of at most 100");
  assert.ok(seen.every((u) => !u.includes("date_from")), "no date window was asked for");
});

test("a window that is still too big is split again, down to single days, and a single day beyond the limit is counted and loaded as far as it can be", async () => {
  const w = makeWorld({ fighters: 120, fights: 1200, upcoming: 0, seed: 11 });
  for (let i = 0; i < 400; i++) w.fights[i].date = "2001-05-05"; // one very busy day: more than the 300 reachable
  const { bouts, p, logs } = await load(w, { offsetLimit: 300, beyond: "reject" }, { offsetLimit: 300 });
  assert.equal(bouts.length, 1200 - 400 + 300, "the reachable part of the busy day, everything else");
  assert.equal(p.notes().windowTooBig, 1, "counted, so the report says the day was cut");
  assert.ok(logs.some((l) => /2001-05-05/.test(l) && /more fights than a page number can reach/.test(l)));
});

test("windows are inclusive and disjoint: a fight on a window's edge is not lost or doubled", async () => {
  const w = makeWorld({ fighters: 40, fights: 900, upcoming: 0, seed: 5, years: 1 });
  for (const [i, d] of ["2026-03-01", "2026-03-02", "2025-12-31", "2026-01-01"].entries()) w.fights[i].date = d;
  const { bouts } = await load(w, { offsetLimit: 200, beyond: "reject" }, { offsetLimit: 200 });
  assert.equal(bouts.length, 900); assert.equal(new Set(bouts.map((b) => b.externalId)).size, 900);
});

test("coming fights are in the windows too (the list is asked up to the coming weeks)", async () => {
  const w = makeWorld({ fighters: 120, fights: 1200, upcoming: 5, seed: 11 });
  const { bouts } = await load(w, { offsetLimit: 300, beyond: "reject" }, { offsetLimit: 300, scheduleDays: 60 });
  assert.equal(bouts.length, 1205);
  assert.equal(bouts.filter((b) => b.winnerExternalId === null && b.method === null).length >= 5, true);
});
