import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDivision } from "../lib/divisions";
import { divisionOf, placeBouts, type Notes } from "../lib/providers/boxing-data-api";

/** Division names as a real feed writes them. A name read wrongly puts a fighter in the wrong rankings; one not read at all drops the fighter and every fight of his. */
test("a women's or female prefix and a limit in brackets are not part of the division", () => {
  for (const [raw, want] of [["Women's Featherweight", "Featherweight"], ["Womens Flyweight", "Flyweight"], ["Female Super Bantamweight", "Super Bantamweight"], ["Super Light (140)", "Super Lightweight"],
    ["Featherweight (126 lbs)", "Featherweight"], ["Heavyweight (200+)", "Heavyweight"], ["Cruiserweight (200 lbs)", "Cruiserweight"], ["Men's Welterweight", "Welterweight"]] as const)
    assert.equal(normalizeDivision(raw), want, raw);
});

test("'over 200 lbs' is the heavyweight limit, not the cruiserweight one that a plain 200 lb names", () => {
  assert.equal(normalizeDivision("Over 200 lbs"), "Heavyweight");
  assert.equal(normalizeDivision("200+ lbs"), "Heavyweight");
  assert.equal(normalizeDivision("Above 200 lb"), "Heavyweight");
  assert.equal(normalizeDivision("200 lbs"), "Cruiserweight", "a plain 200 lb limit is still cruiserweight");
});

test("what was read before is read as before; what is no division stays null", () => {
  assert.equal(normalizeDivision("Jr. Welterweight"), "Super Lightweight");
  assert.equal(normalizeDivision("154lbs"), "Super Welterweight");
  for (const raw of ["Catchweight", "Open weight", "Unknown", ""]) assert.equal(normalizeDivision(raw), null, raw);
  assert.equal(normalizeDivision("Bridgerweight"), null, "the champions importer keeps Bridgerweight's lineage apart from Heavyweight's");
});

test("for a fighter or a fight Bridgerweight and Super Heavyweight are Heavyweight, so they are not dropped", () => {
  assert.equal(divisionOf("Bridgerweight"), "Heavyweight");
  assert.equal(divisionOf("Super Heavyweight"), "Heavyweight");
  assert.equal(divisionOf("super-heavy"), "Heavyweight");
  assert.equal(divisionOf("Welterweight"), "Welterweight");
  assert.equal(divisionOf("Catchweight"), null);
});

const notes = () => ({ boutDivisionFromFighters: 0 }) as Notes;
const bout = (id: string, red: string, blue: string, weightClass: string) => ({ externalId: id, redExternalId: red, blueExternalId: blue, weightClass }) as never;
const boxer = (id: string, weightClass: string) => ({ externalId: id, weightClass }) as never;

test("a catchweight fight is kept, in the heavier of its fighters' divisions, and counted", () => {
  const n = notes();
  const out = placeBouts([bout("b1", "a", "b", "Catchweight"), bout("b2", "a", "c", "Open weight"), bout("b3", "a", "b", "Welterweight")], [boxer("a", "Welterweight"), boxer("b", "Super Welterweight"), boxer("c", "Unknown")], n) as { weightClass: string }[];
  assert.deepEqual(out.map((x) => x.weightClass), ["Super Welterweight", "Welterweight", "Welterweight"], "b1 takes the heavier of the two; b2 the one fighter that has a division; b3 was already known");
  assert.equal(n.boutDivisionFromFighters, 2, "only the two it placed are counted");
});

test("a fight where neither fighter has a division is left as it is (the validator reports it)", () => {
  const n = notes();
  const out = placeBouts([bout("b1", "x", "y", "Catchweight")], [boxer("x", "Unknown"), boxer("y", "Unknown")], n) as { weightClass: string }[];
  assert.equal(out[0].weightClass, "Catchweight"); assert.equal(n.boutDivisionFromFighters, 0);
});
