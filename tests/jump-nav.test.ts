import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** The jump strip of a fighter's page (round 123): every link points at a real section, nothing runs on scroll, and the strip sits under the top bar. */
const root = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const page = read("app/[locale]/boxers/[slug]/page.tsx");

test("every section the strip links to exists on the page, once, with room above it for the strip", () => {
  const strip = page.slice(page.indexOf("<JumpNav sections={["), page.indexOf("]} />", page.indexOf("<JumpNav sections={[")));
  const ids = [...strip.matchAll(/id: "([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["numbers", "highlights", "profile", "scouting", "form", "similar", "record", "discussion"], "in page order");
  for (const id of ids) {
    const found = [...page.matchAll(new RegExp(`<section id="${id}" className="[^"]*scroll-mt-32`, "g"))];
    assert.equal(found.length, 1, `#${id}: one section carries it, with scroll-mt-32 (the strip is about 107 px under the top of the window)`);
  }
  assert.ok(page.indexOf("<JumpNav") < page.indexOf('<section id="numbers"'), "the strip comes before the sections it links to");
  assert.match(strip, /numbers && numbers\.fights >= 5/, "a conditional section is linked only when it is shown"); assert.match(strip, /hasHighlights/);
});

test("the strip is plain anchors under the top bar, shown only with three links or more, and not printed", () => {
  const c = read("components/JumpNav.tsx");
  assert.match(c, /href=\{`#\$\{s\.id\}`\}/); assert.match(c, /sections\.length < 3\) return null/); assert.match(c, /sticky top-\[3\.9rem\]/); assert.match(c, /no-print/);
  assert.match(c, /aria-label=\{t\("On this page"\)\}/); assert.ok(!/"use client"|useEffect|IntersectionObserver|addEventListener/.test(c), "no script at all");
  const css = read("app/globals.css");
  assert.match(css, /prefers-reduced-motion: no-preference\) \{ html:has\(\.jump-nav\) \{ scroll-behavior: smooth/, "the glide is only for visitors who have not asked for reduced motion");
});
