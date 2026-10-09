import test from "node:test";
import assert from "node:assert/strict";
import { plateOf } from "../lib/name-plate";

test("a big block carries the surname in capitals, sized to fit on one line", () => {
  const p = plateOf("Saul Alvarez", 120);
  assert.equal(p.kind, "surname");
  assert.equal(p.text, "ALVAREZ");
  assert.ok(p.fontSize * 0.44 * 7 <= 120);
  assert.ok(p.fontSize <= 120 * 0.34);
});

test("a long surname gets smaller type, a short one is capped", () => {
  assert.ok(plateOf("A Oleksandr Usyk-Zakharchenko", 140).fontSize < plateOf("Li Wu", 140).fontSize);
  assert.equal(plateOf("Li Wu", 140).fontSize, Math.floor(140 * 0.34));
});

test("a small block falls back to the initials", () => {
  const p = plateOf("Tomas Villalba", 40);
  assert.deepEqual([p.kind, p.text], ["initials", "TV"]);
});

test("one name, accents, and an empty name do not break it", () => {
  assert.equal(plateOf("Canelo", 120).text, "CANELO");
  assert.equal(plateOf("Tomás Ñandú", 120).text, "ÑANDÚ");
  assert.equal(plateOf("", 120).kind, "initials");
  assert.equal(plateOf("", 120).text, "?");
});
