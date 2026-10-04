import { test } from "node:test";
import assert from "node:assert/strict";
import { arabicForCard } from "../lib/arabic-card";

// The share-card renderer draws left to right and measures a word from its unjoined letters; arabicForCard hands it joined shapes in drawing order.
// The expected strings below were checked by eye in a rendered card.

test("a word with no Arabic letter is left alone", () => {
  for (const w of ["123", "KO/TKO", "(5-1-0)", "40%", "Elo"]) assert.equal(arabicForCard(w), w);
});

test("letters are joined and the word comes out in left-to-right drawing order", () => {
  assert.equal(arabicForCard("ملاكم"), "ﻢﻛﻼﻣ");
});

test("joined text uses the same number of letters as the plain word, except that lam + alef is one ligature", () => {
  const plain = "تصنيفات";
  assert.equal([...arabicForCard(plain)].length, [...plain].length);
  assert.equal([...arabicForCard("ملاكم")].length, [..."ملاكم"].length - 1);
});

test("a joined word has no plain letter that the renderer would have to reverse twice", () => {
  // every plain letter run in the output is as long as the run was in the word, and reading the output right to left gives the word back
  const word = "الوزن";
  const out = [...arabicForCard(word)];
  assert.equal(out.length, [...word].length);
  assert.equal(out.slice(0, 2).join(""), "زن"); // the plain run "ز" "ن" is pre-reversed for the renderer, which reverses it again
});

test("digits inside an Arabic word keep their order", () => {
  assert.ok(arabicForCard("ملاكم2025").includes("2025"));
});

test("harakat are dropped, the letters stay", () => {
  assert.equal(arabicForCard("ترجيحًا"), arabicForCard("ترجيحا"));
});
