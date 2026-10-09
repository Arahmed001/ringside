import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** The jump strip of a fighter's page (round 123): every link points at a real section, nothing runs on scroll, and the strip sits under the top bar. */
const root = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const page = read("app/[locale]/boxers/[slug]/page.tsx");

test("every section the strip links to exists on the page, once, and the page leaves room above whatever it scrolls to for the sticky bars", () => {
  const strip = page.slice(page.indexOf("<JumpNav sections={["), page.indexOf("]} />", page.indexOf("<JumpNav sections={[")));
  const ids = [...strip.matchAll(/id: "([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["numbers", "highlights", "profile", "scouting", "form", "similar", "news", "videos", "posts", "record", "discussion"], "in page order");
  for (const id of ids) {
    assert.equal([...page.matchAll(new RegExp(`<section id="${id}"`, "g"))].length, 1, `#${id}: one section carries it`);
  }
  // the room is the page's scroll-padding, which also keeps a control that takes focus from the keyboard out from under the bars (WCAG 2.4.11: the browser suite found Tab
  // leaving controls hidden under the top bar and the strip, docs/e2e.md); a per-section scroll-mt on top of it would add the two together
  const css = read("app/globals.css");
  assert.match(css, /html \{ scroll-padding-top: 5rem; \}/, "the top bar is about 4rem");
  assert.match(css, /html:has\(\.jump-nav\) \{ scroll-padding-top: 8rem; \}/, "a fighter's page has the strip under it as well (about 107 px in all)");
  assert.ok(!/scroll-mt-/.test(page), "no section adds its own offset to the page's");
  assert.ok(page.indexOf("<JumpNav") < page.indexOf('<section id="numbers"'), "the strip comes before the sections it links to");
  assert.match(strip, /numbers && numbers\.fights >= 5/, "a conditional section is linked only when it is shown"); assert.match(strip, /hasHighlights/); assert.match(strip, /news\.length/);
});

test("the strip is plain anchors under the top bar, shown only with three links or more, and not printed", () => {
  const c = read("components/JumpNav.tsx");
  assert.match(c, /href=\{`#\$\{s\.id\}`\}/); assert.match(c, /sections\.length < 3\) return null/); assert.match(c, /sticky top-\[3\.9rem\]/); assert.match(c, /no-print/);
  assert.match(c, /aria-label=\{t\("On this page"\)\}/); assert.ok(!/"use client"|useEffect|IntersectionObserver|addEventListener/.test(c), "no script at all");
  const css = read("app/globals.css");
  assert.match(css, /prefers-reduced-motion: no-preference\) \{ html:has\(\.jump-nav\) \{ scroll-behavior: smooth/, "the glide is only for visitors who have not asked for reduced motion");
});
