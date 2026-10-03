import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tempDb } from "./helpers";

/**
 * Generated portraits are served as cacheable images instead of being inlined into every page (the rankings page was
 * about 1 MB of HTML, most of it the same SVG art). These tests keep the image identical to what used to be inlined,
 * safe to use as an <img>, and properly cacheable.
 */
const cleanup = tempDb("art");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let art: typeof import("../lib/art");
let route: typeof import("../app/api/art/portrait/[slug]/route");
let PortraitArt: typeof import("../components/PortraitArt").Portrait;
before(async () => {
  w = await (await import("../lib/world")).getWorld();
  art = await import("../lib/art");
  route = await import("../app/api/art/portrait/[slug]/route");
  PortraitArt = (await import("../components/PortraitArt")).Portrait;
});

const get = (slug: string, headers: Record<string, string> = {}) =>
  route.GET(new Request(`http://x/api/art/portrait/${slug}.svg`, { headers }), { params: Promise.resolve({ slug: `${slug}.svg` }) });

test("the SVG serializer matches React's own output byte for byte", () => {
  // every hair, beard and body variant the generator can produce shows up in a few hundred fighters
  const sample = w.boxers.filter((_, i) => i % 3 === 0).slice(0, 300);
  assert.ok(sample.length > 100);
  for (const b of sample) {
    const mine = art.portraitSvg(b);
    const react = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150" width="120" height="150">${renderToStaticMarkup(createElement(PortraitArt, { boxer: b, uid: "p" }))}</svg>`;
    assert.equal(mine, react, `portrait of ${b.slug} differs from React's rendering`);
  }
});

test("the portrait is a self-contained image: no text, no page fonts or variables, no scripts, no external references", () => {
  for (const b of w.boxers.slice(0, 50)) {
    const svg = art.portraitSvg(b);
    assert.ok(svg.startsWith("<svg xmlns="), "needs the SVG namespace to load as an image");
    assert.ok(!/<text|var\(|<script|<foreignObject|href=|url\((?!#)/i.test(svg), `${b.slug}: must not depend on the page it is shown in`);
    assert.ok(svg.length < 6000, `${b.slug}: ${svg.length} bytes`);
  }
});

test("the endpoint serves a cacheable SVG, answers 304 to a matching tag and 404 to an unknown fighter", async () => {
  const b = w.boxers[0];
  const res = await get(b.slug);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^image\/svg\+xml/);
  assert.match(res.headers.get("cache-control") ?? "", /public.*max-age=\d{5,}/, "a day or more, so repeat views and lists never refetch");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  const body = await res.text();
  assert.equal(body, art.portraitSvg(b));
  const etag = res.headers.get("etag")!;
  assert.ok(etag);
  assert.equal((await get(b.slug, { "if-none-match": etag })).status, 304);
  assert.equal((await get(b.slug, { "if-none-match": '"something-else"' })).status, 200);
  assert.equal((await (await get(b.slug)).text()), body, "deterministic: the same fighter always draws the same");
  const missing = await get("nobody-here");
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store", "a miss must not be cached");
});

test("the URL helper encodes slugs and matches the route", async () => {
  const { portraitUrl } = await import("../lib/art-url");
  assert.equal(portraitUrl("ramil-abad"), "/api/art/portrait/ramil-abad.svg");
  assert.equal(portraitUrl("a b/c"), "/api/art/portrait/a%20b%2Fc.svg");
});
