import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SLUG, slugify } from "../lib/slug";

/** A slug is the address of a page. The cap exists for feed slips (a 300-letter name); every real name is far under it, so no existing address may change. */
test("ordinary names make the same addresses as ever, accents and punctuation included", () => {
  assert.equal(slugify("Tyson Fury"), "tyson-fury");
  assert.equal(slugify("Saúl “Canelo” Álvarez"), "saul-canelo-alvarez");
  assert.equal(slugify("Côte d'Ivoire"), "cote-d-ivoire");
  assert.equal(slugify("  --Light Heavyweight--  "), "light-heavyweight");
  assert.equal(slugify("Oleksandr Usyk Jr. & Sons"), "oleksandr-usyk-jr-sons");
  const longRealName = "Maria de las Mercedes Guadalupe Fernanda Josefina Ortega y Gasset de la Vega Montenegro Iturbide";
  assert.ok(slugify(longRealName).length < MAX_SLUG && slugify(longRealName).endsWith("iturbide"), "a very long real name is whole");
});

test("a very long name is cut to the cap, at a word when one is near the end, and never ends in a hyphen", () => {
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const s = slugify(words);
  assert.ok(s.length <= MAX_SLUG, String(s.length)); assert.ok(!s.endsWith("-")); assert.ok(!s.startsWith("-"));
  assert.ok(words.split(" ").some((w) => s.endsWith(w)), "cut at a whole word");
  const one = slugify("W".repeat(300));
  assert.equal(one.length, MAX_SLUG, "a single word with no break is cut hard");
});

test("a name with no Latin letters makes an empty slug, as before: the caller supplies a fallback", () => {
  assert.equal(slugify("محمد 🥊 العلي"), "");
  assert.equal(slugify(""), "");
});
