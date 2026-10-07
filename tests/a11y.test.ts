import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const sources = [...walk("app"), ...walk("components")].filter((f) => /\.tsx$/.test(f));

const css = read("app/globals.css");
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1];
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test("text colours reach 4.5:1 on every surface they sit on (WCAG AA)", () => {
  for (const bg of ["bg", "panel", "panel-2"]) {
    for (const fg of ["text", "muted", "red-ink", "gold", "blue", "green"]) {
      assert.ok(ratio(token(fg), token(bg)) >= 4.5, `${fg} on ${bg} is ${ratio(token(fg), token(bg)).toFixed(2)}:1`);
    }
  }
  assert.ok(ratio("#ffffff", token("red-btn")) >= 4.5, "white on the red button fill");
  assert.ok(ratio(token("gold"), "#09090b") >= 4.5 && ratio("#09090b", token("gold")) >= 4.5, "skip link: dark text on gold");
  // the brand red stays for fills and large type only: it is under 4.5:1 as small text on the panels
  assert.ok(ratio(token("red"), token("panel-2")) < 4.5);
});

test("small red text uses the text-safe red, and red buttons use the darker fill", () => {
  for (const f of sources) {
    const s = read(f);
    assert.ok(!/(^|[^a-z-])text-red([^-a-z]|$)/.test(s.replace(/text-red\//g, "")), `${f}: use text-red-ink for text`);
    for (const line of s.split("\n")) if (/<button[^>]*\bbg-red\b[^-]/.test(line)) assert.fail(`${f}: red buttons need bg-red-btn with white text`);
  }
});

test("no text under 12px in the stylesheet either: every font-size in app/globals.css that is a plain length is 12px or more (found in the overnight phone sweep: .eyebrow was .72rem, 11.5px, on every page, and neither axe nor the class scan below looks at a stylesheet rule)", () => {
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)].map((m) => ({ at: m[0], px: m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]) }));
  assert.ok(sizes.length >= 3, "the scan found the sizes");
  assert.deepEqual(sizes.filter((x) => x.px < 12).map((x) => x.at), []);
});

test("no text under 12px", () => {
  for (const f of sources) assert.ok(!/text-\[(9|10|11)px\]/.test(read(f)), `${f} has text under 12px`);
});

test("no text under 12px inside a chart either: SVG text sizes are 12 or more (the poster, which is art, and the share image are the exceptions)", () => {
  // SVG text scales with the picture, so a size in the chart's own units is only a lower bound on what is drawn; the browser sweep (docs/accessibility.md) measures the rendered size
  const small: string[] = [];
  for (const f of sources) {
    if (/Poster\.tsx$/.test(f)) continue;
    for (const m of read(f).matchAll(/fontSize=(?:\{)?["']?(\d+(?:\.\d+)?)/g)) if (Number(m[1]) < 12) small.push(`${f}: fontSize ${m[1]}`);
  }
  assert.deepEqual(small, []);
});

test("a box that scrolls sideways is a ScrollRegion (focusable, so a keyboard can scroll it), unless everything in it is a link", () => {
  // The only places that may scroll sideways without one: rows of links, which a keyboard already reaches with Tab.
  const OK = [/components\/ScrollRegion\.tsx$/, /rankings\/\[division\]\/page\.tsx$/, /components\/TenureTable\.tsx$/, /components\/TrainerImpactCard\.tsx$/, /\[locale\]\/page\.tsx$/, /components\/JumpNav\.tsx$/ /* a row of links */];
  const bad = sources.filter((f) => /overflow-x-auto/.test(read(f)) && !OK.some((re) => re.test(f)));
  assert.deepEqual(bad, [], "wrap the table in <ScrollRegion label=…> (components/ScrollRegion.tsx), or add the file here if every cell in it is a link");
});

test("every page has a level-one heading, and the layout has a skip link to the main landmark", () => {
  for (const f of sources.filter((x) => /app\/\[locale\]\/.*page\.tsx$/.test(x) && !x.includes("[...rest]"))) assert.ok(/<h1\b/.test(read(f)), `${f} has no <h1>`);
  const layout = read("app/[locale]/layout.tsx");
  assert.match(layout, /href="#main"/);
  assert.match(layout, /<main id="main"/);
  assert.match(css, /\.skip-link:focus/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline/);
});

test("motion is switched off for visitors who ask for reduced motion", () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)![0];
  for (const cls of [".rise", ".draw", ".growx", ".growy", ".live"]) assert.ok(block.includes(cls), `${cls} still animates`);
  assert.match(block, /transition-duration/);
});

test("the new labels exist in Arabic", () => {
  const ar = JSON.parse(read("i18n/ar.json")) as Record<string, unknown>;
  for (const k of ["Skip to content", "Show as a list", "Show the map", "From {first} to {last}, peak {peak}"]) assert.ok(typeof ar[k] === "string" && ar[k] !== k, k);
});

test("every table has a name, every text input has a label, and every svg is described or hidden", () => {
  for (const f of sources) {
    const s = read(f);
    for (const m of s.matchAll(/<table\b[^>]*>/g)) {
      const after = s.slice(m.index! + m[0].length, m.index! + m[0].length + 240);
      assert.ok(/aria-label|aria-labelledby/.test(m[0]) || after.includes("<caption"), `${f}: a <table> with no name (${m[0].slice(0, 60)})`);
    }
    for (const m of s.matchAll(/<input\b(?:=>|[^>])*>/g)) {
      if (/type="hidden"/.test(m[0])) continue;
      const around = s.slice(Math.max(0, m.index! - 300), m.index! + m[0].length + 60);
      assert.ok(/aria-label|aria-labelledby/.test(m[0]) || /<label\b|<Field\b[^>]*label=/.test(around), `${f}: an <input> with no label (${m[0].slice(0, 60)})`);
    }
    for (const m of s.matchAll(/<svg\b[^>]*>/g)) assert.ok(/aria-hidden|role=|aria-label|\{\.\.\./.test(m[0]), `${f}: an <svg> that is neither described nor hidden`);
  }
});

test("screen-reader-only text inside a scrolling table cannot widen the page, and small controls keep a 24px hit area", () => {
  // .sr-only is absolutely positioned: with no positioned ancestor it escapes an overflow container and stretches the whole page sideways (the heatmap did this at 320 px)
  assert.match(read("components/ChartI18n.tsx"), /<td[^>]*className="relative /);
  assert.match(css, /input\[type="range"\]\.rs \{[^}]*height: 24px/);
  assert.match(css, /::-webkit-slider-thumb \{[^}]*width: 24px; height: 24px/);
});

test("poster header text stays readable on every generated colour scheme", async () => {
  const { POSTER_HUES, textContrast } = await import("../lib/poster-colors");
  const lines: [string, number, (hue: [string, string, string]) => [string, number]][] = [
    ["event or title line (13px, accent)", 38, (h) => [h[2], 1]],
    ["weight and rounds line (11px, white at 85%)", 58, () => ["#ffffff", 0.85]],
    ["postponed notice (12px, gold)", 78, () => ["#ffd36a", 1]],
  ];
  for (const hue of POSTER_HUES) for (const [name, y, f] of lines) {
    const [fill, op] = f(hue);
    assert.ok(textContrast(hue, y, fill, op) >= 4.5, `${name} on ${hue[0]} is ${textContrast(hue, y, fill, op).toFixed(2)}:1`);
  }
  // the same check must be able to fail: without the scrim the old numbers come back (2.4:1 measured on a rendered poster)
  const { HEADER_SCRIM } = await import("../lib/poster-colors");
  assert.ok(HEADER_SCRIM.stops[0][1] >= 0.5);
});

test("a scroll box is focusable and named, and is a group rather than a region (a region named like its section fails landmark-unique)", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { ScrollRegion } = await import("../components/ScrollRegion");
  const html = renderToStaticMarkup(createElement(ScrollRegion, { label: "Standings", className: "card", children: createElement("table") }));
  assert.match(html, /tabindex="0"/);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-label="Standings"/);
  assert.match(html, /class="overflow-x-auto card"/);
  assert.ok(!/role="region"/.test(html));
});

// ---- regressions for what the axe-core sweep of 2026-10-04 found (34 nodes on four rules, all fixed). Source-level, like the checks above: a rendered check needs
// a browser, and `npm run smoke` renders every kind of page but does not run axe. If these ever start to fail, run axe over the pages again before changing them.

test("the search palette's listbox holds only options: its messages sit outside it as paragraphs (axe: aria-required-children, listitem)", () => {
  const src = read("components/CommandPalette.tsx");
  const list = src.slice(src.indexOf('role="listbox"'));
  const block = list.slice(0, list.indexOf("</ul>"));
  const items = block.match(/<li\b[^>]*>/g) ?? [];
  assert.ok(items.length > 0, "the listbox still has its results");
  for (const li of items) assert.match(li, /role="(option|presentation)"/, `a list item in the listbox is neither an option nor a presentational group heading: ${li}`);
  assert.match(src, /<p className="[^"]*">\{t\("Nothing matches that\."\)\}<\/p>/, "the empty message is a paragraph");
  assert.match(src, /<p className="[^"]*">\{t\("Searching…"\)\}<\/p>/, "so is the searching message");
  assert.match(src, /role="status" aria-live="polite"/, "and a polite status still announces them");
});

test("a bare div is not given an aria-label: it needs a role first (axe: aria-prohibited-attr); the last-five-results row is a group, and is not drawn when empty", () => {
  for (const f of sources) {
    for (const [i, line] of read(f).split("\n").entries()) {
      const tag = line.match(/<div\b[^>]*\baria-label=[^>]*>/)?.[0];
      if (tag && !/\brole=/.test(tag)) assert.fail(`${f}:${i + 1} has a <div> with aria-label and no role: ${tag.slice(0, 120)}`);
    }
  }
  const prev = read("app/[locale]/previews/[id]/page.tsx");
  assert.match(prev, /f\.results\.length > 0 && <div[^>]*role="group"[^>]*aria-label=\{t\("Last five results"\)\}/);
});

test("a cancelled bout dims the headshots only: the card's text keeps full contrast, and the word Cancelled is still written (axe: color-contrast on the red chip)", () => {
  const src = read("app/[locale]/events/[id]/page.tsx");
  assert.doesNotMatch(src, /className=\{`card[^`]*\$\{cancelled \? "opacity/, "the whole card is not dimmed");
  assert.match(src, /<Headshot[^>]*className=\{cancelled \? "opacity-60" : ""\}/, "the headshots are");
  assert.match(src, /t\("Cancelled"\)/);
});

test("a division with nobody ranked draws no empty table, and says why (axe: empty table headers; a blank card is no answer)", () => {
  const src = read("app/[locale]/rankings/[division]/page.tsx");
  assert.match(src, /rows\.length > 0 && <table/);
  assert.match(src, /rows\.length === 0 && !typed/);
  assert.match(src, /has the five fights on record that a ranking needs yet/);
});

test("the rankings index never cuts a fighter's name or division off with an ellipsis, and a sorting heading and the event link above a fight keep a 24 px target (found in the round 129 phone sweep of other sessions' pages)", () => {
  const idx = read("app/[locale]/rankings/page.tsx");
  assert.ok(!/truncate/.test(idx), "the compact list lost 'Super Featherweight' to 'Super Fea…' on a phone; names and divisions wrap instead");
  assert.match(read("components/SortTh.tsx"), /min-h-6 min-w-6/, "the narrow # heading was 24 px wide and 32 high: at the limit, now with a floor");
  for (const f of ["app/[locale]/bouts/[id]/page.tsx", "app/[locale]/previews/[id]/page.tsx"]) assert.match(read(f), /className="-my-1\.5 inline-block py-1\.5 hover:text-ink"/, `${f}: the event link in the heading line is 24 px high (it was 12)`);
});

test("every playing-style colour is text-safe on the panels it is drawn on (the Journeyman chip was 3.3:1: axe on a real fighter's page, round 133)", async () => {
  const { ARCH_COLOR } = await import("../lib/style");
  for (const [style, colour] of Object.entries(ARCH_COLOR)) for (const bg of ["panel", "panel-2", "bg"]) assert.ok(ratio(colour, token(bg)) >= 4.5, `${style} ${colour} on ${bg} is ${ratio(colour, token(bg)).toFixed(2)}:1`);
});
