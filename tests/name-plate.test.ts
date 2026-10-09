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

test("the plate's type is sized with the width the heavy condensed capitals really have: 0.53 em a letter, measured in a browser (GRANNUM at 57 px was 210 px in a 200 px block and was cut off) (round 137)", async () => {
  const { plateOf } = await import("../lib/name-plate");
  for (const [name, size] of [["Jordan Grannum", 200], ["Anthony Whyte", 200], ["Lawrence Okolie", 110], ["Moses Itauma", 64], ["Oleksandr Usyk", 200]] as const) {
    const p = plateOf(name, size);
    if (p.kind === "surname") assert.ok(p.text.length * p.fontSize * 0.53 <= size * 0.88 + 0.5, `${p.text} at ${p.fontSize}px must fit in ${size * 0.88}px with the measured letter width`);
  }
});

test("in the Arabic pages the capitals are set in Tajawal, 0.675 em a letter measured (GRANNUM at 44 px was 208 px in a 200 px block), so the plate allows more room (round 137)", async () => {
  const { plateOf } = await import("../lib/name-plate");
  for (const [name, size] of [["Jordan Grannum", 200], ["Anthony Whyte", 200], ["Lawrence Okolie", 110]] as const) {
    const p = plateOf(name, size, "ar");
    if (p.kind === "surname") assert.ok(p.text.length * p.fontSize * 0.675 <= size * 0.88 + 0.5, `${p.text} at ${p.fontSize}px must fit in ${size * 0.88}px in Tajawal`);
  }
  assert.ok(plateOf("Jordan Grannum", 200, "ar").fontSize < plateOf("Jordan Grannum", 200, "en").fontSize, "smaller than the English one");
});
