import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { beltNameAr, bodyNameAr, deriveName } from "../lib/i18n/belts";
import { makeT } from "../lib/i18n/t";
import { dictOf, tFor } from "../lib/i18n/dicts";
import { beltLabel, type Belt } from "../lib/lineage";

/** The 129 belt names of the first real cache (tests/fixtures/belt-names.json), in 19 shapes. */
const REAL: string[] = JSON.parse(fs.readFileSync("tests/fixtures/belt-names.json", "utf8"));
const ar = tFor("ar");
const AR = dictOf("ar");

test("every belt name in the first real cache has an Arabic form, with no English left but the body's code, and no two belts share one", () => {
  assert.equal(REAL.length, 129);
  const out = REAL.map((n) => ({ n, a: beltNameAr(n, ar) }));
  assert.deepEqual(out.filter((x) => x.a === null).map((x) => x.n), [], "none is left in English");
  const leftOver = out.filter((x) => /[A-Za-z]/.test(x.a!.replace(/\b(WBA|WBC|IBF|WBO)\b/g, "")));
  assert.deepEqual(leftOver.map((x) => `${x.n} => ${x.a}`), [], "no Latin letters other than the body code");
  // "WBA World Welterweight" and "WBA World Welterweight Champion" are one belt and read alike, so the names are not all different: the others are
  const byArabic = new Map<string, string[]>();
  for (const x of out) byArabic.set(x.a!, [...(byArabic.get(x.a!) ?? []), x.n]);
  for (const [a, ns] of byArabic) assert.ok(ns.length === 1 || (ns.length === 2 && ns.some((n) => n.endsWith(" Champion")) && ns.some((n) => !n.endsWith(" Champion"))), `${a} <= ${ns.join(" | ")}`);
});

test("the wording for each shape", () => {
  const cases: [string, string][] = [
    ["WBC World Welterweight Champion", "لقب WBC العالمي في وزن الويلتر"],
    ["WBC World Super Welterweight Champion", "لقب WBC العالمي في وزن فوق الويلتر"],
    ["WBA Super World Welterweight Champion", "لقب WBA العالمي «سوبر» في وزن الويلتر"],
    ["IBF Interim World Lightweight Champion", "لقب IBF العالمي المؤقت في الوزن الخفيف"],
    ["WBO World Junior Welterweight Champion", "لقب WBO العالمي في وزن فوق الخفيف"],
    ["WBO World Light heavyweight Champion", "لقب WBO العالمي في وزن نصف الثقيل"],
    ["WBA World Minimumweight", "لقب WBA العالمي في وزن القش"],
    ["The Ring Heavyweight Champion", "لقب «ذا رينغ» في الوزن الثقيل"],
    ["The Ring Strawweight Champion", "لقب «ذا رينغ» في وزن القش"],
  ];
  for (const [en, want] of cases) assert.equal(beltNameAr(en, ar), want, en);
  assert.equal(beltNameAr("WBA World Welterweight", ar), beltNameAr("WBA World Welterweight Champion", ar), "with or without 'Champion' it is the same belt");
});

test("what is not one of those shapes is left alone: another body, an unknown division, a name that is not a belt", () => {
  for (const n of ["OPBF Welterweight Champion", "WBC World Catchweight Champion", "WBC Silver World Welterweight Champion", "WBCX World Welterweight Champion", "Fury", "", "World Welterweight Champion", "wbc world welterweight champion"]) assert.equal(beltNameAr(n, ar), null, JSON.stringify(n));
});

test("a stored translation always wins, English is never touched, and only Arabic derives a name", () => {
  const stored = makeT("ar", AR, { "WBC World Welterweight Champion": "مكتوب بيد" }, deriveName);
  assert.equal(stored.name("WBC World Welterweight Champion"), "مكتوب بيد", "a name somebody wrote or reviewed wins");
  assert.equal(stored.name("WBC World Super Welterweight Champion"), "لقب WBC العالمي في وزن فوق الويلتر", "the others are derived");
  assert.equal(stored.name("Marcus Brightwell"), "Marcus Brightwell", "a name with nothing stored or derived is as written");
  const en = makeT("en", {}, {}, deriveName);
  assert.equal(en.name("WBC World Welterweight Champion"), "WBC World Welterweight Champion"); assert.equal(deriveName("World Boxing Council", en), null);
  assert.equal(makeT("ar", AR).name("WBC World Welterweight Champion"), "WBC World Welterweight Champion", "with no fallback given, nothing changes (every other caller)");
});

test("the five bodies' names, and a belt's label on the Titles pages in Arabic", () => {
  assert.equal(bodyNameAr("World Boxing Council"), "المجلس العالمي للملاكمة"); assert.equal(bodyNameAr("World Boxing Association"), "الاتحاد العالمي للملاكمة");
  assert.equal(bodyNameAr("International Boxing Federation"), "الاتحاد الدولي للملاكمة"); assert.equal(bodyNameAr("World Boxing Organization"), "المنظمة العالمية للملاكمة");
  assert.equal(bodyNameAr("The Ring"), "ذا رينغ"); assert.equal(bodyNameAr("Test Gym"), null);
  const belt = { orgName: "World Boxing Council", title: "WBC World Super Welterweight Champion" } as Belt;
  assert.equal(beltLabel(belt, ar), "المجلس العالمي للملاكمة · لقب WBC العالمي في وزن فوق الويلتر");
  assert.equal(beltLabel(belt, tFor("en")), "World Boxing Council · WBC World Super Welterweight Champion");
  assert.equal(beltLabel({ orgName: "Unsanctioned", title: "Some Title" } as Belt, ar), "Unsanctioned · Some Title", "an unknown belt is left as it is");
});
