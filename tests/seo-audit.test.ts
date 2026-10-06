import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * Regression tests for the pre-launch search-engine and link-sharing audit (docs/seo-audit.md). Each test names the defect it keeps fixed.
 */
const root = process.cwd();
const env = (set: Record<string, string | undefined>, fn: () => void | Promise<void>) => async () => {
  const keys = ["BOXING_PROVIDER", "INDEXABLE", "SITE_URL"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(set)) if (v !== undefined) process.env[k] = v;
    await fn();
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

test("indexing needs real data AND a public SITE_URL (a live site with no SITE_URL used to publish localhost canonicals)", async () => {
  const { indexable, siteUrlIsPublic, pageMetadata } = await import("../lib/seo");
  await env({ BOXING_PROVIDER: "licensed" }, () => {
    assert.equal(indexable(), false, "real data but no SITE_URL");
    assert.deepEqual(pageMetadata({ locale: "en", path: "/x", title: "T", description: "D" }).robots, { index: false, follow: false });
  })();
  await env({ BOXING_PROVIDER: "licensed", SITE_URL: "http://localhost:3000" }, () => assert.equal(indexable(), false, "SITE_URL pointing at this machine"))();
  await env({ BOXING_PROVIDER: "licensed", SITE_URL: "not a url" }, () => assert.equal(indexable(), false))();
  await env({ BOXING_PROVIDER: "licensed", SITE_URL: "https://ringside.example" }, () => assert.equal(indexable(), true))();
  await env({ BOXING_PROVIDER: "demo", SITE_URL: "https://ringside.example" }, () => assert.equal(indexable(), false, "the fictional league stays hidden"))();
  await env({}, () => assert.equal(indexable(), false, "the default is hidden"))();
  await env({ BOXING_PROVIDER: "demo", INDEXABLE: "1" }, () => assert.equal(indexable(), false, "even the override needs a public address"))();
  await env({ BOXING_PROVIDER: "demo", INDEXABLE: "1", SITE_URL: "https://ringside.example" }, () => assert.equal(indexable(), true))();
  for (const bad of [undefined, "", "  ", "ftp://x.example", "http://127.0.0.1:3000", "http://[::1]:3000", "http://app.localhost"]) assert.equal(siteUrlIsPublic(bad), false, String(bad));
  assert.equal(siteUrlIsPublic("http://staging.example:8080"), true);
});

test("the demo stays hidden everywhere: robots.txt, sitemap, and no structured data", async () => {
  await env({ BOXING_PROVIDER: "demo", SITE_URL: "https://ringside.example" }, async () => {
    const robots = (await import("../app/robots")).default();
    assert.deepEqual(robots.rules, { userAgent: "*", disallow: "/" });
    assert.equal(robots.sitemap, undefined);
    assert.equal((await (await import("../app/sitemap.xml/route")).GET()).status, 404);
    const { JsonLd, BreadcrumbLd } = await import("../components/JsonLd");
    assert.equal(JsonLd({ data: { "@type": "Thing" } }), null);
    const crumb = BreadcrumbLd({ locale: "en", trail: [{ name: "Fighters", path: "/boxers" }] }) as unknown as { type: (p: { data: Record<string, unknown> }) => unknown; props: { data: Record<string, unknown> } };
    assert.equal(crumb.type(crumb.props), null, "a breadcrumb is structured data like any other");
  })();
});

test("descriptions are cut by us, at a sentence or a word, to what a results page shows (they ran to 270 characters)", async () => {
  const { clampDescription, DESCRIPTION_MAX, pageMetadata } = await import("../lib/seo");
  const short = "Wins on record, by any method.";
  assert.equal(clampDescription(short), short);
  assert.equal(clampDescription("  a   b\n c "), "a b c", "whitespace is tidied");
  const two = `${"First sentence of the description goes here and is fairly long indeed. ".repeat(1)}${"Second sentence that runs on and on past the limit of what is shown anywhere. ".repeat(2)}`;
  const cut = clampDescription(two);
  assert.ok(cut.length <= DESCRIPTION_MAX && cut.endsWith("."), `ends at a sentence: ${cut}`);
  const words = clampDescription("word ".repeat(80));
  assert.ok(words.length <= DESCRIPTION_MAX && words.endsWith("…") && !/\s…$/.test(words), "else at a word, with an ellipsis");
  const arabic = clampDescription("الملاكمة بالتبسيط ".repeat(30));
  assert.ok(arabic.length <= DESCRIPTION_MAX && arabic.endsWith("…"), "Arabic too");
  await env({ BOXING_PROVIDER: "licensed", SITE_URL: "https://ringside.example" }, () => {
    const m = pageMetadata({ locale: "en", path: "/x", title: "T", description: "word ".repeat(80) });
    assert.ok((m.description as string).length <= DESCRIPTION_MAX);
    assert.equal(m.openGraph?.description, m.description, "the share card says the same thing");
  })();
});

test("every page has a share image: the site card where the page has none of its own (the card was empty on 40 page types)", async () => {
  const { pageMetadata, OWN_IMAGE_PATH } = await import("../lib/seo");
  // the pages that carry their own opengraph-image file are exactly the ones the pattern names
  const dir = path.join(root, "app", "[locale]");
  const walk = (d: string, rel = ""): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name), `${rel}/${e.name}`) : /^opengraph-image\.tsx?$/.test(e.name) ? [rel || "/"] : []);
  const routes = walk(dir).map((r) => r.replace(/\[[^\]]+\]/g, "x"));
  assert.ok(routes.length >= 8);
  for (const r of routes) assert.ok(OWN_IMAGE_PATH.test(r), `${r} has its own image file but the pattern does not name it, so it would get the site card instead`);
  for (const p of ["/boxers", "/events", "/rankings", "/countries", "/titles", "/people/x", "/orgs/x", "/all-time/wins", "/fight-of-the-year/2025", "/learn", "/privacy"]) {
    assert.ok(!OWN_IMAGE_PATH.test(p), `${p} has no image file: it needs the site card`);
  }
  await env({ BOXING_PROVIDER: "licensed", SITE_URL: "https://ringside.example" }, () => {
    const en = pageMetadata({ locale: "en", path: "/rankings", title: "T", description: "D" });
    const ar = pageMetadata({ locale: "ar", path: "/rankings", title: "T", description: "D" });
    assert.deepEqual((en.openGraph as { images: { url: string }[] }).images.map((i) => i.url), ["https://ringside.example/opengraph-image"], "the English card is the bare path: no redirect for a scraper to follow");
    assert.deepEqual((ar.openGraph as { images: { url: string }[] }).images.map((i) => i.url), ["https://ringside.example/ar/opengraph-image"]);
    assert.deepEqual((en.twitter as { images: string[] }).images, ["https://ringside.example/opengraph-image"], "a summary_large_image card without an image shows nothing");
    assert.equal((pageMetadata({ locale: "en", path: "/boxers/x", title: "T", description: "D" }).openGraph as { images?: unknown }).images, undefined, "a fighter page keeps its own card");
    assert.equal((pageMetadata({ locale: "en", path: "/", title: "T", description: "D" }).openGraph as { images?: unknown }).images, undefined);
    assert.equal(((pageMetadata({ locale: "en", path: "/x", title: "T", description: "D", image: "/custom.png" }).openGraph as { images: { url: string }[] }).images[0].url), "https://ringside.example/custom.png");
  })();
});

test("canonical and hreflang point both ways, and a query string never changes them", async () => {
  const { pageMetadata } = await import("../lib/seo");
  await env({ BOXING_PROVIDER: "licensed", SITE_URL: "https://ringside.example/" }, () => {
    for (const path of ["/", "/boxers", "/boxers/jose-ramirez", "/ar-like/x"]) {
      const en = pageMetadata({ locale: "en", path, title: "T", description: "D" }), ar = pageMetadata({ locale: "ar", path, title: "T", description: "D" });
      assert.deepEqual(en.alternates?.languages, ar.alternates?.languages, "each language lists the same set, so each points to the other");
      const langs = en.alternates!.languages as Record<string, string>;
      assert.equal(en.alternates?.canonical, langs.en);
      assert.equal(ar.alternates?.canonical, langs.ar);
      assert.equal(langs["x-default"], langs.en);
      assert.ok(Object.values(langs).every((u) => !u.includes("?") && u.startsWith("https://ringside.example") && !u.startsWith("https://ringside.example//")), "no query, no doubled slash from a SITE_URL with a trailing slash");
    }
  })();
});

test("a search (?q=) is marked noindex, follow by the proxy; a plain page is not; the English share image is served, not redirected", async () => {
  const { proxy } = await import("../proxy");
  const go = (url: string) => proxy(new NextRequest(url));
  assert.equal(go("http://localhost:3000/boxers?q=ramirez").headers.get("x-robots-tag"), "noindex, follow");
  assert.equal(go("http://localhost:3000/ar/rankings/flyweight?q=a&page=2").headers.get("x-robots-tag"), "noindex, follow");
  assert.equal(go("http://localhost:3000/boxers").headers.get("x-robots-tag"), null);
  assert.equal(go("http://localhost:3000/boxers?q=").headers.get("x-robots-tag"), null, "an empty search is the plain list");
  assert.equal(go("http://localhost:3000/boxers?sort=wins").headers.get("x-robots-tag"), null, "sorting is canonicalised, not hidden");
  const img = go("http://localhost:3000/en/boxers/jose-ramirez/opengraph-image");
  assert.equal(img.status, 200, "no 308 for an image a scraper is told to fetch");
  assert.equal(go("http://localhost:3000/en/opengraph-image").status, 200);
  assert.equal(go("http://localhost:3000/en/boxers/jose-ramirez").status, 308, "the page itself still has one English URL");
  assert.equal(go("http://localhost:3000/en/boxers").headers.get("location"), "http://localhost:3000/boxers");
});

test("BreadcrumbList: home first, positions from 1, absolute addresses in the page's language", async () => {
  const { breadcrumbLd } = await import("../lib/seo");
  await env({ BOXING_PROVIDER: "licensed", SITE_URL: "https://ringside.example" }, () => {
    const b = breadcrumbLd("ar", [{ name: "Ringside", path: "/" }, { name: "الملاكمون", path: "/boxers" }, { name: "س", path: "/boxers/x" }]) as { "@type": string; itemListElement: { position: number; item: string; name: string }[] };
    assert.equal(b["@type"], "BreadcrumbList");
    assert.deepEqual(b.itemListElement.map((i) => i.position), [1, 2, 3]);
    assert.deepEqual(b.itemListElement.map((i) => i.item), ["https://ringside.example/ar", "https://ringside.example/ar/boxers", "https://ringside.example/ar/boxers/x"]);
  })();
});

test("structured data on the pages: the right types, no invented facts, nothing but the page's own words", () => {
  const read = (p: string) => fs.readFileSync(path.join(root, "app", "[locale]", p), "utf8");
  const ld = (p: string) => [...read(p).matchAll(/"@type": "([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.ok(ld("boxers/[slug]/page.tsx").includes("Person") && ld("boxers/[slug]/page.tsx").includes("BreadcrumbList") === false, "the fighter is a Person (the crumb is its own component)");
  for (const [p, type] of [["events/[id]/page.tsx", "SportsEvent"], ["bouts/[id]/page.tsx", "SportsEvent"], ["previews/[id]/page.tsx", "SportsEvent"], ["orgs/[slug]/page.tsx", "Organization"], ["people/[slug]/page.tsx", "Person"], ["titles/[slug]/page.tsx", "Dataset"], ["page.tsx", "WebSite"], ["page.tsx", "Organization"]] as const) assert.ok(ld(p).includes(type), `${p} says ${type}`);
  for (const p of ["boxers/[slug]/page.tsx", "events/[id]/page.tsx", "bouts/[id]/page.tsx", "previews/[id]/page.tsx", "orgs/[slug]/page.tsx", "people/[slug]/page.tsx", "titles/[slug]/page.tsx", "countries/[slug]/page.tsx", "rankings/[division]/page.tsx"]) assert.match(read(p), /<BreadcrumbLd /, `${p} has a breadcrumb trail`);
  // the site-wide WebSite block used to ride on every page; it belongs to the home page, once per language
  assert.ok(!/ld\+json/.test(read("layout.tsx")));
  // a dataset needs a description to be valid
  assert.match(read("titles/[slug]/page.tsx"), /"@type": "Dataset"[\s\S]{0,300}description:/);
  // names that join two fighters come from the dictionary, not a hard-coded English "vs" (the Arabic page said "A vs B" in its structured data)
  for (const p of ["previews/[id]/page.tsx", "fight-of-the-year/[year]/page.tsx", "bouts/[id]/page.tsx"]) assert.ok(!/\$\{[^}]*\} vs \$\{/.test(read(p)), `${p} has an English "vs" in a template`);
  // wording: no machine-written or "AI" claims in what search engines read
  for (const p of ["boxers/[slug]/page.tsx", "events/[id]/page.tsx", "bouts/[id]/page.tsx", "previews/[id]/page.tsx", "page.tsx"]) {
    for (const m of read(p).matchAll(/<JsonLd data=\{\{[\s\S]*?\}\} \/>/g)) assert.ok(!/\bAI\b|auto-?generated|machine|prediction|model|rating/i.test(m[0]), `${p}: structured data states only facts`);
  }
});

test("the print sheet is not a second <h1> (every fighter page had two)", () => {
  assert.ok(!/<h1\b/.test(fs.readFileSync(path.join(root, "components", "FighterPrintSheet.tsx"), "utf8")));
});

// ---- the sitemap and the pages' own noindex rule hang on one set of rules (lib/sitemap.ts) ----
const boxer = (id: number, bouts: number) => ({ id, slug: `f${id}`, name: `Fighter ${id}`, country: "Mexico", bouts, lastFight: "2025-05-01" });
const bout = (id: number, eventId: number, o: Record<string, unknown> = {}) => ({ id, eventId, upcoming: false, status: "completed", title: null, date: "2025-05-01", ...o });
const event = (id: number, o: Record<string, unknown> = {}) => ({ id, date: "2025-05-01", status: "completed", upcoming: false, ...o });

test("what is thin is noindex on the page and absent from the sitemap, by the same rule", async () => {
  const { isListedBoxer, isListedEvent, isListedBout, isListedPreview } = await import("../lib/sitemap");
  assert.equal(isListedBoxer(boxer(1, 3)), true);
  assert.equal(isListedBoxer(boxer(2, 0)), false, "a name with no fights");
  assert.equal(isListedEvent(event(1) as never), true);
  assert.equal(isListedEvent(event(2, { status: "cancelled" }) as never), false);
  const e1 = event(1), up = event(2, { upcoming: true, date: "2026-12-01", status: "scheduled" }), cancelled = event(3, { status: "cancelled" });
  const bs = [bout(10, 1), bout(11, 1, { title: "World" }), bout(12, 1), bout(13, 1, { status: "cancelled" })];
  const ups = [bout(20, 2, { upcoming: true, status: "scheduled" }), bout(21, 2, { upcoming: true, status: "scheduled" }), bout(22, 2, { upcoming: true, status: "scheduled" }), bout(23, 2, { upcoming: true, status: "cancelled" })];
  const dead = [bout(30, 3, { upcoming: true, status: "scheduled" })];
  const all = [...bs, ...ups, ...dead];
  const w = { eventById: new Map([e1, up, cancelled].map((e) => [e.id, e])), boutsByEvent: new Map([[1, bs], [2, ups], [3, dead]]) } as never;
  const listed = (f: (w: never, b: never) => boolean) => all.filter((b) => f(w, b as never)).map((b) => b.id);
  assert.deepEqual(listed(isListedBout as never), [10, 11], "the main event and the title fight; not the third bout, not a cancelled one, not an upcoming one");
  assert.deepEqual(listed(isListedPreview as never), [20, 21], "main event and co-main of an upcoming card; not the third bout, not a cancelled fight or card");
});

test("the demo league's sitemap: every static page, every listed fighter and card, nothing thin, alternates that point back", async () => {
  const { sitemapPaths, sitemapFileXml, isListedBoxer, isListedEvent, isListedBout, isListedPreview } = await import("../lib/sitemap");
  const { getWorld } = await import("../lib/world");
  const w = await getWorld();
  const paths = new Set(sitemapPaths(w).map((p) => p.path));
  for (const p of ["/", "/privacy", "/terms", "/boxers", "/events", "/countries", "/rankings", "/learn", "/data", "/titles", "/people", "/orgs", "/all-time", "/fight-of-the-year"]) assert.ok(paths.has(p), `${p} is listed`);
  for (const b of w.boxers) assert.equal(paths.has(`/boxers/${b.slug}`), b.bouts > 0 && isListedBoxer(b), b.slug);
  for (const e of w.events) assert.equal(paths.has(`/events/${e.id}`), e.status !== "cancelled" && isListedEvent(e), `event ${e.id}`);
  for (const b of w.bouts) { assert.equal(paths.has(`/bouts/${b.id}`), isListedBout(w, b), `bout ${b.id}`); assert.equal(paths.has(`/previews/${b.id}`), isListedPreview(w, b), `preview ${b.id}`); }
  assert.ok(w.boxers.some((b) => b.bouts === 0) && w.events.some((e) => e.status === "cancelled") && w.bouts.some((b) => !isListedBout(w, b) && !b.upcoming), "the league has thin pages to leave out");
  await env({ BOXING_PROVIDER: "licensed", SITE_URL: "https://ringside.example" }, () => {
    const xml = sitemapFileXml([{ path: "/boxers/a&b", lastmod: "2026-01-01" }], 0)!;
    assert.match(xml, /<loc>https:\/\/ringside\.example\/boxers\/a&amp;b<\/loc>/, "escaped");
    assert.match(xml, /<loc>https:\/\/ringside\.example\/ar\/boxers\/a&amp;b<\/loc>/);
    for (const l of ["en", "ar", "x-default"]) assert.equal((xml.match(new RegExp(`hreflang="${l}"`, "g")) ?? []).length, 2, `each of the 2 entries names ${l}`);
  })();
});

test("at 35,000 fighters the sitemap splits into files under both of Google's limits (50,000 URLs, 50 MB) behind an index", async () => {
  const { sitemapFileXml, fileCount, PATHS_PER_FILE } = await import("../lib/sitemap");
  await env({ BOXING_PROVIDER: "licensed", SITE_URL: "https://ringside.example" }, () => {
    const paths = [
      ...Array.from({ length: 35000 }, (_, i) => ({ path: `/boxers/fighter-number-${i}-with-a-fairly-long-slug-name`, lastmod: "2026-10-06" })),
      ...Array.from({ length: 24000 }, (_, i) => ({ path: `/events/${i}`, lastmod: "2026-10-06" })),
      ...Array.from({ length: 9000 }, (_, i) => ({ path: `/bouts/${i}`, lastmod: "2026-10-06" })),
    ];
    const n = fileCount(paths.length);
    assert.equal(n, Math.ceil(68000 / PATHS_PER_FILE));
    assert.ok(n > 1, "one file would not hold it");
    let urls = 0;
    for (let i = 0; i < n; i++) {
      const xml = sitemapFileXml(paths, i)!;
      const count = (xml.match(/<url>/g) ?? []).length;
      urls += count;
      assert.ok(count <= 50000, `file ${i}: ${count} URLs`);
      assert.ok(Buffer.byteLength(xml) < 50 * 1024 * 1024, `file ${i}: ${Buffer.byteLength(xml)} bytes`);
    }
    assert.equal(urls, paths.length * 2, "every path once per language, none lost or repeated across the split");
    assert.equal(sitemapFileXml(paths, n), null, "one past the last file is a 404, not an empty file");
    assert.equal(fileCount(0), 1, "an empty site still has an index entry");
  })();
});

test("the doctor and the start-up line say a site with no public SITE_URL is not indexable", async () => {
  const { configLine, envFindings } = await import("../lib/doctor");
  const line = (e: Record<string, string>) => JSON.parse(configLine(e as never));
  assert.equal(line({ BOXING_PROVIDER: "licensed" }).indexable, false);
  assert.equal(line({ BOXING_PROVIDER: "licensed", SITE_URL: "https://ringside.example" }).indexable, true);
  assert.equal(line({ BOXING_PROVIDER: "demo", SITE_URL: "https://ringside.example" }).indexable, false);
  const warn = envFindings({ BOXING_PROVIDER: "licensed" } as never, "22.23.2", true).find((f) => f.id === "site-url");
  assert.match(warn?.message ?? "", /noindex/);
});
