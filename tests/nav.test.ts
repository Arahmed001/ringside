import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NAV_GROUPS, NAV_KEY, OFF_NAV } from "../lib/nav";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const AR = JSON.parse(read("i18n/ar.json")) as Record<string, unknown>;
const items = NAV_GROUPS.flatMap((g) => g.items);

test("every link in the navigation is a real page, listed once", () => {
  const hrefs = items.map((i) => i.href);
  assert.equal(new Set(hrefs).size, hrefs.length, "a page is listed twice");
  for (const h of hrefs) assert.ok(fs.existsSync(path.join(root, "app/[locale]", h, "page.tsx")), `${h} has no page`);
});

test("no section with an index page is missing from the navigation", () => {
  const dirs = fs.readdirSync(path.join(root, "app/[locale]"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("[") && fs.existsSync(path.join(root, "app/[locale]", d.name, "page.tsx"))).map((d) => `/${d.name}`);
  const linked = new Set(items.map((i) => i.href));
  assert.deepEqual(dirs.filter((d) => !linked.has(d) && !OFF_NAV.includes(d)), [], "add these to lib/nav.ts");
});

test("groups, labels and icons are complete, and everything has Arabic", () => {
  const ids = new Set<string>();
  for (const g of NAV_GROUPS) {
    assert.ok(g.items.length > 0 && !ids.has(g.id), g.id); ids.add(g.id);
    for (const s of [g.title, ...g.items.map((i) => i.label)]) assert.ok(typeof AR[s] === "string" && AR[s] !== s, `no Arabic for "${s}"`);
  }
  for (const s of ["Menu", "Close menu", "Collapse menu", "Expand menu", "Main"]) assert.ok(typeof AR[s] === "string", s);
  const icons = read("components/NavIcons.tsx");
  for (const i of items) assert.ok(new RegExp(`(^|\\s|")${i.icon}"?:`).test(icons), `no icon ${i.icon}`);
});

test("a collapsed rail hides labels visually, never with display:none, so links keep their names", () => {
  const css = read("app/globals.css");
  const rules = [...css.matchAll(/\.rail-collapsible\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(rules.length >= 2, "both collapsed rules exist");
  for (const r of rules) { assert.ok(/clip:\s*rect\(0/.test(r), r); assert.ok(!/display:\s*none/.test(r), r); }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.rail\b/);
});

test("the saved choice is read before paint and written by the toggle under the same key and values", () => {
  const layout = read("app/[locale]/layout.tsx"), controls = read("components/RailControls.tsx");
  assert.match(layout, /suppressHydrationWarning/);
  assert.match(layout, /<InlineScript nonce=\{nonce\} html=\{`try\{var n=localStorage\.getItem\("\$\{NAV_KEY\}"\)/);
  assert.equal(NAV_KEY, "ringside-nav");
  assert.match(controls, /localStorage\.setItem\(NAV_KEY, next \? "expanded" : "collapsed"\)/);
  assert.match(layout, /<NavGroups id="side-nav" \/>/);
  assert.match(controls, /aria-controls="side-nav"/);
  assert.match(controls, /aria-expanded=\{open \?\? undefined\}/);
});

test("the phone drawer is a native modal dialog that closes on Esc, the backdrop, a link and growing past the phone layout", () => {
  const c = read("components/RailControls.tsx");
  assert.match(c, /<dialog/); assert.match(c, /showModal\(\)/);
  assert.match(c, /e\.target === dialog\.current/); assert.match(c, /closest\("a"\)/);
  assert.match(c, /min-width: 1024px/);
});

test("the design lab cannot be reached in a production build", () => {
  const src = fs.readFileSync(path.join(root, "app/[locale]/design/home/page.tsx"), "utf8");
  assert.match(src, /NODE_ENV === "production" && process\.env\.DESIGN_LAB !== "1"\) notFound\(\)/, "the lab must 404 in production unless DESIGN_LAB=1");
  assert.match(src, /robots: \{ index: false/, "and stay out of search results when it is on");
  assert.ok(!NAV_GROUPS.some((g) => g.items.some((i) => i.href.startsWith("/design"))), "it is not in the navigation");
});
