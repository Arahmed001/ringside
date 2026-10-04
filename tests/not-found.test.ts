import test from "node:test";
import assert from "node:assert/strict";
import { nameFromPath } from "../lib/not-found";

/** A missed fighter address turns back into a name for the search; nothing else does, and nothing odd gets through. */
test("a fighter's address becomes words, in either language", () => {
  assert.equal(nameFromPath("/boxers/saul-alvarez"), "saul alvarez");
  assert.equal(nameFromPath("/ar/boxers/saul-alvarez"), "saul alvarez");
  assert.equal(nameFromPath("/boxers/saul-alvarez/"), "saul alvarez", "a trailing slash");
  assert.equal(nameFromPath("/boxers/saul-alvarez?x=1"), "saul alvarez", "a query string is not part of the name");
  assert.equal(nameFromPath("/boxers/jos%C3%A9-ram%C3%ADrez"), "josé ramírez", "an escaped accent");
  assert.equal(nameFromPath("/boxers/oleksandr_usyk.2"), "oleksandr usyk 2", "other separators");
});

test("any other address, an empty or odd slug, gives nothing", () => {
  for (const p of ["/", "/boxers", "/boxers/", "/events/12", "/boxers/a/b", "/people/someone", "/countries/atlantis", "/boxers/---", "/boxers/%E0%A4%A", "/en/boxers/x/y"]) assert.equal(nameFromPath(p), null, p);
  assert.equal(nameFromPath(`/boxers/${"a".repeat(61)}`), null, "too long to be a name");
  assert.equal(nameFromPath(`/boxers/${"a".repeat(60)}`), "a".repeat(60));
});

test("nothing in the slug but letters, digits and spaces reaches the search", () => {
  assert.equal(nameFromPath("/boxers/a-%3Cscript%3Ealert(1)%3C%2Fscript%3E"), "a scriptalert1script", "an escaped tag loses its brackets and slash");
  assert.equal(nameFromPath("/boxers/a-<script>alert(1)</script>"), null, "a raw slash makes it another address");
  assert.equal(nameFromPath("/boxers/a%27%20OR%201%3D1"), "a OR 11", "quotes and equals signs are dropped");
});

test("the smoke check fails a 404 that does not offer the fighter it should, in English only", async () => {
  const { problemsIn } = await import("../lib/smoke");
  const route = { path: "/boxers/noura-al-ghamd", kind: "missing", label: "x", mustShow: "Noura Al-Ghamdi" } as const;
  const page = (extra: string) => `<meta name="robots" content="noindex"><h1>Not on the card</h1>${extra}`;
  assert.deepEqual(problemsIn(route, "en", 404, "text/html", page("<a>Noura Al-Ghamdi</a>")), []);
  assert.equal(problemsIn(route, "en", 404, "text/html", page("")).length, 1, "nothing offered");
  assert.deepEqual(problemsIn(route, "ar", 404, "text/html", page("")), [], "the Arabic page offers the name in Arabic, so it is not held to the English");
});
