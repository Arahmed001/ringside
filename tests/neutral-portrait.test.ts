import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

/**
 * A real fighter with no licensed photo must not be given an invented face: the illustrated portraits (random skin, hair, beard, age) are for the fictional
 * demo league only. A real-data site serves a plain silhouette that depends on nothing about the person (DESIGN.md: generated art must never look like a real
 * person's likeness).
 */
const cleanup = tempDb("neutral-portrait");
after(cleanup);
type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let art: typeof import("../lib/art");
let route: typeof import("../app/api/art/portrait/[slug]/route");
const saved = process.env.BOXING_PROVIDER;
before(async () => {
  w = await (await import("../lib/world")).getWorld(); // the demo league: only its fighters' names and divisions are used
  art = await import("../lib/art");
  route = await import("../app/api/art/portrait/[slug]/route");
});
after(() => { if (saved === undefined) delete process.env.BOXING_PROVIDER; else process.env.BOXING_PROVIDER = saved; });

const FACE = /#f3cfae|#e6b48a|#cf9467|#a8714a|#80502f|#5c3822|<ellipse|stroke=/; // the skin tones, ears and brow and nose lines of the illustrated portrait

test("the demo league keeps its illustrated portraits", () => {
  delete process.env.BOXING_PROVIDER;
  assert.match(art.portraitSvg(w.boxers[0]), FACE);
});

test("a real-data site serves a neutral silhouette: no skin tone, no face, nothing that varies with the person", () => {
  process.env.BOXING_PROVIDER = "licensed";
  const bySlug = new Map<string, string>();
  for (const b of w.boxers.slice(0, 200)) {
    const svg = art.portraitSvg(b);
    assert.ok(!FACE.test(svg), `${b.slug}: must not draw a face`);
    assert.ok(svg.startsWith("<svg xmlns=") && svg.includes('viewBox="0 0 120 150"'), "same size as the illustrated portrait, so no layout changes");
    assert.ok(!/<text|var\(|<script|<foreignObject|href=|url\((?!#)/i.test(svg), "self-contained");
    assert.ok(svg.length < 1200, `${svg.length} bytes`);
    bySlug.set(b.slug, svg);
  }
  // it depends on the division and on nothing else about the fighter
  const sameDivision = w.boxers.filter((b) => b.weightClass === w.boxers[0].weightClass).slice(0, 5).map((b) => art.portraitSvg(b));
  assert.equal(new Set(sameDivision).size, 1, "two fighters in one division get the identical image");
  assert.ok(new Set(bySlug.values()).size > 1 && new Set(bySlug.values()).size <= 6, "the divisions are told apart by colour, in a handful of tones");
});

test("the endpoint serves the neutral image on a real-data site, still cacheable", async () => {
  process.env.BOXING_PROVIDER = "licensed";
  const b = w.boxers[0];
  const res = await route.GET(new Request(`http://x/api/art/portrait/${b.slug}.svg`), { params: Promise.resolve({ slug: `${b.slug}.svg` }) });
  assert.equal(res.status, 200);
  assert.ok(!FACE.test(await res.text()));
  assert.match(res.headers.get("cache-control") ?? "", /public.*max-age=\d{5,}/);
});

test("source rule: the page describes an illustrated demo portrait, and gives a real person's placeholder an empty alt; a real photo keeps the name", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("components/Portrait.tsx", "utf8");
  assert.match(src, /alt=\{isDemoData\(\) \? t\("Portrait of \{name\}"[^}]*\}\) : ""\}/, "the generated image is described only when it is an illustration");
  assert.match(src, /alt=\{t\.name\(boxer\.name\)\}/, "a real photo is described by the fighter's name");
});
