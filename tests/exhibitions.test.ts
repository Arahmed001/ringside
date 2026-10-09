import test from "node:test";
import assert from "node:assert/strict";
import { isExhibition } from "../lib/exhibitions";

test("a billed exhibition is recognised by date and the two names, in either order and ignoring accents and case", () => {
  assert.equal(isExhibition("2022-09-25", "Floyd Mayweather", "Mikuru Asakura"), true);
  assert.equal(isExhibition("2022-09-25", "mikuru asakura", "FLOYD MAYWEATHER"), true);
  assert.equal(isExhibition("2020-11-28", "Mike Tyson", "Roy Jones Jr."), true);
  assert.equal(isExhibition("2024-11-15", "Jake Paul", "Mike Tyson"), false, "a sanctioned professional fight is not on the list");
  assert.equal(isExhibition("2022-09-26", "Floyd Mayweather", "Mikuru Asakura"), false, "the date must match");
});
