import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** The motion rules of DESIGN.md as tests (round 119): everything that moves has a reduced-motion switch-off, and nothing is driven by scrolling. */
const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");

/** The text inside every `@media (prefers-reduced-motion: reduce) { ... }`, braces balanced. */
function reducedBlocks(src: string): string {
  const out: string[] = [];
  for (let at = src.indexOf("@media (prefers-reduced-motion: reduce)"); at >= 0; at = src.indexOf("@media (prefers-reduced-motion: reduce)", at + 1)) {
    let depth = 0, i = src.indexOf("{", at);
    const start = i + 1;
    for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}" && --depth === 0) break; }
    out.push(src.slice(start, i));
  }
  return out.join("\n");
}
/** Every rule (selector and body) outside the reduced-motion and print blocks that sets an animation. */
function animatedSelectors(src: string): string[] {
  const noMedia = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, " ");
  const found: string[] = [];
  for (const m of noMedia.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (/(^|[;\s])animation(-name)?\s*:/.test(m[2]) && !/@keyframes/.test(m[1])) found.push(m[1].trim());
  return found;
}

test("every class or element that animates is switched off for visitors who ask for reduced motion", () => {
  const off = reducedBlocks(css);
  const animated = animatedSelectors(css);
  assert.ok(animated.length >= 8, `the scan found the animated rules (${animated.length})`);
  for (const sel of animated) {
    for (const part of sel.split(",").map((s) => s.trim())) {
      if (part.startsWith("::view-transition")) continue; // switched off as a whole, asserted below
      const key = part.replace(/^html\[dir="rtl"\]\s*/, "").replace(/\[open\]|::backdrop|:hover|:active/g, "").replace(/^\./, "").split(/[\s.:[]/)[0];
      assert.ok(key && off.includes(key), `${part}: no reduced-motion rule mentions "${key}"`);
    }
  }
  assert.match(off, /::view-transition-old\(\*\)/, "the page transition is off too");
  assert.match(off, /transition-duration/, "and every CSS transition is instant");
});

test("nothing animates on scroll (DESIGN.md): no scroll-driven CSS, no observer-driven reveal", () => {
  assert.ok(!/animation-timeline|scroll-timeline|view-timeline/.test(css), "no scroll-driven animation in the stylesheet");
  const walk = (d: string): string[] => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() && e.name !== "node_modules" ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []);
  for (const f of [...walk("app"), ...walk("components"), ...walk("lib")]) assert.ok(!/IntersectionObserver/.test(fs.readFileSync(path.join(root, f), "utf8")), `${f} reveals on scroll`);
});

test("the route transition and the progress bar are wired as designed (round 119)", () => {
  const tpl = fs.readFileSync(path.join(root, "app/[locale]/template.tsx"), "utf8");
  assert.match(tpl, /<ViewTransition enter="page-in" exit="page-out" default="none">/, "a template, because a layout is not made again and the page could never enter or leave");
  assert.match(css, /::view-transition-new\(\.page-in\)/); assert.match(css, /::view-transition-old\(\.page-out\)/);
  const bar = fs.readFileSync(path.join(root, "components/NavProgress.tsx"), "utf8");
  assert.match(bar, /addEventListener\("click", onClick, true\)/, "listening while the event is captured: <Link> has cancelled the click by the time a bubbling listener runs");
  assert.match(bar, /aria-hidden="true"/, "decoration only");
  assert.match(bar, /metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/, "a modified click opens a tab: no bar");
  const layout = fs.readFileSync(path.join(root, "app/[locale]/layout.tsx"), "utf8");
  assert.match(layout, /<NavProgress \/>/);
});

test("every list of weight classes shown on a page starts with heavyweight (round 119)", async () => {
  const { DIVISIONS, DIVISIONS_HEAVIEST_FIRST, DIVISION_NAMES_HEAVIEST_FIRST } = await import("../lib/divisions");
  assert.equal(DIVISIONS_HEAVIEST_FIRST[0].name, "Heavyweight"); assert.equal(DIVISION_NAMES_HEAVIEST_FIRST.at(-1), "Minimumweight");
  assert.equal(DIVISIONS[0].name, "Minimumweight", "the canonical order, which the logic indexes, is untouched");
  for (const f of ["app/[locale]/boxers/page.tsx", "app/[locale]/page.tsx", "app/[locale]/titles/page.tsx", "app/[locale]/rankings/page.tsx", "app/[locale]/rankings/[division]/page.tsx", "app/[locale]/developers/page.tsx", "components/RecordsFilter.tsx"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.match(src, /DIVISIONS_HEAVIEST_FIRST|DIVISION_NAMES_HEAVIEST_FIRST/, `${f} lists divisions heaviest first`);
    assert.ok(!/\{DIVISIONS\.(map|filter)|DIVISION_NAMES\.map/.test(src), `${f} does not list them lightest first`);
  }
  assert.match(fs.readFileSync(path.join(root, "app/[locale]/weights/page.tsx"), "utf8"), /\.reverse\(\)/);
});
