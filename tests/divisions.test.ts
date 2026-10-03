import test from "node:test";
import assert from "node:assert/strict";
import { DIVISIONS, divisionFromSlug, divisionLabel, limitLabel, normalizeDivision, slugifyDivision } from "../lib/divisions";

test("canonical names pass through", () => {
  for (const d of DIVISIONS) assert.equal(normalizeDivision(d.name), d.name);
});

test("vendor spellings map to the official division", () => {
  const cases: [string, string][] = [
    ["Jr. Welterweight", "Super Lightweight"], ["Light Welterweight", "Super Lightweight"], ["junior welterweight", "Super Lightweight"],
    ["Light-Middleweight", "Super Welterweight"], ["Super-Middle", "Super Middleweight"], ["Junior Lightweight", "Super Featherweight"],
    ["Jr Bantamweight", "Super Flyweight"], ["Light Heavy", "Light Heavyweight"], ["cruiser", "Cruiserweight"], ["Strawweight", "Minimumweight"],
    ["154 lbs", "Super Welterweight"], ["175 pounds", "Light Heavyweight"], ["HEAVYWEIGHT", "Heavyweight"],
  ];
  for (const [raw, want] of cases) assert.equal(normalizeDivision(raw), want, raw);
});

test("unknown strings are rejected, not guessed", () => {
  for (const raw of ["", "Catchweight", "Open class", "Super Duper", "133 lbs"]) assert.equal(normalizeDivision(raw), null, raw);
});

test("limits and slugs", () => {
  assert.equal(limitLabel(DIVISIONS.find((d) => d.name === "Welterweight")!), "147 lb · 66.7 kg");
  assert.equal(limitLabel(DIVISIONS.at(-1)!), "Over 200 lb");
  assert.equal(slugifyDivision("Super Middleweight"), "super-middleweight");
  assert.equal(divisionFromSlug("light-heavyweight")?.name, "Light Heavyweight");
  assert.equal(divisionFromSlug("nope"), undefined);
});

test("women's label keeps the division name", () => {
  assert.equal(divisionLabel("Flyweight", "female"), "Women's Flyweight");
  assert.equal(divisionLabel("Flyweight", "male"), "Flyweight");
});
