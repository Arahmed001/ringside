import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Source rules from the design review (docs/design-review.md): colour and type come from the tokens in DESIGN.md / app/globals.css, so a new component
 * cannot quietly bring its own. Nothing here looks at pixels.
 */
const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const sources = [...walk("app"), ...walk("components")].filter((f) => /\.tsx?$/.test(f));

const css = read("app/globals.css");
/** The :root colour tokens (the dark palette, the only one on screen). */
const rootBlock = css.match(/:root\s*\{([^}]*)\}/)![1];
const TOKENS = new Set([...rootBlock.matchAll(/--[\w-]+:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase()));

test("the colour tokens in globals.css are the ones DESIGN.md names", () => {
  for (const hex of ["#09090b", "#131318", "#1a1a21", "#26262f", "#ecebe6", "#8d8d99", "#e5322d", "#4a8cff", "#d9b25f", "#3ecf8e", "#ff5a54", "#c9261f", "#555560", "#c9c9d1", "#15151b", "#b8923f", "#e8c97d", "#a67f30"]) assert.ok(TOKENS.has(hex), `${hex} is no longer a token`);
});

test("no Tailwind default-palette colour (text-gray-500, bg-zinc-900 ...) and no arbitrary colour class (bg-[#123456]): colours are tokens", () => {
  const palette = /\b(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
  const arbitrary = /\b(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|accent|caret)-\[(?:#|rgb|hsl)/;
  for (const f of sources) {
    const src = read(f);
    assert.ok(!palette.test(src), `${f} uses a default-palette colour class`);
    assert.ok(!arbitrary.test(src), `${f} uses an arbitrary colour class`);
  }
});

/**
 * Hex colours written straight into a component. Charts and art have to (an SVG attribute cannot take a Tailwind class), and most of those are the tokens
 * themselves. These are the files that still carry a colour that is NOT a token, with how many: the number may go down, never up, and a new file may not
 * join. What is left is the generated art, the light embed theme and the last-resort error page (docs/design-review.md, O1 and O10: the greys, gold tints and archetype reuse that were on this list are now tokens or token colours).
 */
const OFF_TOKEN_ALLOWED: Record<string, number> = {
  "app/global-error.tsx": 4,
  "components/EmbedFrame.tsx": 9,
  "components/PortraitArt.tsx": 999, // generated illustration: skin, hair and background palettes
  "components/Poster.tsx": 999, // generated poster art
};
test("a hex colour in a component is a design token, or the file is on the reviewed list", () => {
  const hexes = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
  for (const f of sources) {
    const rel = f.split(path.sep).join("/");
    const off = (read(f).match(hexes) ?? []).filter((h) => {
      const x = h.toLowerCase();
      if (x === "#fff" || x === "#ffffff" || x === "#000") return false; // white and black on art and chart marks
      return !TOKENS.has(x.length === 4 ? `#${x[1]}${x[1]}${x[2]}${x[2]}${x[3]}${x[3]}` : x);
    });
    if (!off.length) continue;
    const allowed = OFF_TOKEN_ALLOWED[rel];
    assert.ok(allowed !== undefined, `${rel} has off-token colours (${[...new Set(off)].join(", ")}): use a token from app/globals.css, or have the design owner approve it`);
    assert.ok(off.length <= allowed, `${rel} has ${off.length} off-token colours, ${allowed} are reviewed`);
  }
});

test("fonts come from the three font variables: no font-family with a literal face in a component", () => {
  const ok = new Set(["app/global-error.tsx"]); // the last-resort error page cannot load the site's fonts
  for (const f of sources) {
    const rel = f.split(path.sep).join("/");
    if (ok.has(rel)) continue;
    for (const m of read(f).matchAll(/font-?[Ff]amily["']?\s*[:=]\s*["'`{]?\s*([^;,}`"']+)/g)) {
      assert.ok(/^var\(--font-(body|display|serif|arabic|arabic-display|arabic-serif)/.test(m[1].trim()) || /^var\(/.test(m[1].trim()), `${rel} sets a literal font-family: ${m[1].trim()}`);
    }
  }
});
