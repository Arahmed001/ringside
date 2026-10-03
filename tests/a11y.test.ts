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

test("no text under 12px", () => {
  for (const f of sources) assert.ok(!/text-\[(9|10|11)px\]/.test(read(f)), `${f} has text under 12px`);
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
