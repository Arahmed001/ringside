import test from "node:test";
import assert from "node:assert/strict";
import { first, sectionHref } from "../lib/section-page";

/** A page with several long lists gives each its own query key; the others keep the page they are on. */
test("page 1 of a list has no key, and the first page of the whole page is the plain address", () => {
  assert.equal(sectionHref("/orgs/a", {}, "events", 1), "/orgs/a");
  assert.equal(sectionHref("/orgs/a", {}, "events", 2), "/orgs/a?events=2");
  assert.equal(sectionHref("/orgs/a", { events: "5" }, "events", 1), "/orgs/a", "going back to page 1 drops the key");
});

test("the other lists keep their page when one list turns a page", () => {
  const q = { fighters: "3", events: "2" };
  assert.equal(sectionHref("/orgs/a", q, "events", 4), "/orgs/a?fighters=3&events=4");
  assert.equal(sectionHref("/orgs/a", q, "fighters", 1), "/orgs/a?events=2");
  assert.equal(sectionHref("/orgs/a", q, "fights", 2), "/orgs/a?fighters=3&events=2&fights=2");
});

test("a repeated key takes the first, a missing or empty value is dropped, and the page of the list being changed is replaced", () => {
  assert.equal(first(["2", "3"]), "2");
  assert.equal(first(undefined), undefined);
  assert.equal(sectionHref("/p", { events: ["7", "8"], x: undefined, y: "" }, "stable", 2), "/p?events=7&stable=2");
  assert.equal(sectionHref("/p", { stable: ["9", "9"] }, "stable", 3), "/p?stable=3");
});

test("values with characters that need escaping stay one value", () => {
  assert.equal(sectionHref("/p", { q: "a&b=c d" }, "page", 2), "/p?q=a%26b%3Dc+d&page=2");
});
