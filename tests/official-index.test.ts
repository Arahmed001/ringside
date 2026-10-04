import test from "node:test";
import assert from "node:assert/strict";
import { buildOfficial, officialKey, type OfficialRow } from "../lib/official";

/** The stored rows to what the pages use: a list per body and division, and where each fighter stands. */
const row = (o: Partial<OfficialRow> & Pick<OfficialRow, "body" | "kind" | "position">): OfficialRow =>
  ({ division: "Heavyweight", sex: "male", rank: null, boxer_id: null, name: null, title_type: null, vacant: 0, updated_at: "2026-06-10T00:00:00", ...o });

test("a list keeps its champions apart from its contenders, in rank order, and says when it was updated", () => {
  const ix = buildOfficial([
    row({ body: "WBC", kind: "champion", position: 0, boxer_id: 1, name: "A", title_type: "full" }),
    row({ body: "WBC", kind: "contender", position: 2, rank: 2, boxer_id: 3, name: "C" }),
    row({ body: "WBC", kind: "contender", position: 1, rank: 1, boxer_id: null, name: "Unlisted" }),
    row({ body: "WBC", kind: "contender", position: 3, rank: 3, vacant: 1 }),
  ]);
  const [l] = ix.byDivision.get(officialKey("male", "Heavyweight"))!;
  assert.equal(l.body, "WBC"); assert.equal(l.updatedAt, "2026-06-10T00:00:00");
  assert.deepEqual(l.champions.map((c) => [c.name, c.titleType]), [["A", "full"]]);
  assert.deepEqual(l.contenders.map((c) => [c.rank, c.name, c.boxerId, c.vacant]), [[1, "Unlisted", null, false], [2, "C", 3, false], [3, null, null, true]]);
});

test("the lists of a division come in the order WBA, WBC, IBF, WBO, whatever order they were stored in", () => {
  const ix = buildOfficial(["WBO", "IBF", "WBC", "WBA"].map((body, i) => row({ body, kind: "champion", position: i, boxer_id: i + 1 })));
  assert.deepEqual(ix.byDivision.get(officialKey("male", "Heavyweight"))!.map((l) => l.body), ["WBA", "WBC", "IBF", "WBO"]);
});

test("where a fighter stands: a belt or a place on each list, only for a fighter we hold, never for a vacant place", () => {
  const ix = buildOfficial([
    row({ body: "WBC", kind: "champion", position: 0, boxer_id: 7, title_type: "interim" }),
    row({ body: "IBF", kind: "contender", position: 1, rank: 4, boxer_id: 7 }),
    row({ body: "WBA", kind: "contender", position: 1, rank: 2, boxer_id: 7 }),
    row({ body: "WBO", kind: "contender", position: 1, rank: 5, boxer_id: 8, vacant: 1 }),
    row({ body: "WBO", kind: "contender", position: 2, rank: 6, boxer_id: null, name: "Not ours" }),
  ]);
  assert.deepEqual(ix.byBoxer.get(7)!.map((p) => [p.body, p.place, p.titleType]), [["WBA", 2, null], ["WBC", "champion", "interim"], ["IBF", 4, null]]);
  assert.equal(ix.byBoxer.has(8), false, "a vacant place is nobody's");
  assert.equal(ix.byBoxer.size, 1, "a fighter we do not hold has no page to put it on");
});

test("rows from anyone but the four bodies are ignored, and a belt type outside the three is not guessed", () => {
  const ix = buildOfficial([row({ body: "THE RING", kind: "champion", position: 0, boxer_id: 1 }), row({ body: "WBA", kind: "champion", position: 0, boxer_id: 2, title_type: "super" })]);
  assert.equal(ix.byDivision.get(officialKey("male", "Heavyweight"))!.length, 1);
  assert.equal(ix.byDivision.get(officialKey("male", "Heavyweight"))![0].champions[0].titleType, null);
  assert.equal(ix.byBoxer.has(1), false);
});
