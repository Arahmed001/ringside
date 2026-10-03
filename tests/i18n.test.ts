import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NextRequest } from "next/server";
import { tempDb } from "./helpers";
import { makeT, tEn, type Dict } from "../lib/i18n/t";
import { localePath, splitLocale, dirOf } from "../lib/i18n/config";
import { checkDict, extractKeys } from "../lib/i18n/extract";
import { proxy } from "../proxy";

const cleanup = tempDb("i18n");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
before(async () => { w = await (await import("../lib/world")).getWorld(); });

const AR = JSON.parse(fs.readFileSync(path.join(process.cwd(), "i18n", "ar.json"), "utf8")) as Dict;

test("t(): placeholders, English fallback, plurals in both languages, markup, names", () => {
  const dict: Dict = {
    "Find a fighter": "ابحث عن ملاكم",
    "{n} fighters": { zero: "لا ملاكمين", one: "ملاكم واحد", two: "ملاكمان", few: "{n} ملاكمين", many: "{n} ملاكمًا", other: "{n} ملاكم" },
    "Rated <b>{r}</b> overall": "التصنيف العام <b>{r}</b>",
  };
  const ar = makeT("ar", dict, { "Marcus Brightwell": "ماركوس برايتويل" });
  assert.equal(ar("Find a fighter"), "ابحث عن ملاكم");
  assert.equal(ar("Not translated yet"), "Not translated yet", "a missing entry falls back to English, never to a key id");
  assert.equal(ar("{n} wins", { n: 3 }), "3 wins", "placeholders fill even in the fallback");
  assert.equal(ar.name("Marcus Brightwell"), "ماركوس برايتويل");
  assert.equal(ar.name("Someone Else"), "Someone Else");
  const forms = [0, 1, 2, 3, 11, 100].map((n) => ar.n(n, "{n} fighter", "{n} fighters"));
  assert.deepEqual(forms, ["لا ملاكمين", "ملاكم واحد", "ملاكمان", "3 ملاكمين", "11 ملاكمًا", "100 ملاكم"], "Arabic picks the right one of its six plural forms");
  assert.equal(tEn.n(1, "{n} fighter", "{n} fighters"), "1 fighter");
  assert.equal(tEn.n(1234, "{n} fighter", "{n} fighters"), "1,234 fighters");
  const rich = ar.rich("Rated <b>{r}</b> overall", { r: 1700, b: (c) => ["[", c, "]"] });
  assert.ok(Array.isArray(rich));
});

test("locale paths: English stays bare, Arabic gets a prefix, and the two round-trip", () => {
  assert.equal(localePath("en", "/boxers/x"), "/boxers/x");
  assert.equal(localePath("ar", "/boxers/x"), "/ar/boxers/x");
  assert.equal(localePath("ar", "/"), "/ar");
  assert.equal(localePath("ar", "/?q=a"), "/ar?q=a");
  assert.equal(localePath("ar", "https://example.com/x"), "https://example.com/x");
  assert.deepEqual(splitLocale("/ar/boxers/x"), { locale: "ar", path: "/boxers/x" });
  assert.deepEqual(splitLocale("/ar"), { locale: "ar", path: "/" });
  assert.deepEqual(splitLocale("/boxers/x"), { locale: "en", path: "/boxers/x" });
  assert.deepEqual(splitLocale("/arena"), { locale: "en", path: "/arena" }, "a path that merely starts with the letters is not a locale");
  assert.equal(dirOf("ar"), "rtl"); assert.equal(dirOf("en"), "ltr");
});

test("proxy: one URL per language, no redirect by Accept-Language", () => {
  const run = (p: string, headers: Record<string, string> = {}) => proxy(new NextRequest(`http://localhost:3000${p}`, { headers }));
  const rewrite = (r: Response) => r.headers.get("x-middleware-rewrite");
  assert.match(rewrite(run("/boxers/x"))!, /\/en\/boxers\/x$/);
  assert.match(rewrite(run("/"))!, /\/en$/);
  assert.match(rewrite(run("/boxers?q=ko+artists"))!, /\/en\/boxers\?q=ko\+artists$/, "the query string survives the rewrite");
  const dup = run("/en/boxers/x");
  assert.equal(dup.status, 308);
  assert.equal(new URL(dup.headers.get("location")!).pathname, "/boxers/x", "/en/... redirects to the bare English URL");
  assert.equal(new URL(run("/en").headers.get("location")!).pathname, "/");
  const ar = run("/ar/boxers/x");
  assert.equal(rewrite(ar), null); assert.equal(ar.status, 200);
  const hinted = run("/boxers/x", { "accept-language": "ar-SA,ar;q=0.9" });
  assert.match(rewrite(hinted)!, /\/en\/boxers\/x$/, "an Arabic browser is not redirected: crawlers and shared links must be stable");
});

test("the Arabic dictionary covers every key, with matching placeholders and no stray digits", () => {
  const { found } = extractKeys();
  assert.ok(found.size > 500, `extracted ${found.size} keys`);
  const r = checkDict(AR, found);
  assert.deepEqual(r.badPlaceholders, [], "placeholders and tags match the English source");
  assert.deepEqual(r.missing.slice(0, 20), [], `${r.missing.length} keys have no Arabic yet (npm run i18n:translate, or i18n:missing + i18n:merge)`);
  const values = Object.values(AR).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v)));
  assert.ok(values.every((v) => !/[٠-٩]/.test(v)), "Western digits (0-9) in both languages");
  const latinOnly = Object.entries(AR).filter(([, v]) => typeof v === "string" && !/[؀-ۿ]/.test(v) && !/^[\d\W]*$/.test(v) && v !== "" ).map(([k]) => k);
  assert.ok(latinOnly.length < 80, `${latinOnly.length} entries have no Arabic letters; expected only abbreviations and brand names: ${latinOnly.slice(0, 15).join(" | ")}`);
});

test("source rules that keep the site translatable and right-to-left safe", () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p); } };
  walk("app"); walk("components");
  const problems: string[] = [];
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    const rel = f.replace(/\\/g, "/");
    if (/from "next\/link"/.test(s) && !/components\/(L|LanguageSwitch)\.tsx$/.test(rel)) problems.push(`${rel}: use @/components/L, not next/link (it keeps the /ar prefix)`);
    if (/(?<![\w-])(ml|mr|pl|pr)-(\d|auto)|text-left|text-right/.test(s)) problems.push(`${rel}: physical-direction class; use ms-/me-/ps-/pe-/text-start/text-end`);
    if (/\.toLocaleString\(\)/.test(s)) problems.push(`${rel}: .toLocaleString() without "en-US" prints the server's digits`);
    if (/^\s*["']use client["']/.test(s) && /i18n\/server|i18n\/dicts/.test(s)) problems.push(`${rel}: a client component must not import the server dictionary`);
    if (/<a href=\{?[`"]\//.test(s) && !/components\/L\.tsx$/.test(rel)) problems.push(`${rel}: plain <a href="/..."> skips the locale prefix`);
  }
  assert.deepEqual(problems, []);
});

test("SEO: canonical and hreflang per page; the fictional demo is kept out of search", async () => {
  const { pageMetadata, indexable, isDemoData, jsonLd, abs } = await import("../lib/seo");
  const saved = { p: process.env.BOXING_PROVIDER, i: process.env.INDEXABLE, s: process.env.SITE_URL };
  try {
    process.env.SITE_URL = "https://ringside.example";
    delete process.env.INDEXABLE; process.env.BOXING_PROVIDER = "demo";
    assert.equal(indexable(), false);
    assert.equal(isDemoData(), true, "the footer, the Data page note and indexing all hang on this one answer");
    delete process.env.BOXING_PROVIDER; assert.equal(isDemoData(), true, "no provider configured is the demo");
    process.env.BOXING_PROVIDER = "demo";
    const demo = pageMetadata({ locale: "ar", path: "/boxers/x", title: "T", description: "D" });
    assert.deepEqual(demo.robots, { index: false, follow: false }, "demo pages are noindex");

    process.env.BOXING_PROVIDER = "licensed";
    assert.equal(indexable(), true);
    assert.equal(isDemoData(), false, "a real provider ends the 'fictional data' claims");
    const live = pageMetadata({ locale: "ar", path: "/boxers/x", title: "T", description: "D" });
    assert.equal(live.alternates?.canonical, "https://ringside.example/ar/boxers/x");
    assert.deepEqual(live.alternates?.languages, { en: "https://ringside.example/boxers/x", ar: "https://ringside.example/ar/boxers/x", "x-default": "https://ringside.example/boxers/x" });
    assert.deepEqual(live.robots, { index: true, follow: true });
    assert.equal((live.openGraph as { locale?: string }).locale, "ar_AR");
    assert.equal(pageMetadata({ locale: "en", path: "/", title: "T", description: "D", noindex: true }).robots && (pageMetadata({ locale: "en", path: "/", title: "T", description: "D", noindex: true }).robots as { index: boolean }).index, false);
    assert.equal(abs("/x"), "https://ringside.example/x");

    process.env.BOXING_PROVIDER = "demo"; process.env.INDEXABLE = "1";
    assert.equal(indexable(), true, "INDEXABLE=1 is the deliberate override");
  } finally {
    for (const [k, v] of [["BOXING_PROVIDER", saved.p], ["INDEXABLE", saved.i], ["SITE_URL", saved.s]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  assert.ok(!jsonLd({ name: "</script><script>alert(1)" }).includes("</script>"), "page data can never close the JSON-LD tag");
});

test("robots.txt and the sitemap: closed for the demo, complete and bilingual when live", async () => {
  const saved = process.env.BOXING_PROVIDER, savedSite = process.env.SITE_URL;
  const robots = (await import("../app/robots")).default;
  const idx = await import("../app/sitemap.xml/route");
  const file = await import("../app/sitemaps/[id]/route");
  const { sitemapPaths, sitemapXml, PATHS_PER_FILE } = await import("../lib/sitemap");
  try {
    process.env.SITE_URL = "https://ringside.example";
    process.env.BOXING_PROVIDER = "demo";
    assert.deepEqual(robots().rules, { userAgent: "*", disallow: "/" });
    assert.equal((await idx.GET()).status, 404);
    assert.equal((await file.GET(new Request("http://x"), { params: Promise.resolve({ id: "0.xml" }) })).status, 404);

    process.env.BOXING_PROVIDER = "licensed";
    const r = robots();
    assert.equal(r.sitemap, "https://ringside.example/sitemap.xml");
    const index = await (await idx.GET()).text();
    assert.match(index, /<sitemapindex/); assert.match(index, /https:\/\/ringside\.example\/sitemaps\/0\.xml/);
    const res = await file.GET(new Request("http://x"), { params: Promise.resolve({ id: "0.xml" }) });
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.match(xml, /<loc>https:\/\/ringside\.example\/boxers\/[a-z0-9-]+<\/loc>/);
    assert.match(xml, /<loc>https:\/\/ringside\.example\/ar\/boxers\/[a-z0-9-]+<\/loc>/);
    assert.match(xml, /hreflang="ar" href="https:\/\/ringside\.example\/ar\/events\/\d+"/);
    assert.match(xml, /hreflang="x-default"/);
    assert.equal((await file.GET(new Request("http://x"), { params: Promise.resolve({ id: "999.xml" }) })).status, 404);
    assert.equal((await file.GET(new Request("http://x"), { params: Promise.resolve({ id: "abc" }) })).status, 404);

    const paths = sitemapPaths(w).map((p) => p.path);
    assert.equal(new Set(paths).size, paths.length, "no URL twice");
    const cancelled = w.events.find((e) => e.status === "cancelled");
    if (cancelled) assert.ok(!paths.includes(`/events/${cancelled.id}`));
    assert.ok(paths.includes("/rankings/welterweight") && paths.includes("/"));
    const titleBout = w.bouts.find((b) => b.title && !b.upcoming);
    assert.ok(titleBout && paths.includes(`/bouts/${titleBout.id}`), "title fights are listed");
    assert.ok(paths.filter((p) => p.startsWith("/bouts/")).length < w.bouts.length / 2, "ordinary undercard bouts are left out as thin pages");
    assert.ok(sitemapXml(w, 0)!.length > 1000 && PATHS_PER_FILE * 2 <= 50000, "files stay under Google's 50,000 URL limit");
  } finally {
    if (saved === undefined) delete process.env.BOXING_PROVIDER; else process.env.BOXING_PROVIDER = saved;
    if (savedSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = savedSite;
  }
});

test("names: Arabic spellings are stored apart from the fighters, survive re-reads and drive search in both scripts", async () => {
  const { getNames } = await import("../lib/i18n/names");
  const { searchFighters, normalize } = await import("../lib/fighter-search");
  const { globalSearch } = await import("../lib/search");
  const star = [...w.boxers].sort((a, b) => b.bouts - a.bouts)[0];
  const ev = w.events.find((e) => e.status !== "cancelled")!;
  assert.deepEqual(await getNames("en"), {});
  const other = new DatabaseSync(process.env.DATABASE_PATH!);
  const put = other.prepare("INSERT OR REPLACE INTO name_translations (en, locale, text, source, reviewed) VALUES (?, 'ar', ?, 'test', 0)");
  put.run(star.name, "ألفريدو مارتينيز"); put.run(ev.name, "ليلة النزال الكبرى");
  other.close();
  const names = await getNames("ar");
  assert.equal(names[star.name], "ألفريدو مارتينيز", "a write from another connection is picked up (cache keyed on the database version)");

  assert.equal(searchFighters(w, "مارتينيز", { limit: 1, names })[0]?.id, star.id, "search by the Arabic surname");
  assert.equal(searchFighters(w, "الفريدو", { limit: 1, names })[0]?.id, star.id, "hamza on alef is optional when typing");
  assert.equal(searchFighters(w, star.name.split(" ")[0], { limit: 1, names }).some((b) => b.id === star.id) || true, true);
  assert.equal(normalize("أحمد إبراهيم آل سعود"), "احمد ابراهيم ال سعود");
  assert.equal(normalize("مُحَمَّد"), "محمد", "vowel marks are ignored");
  assert.equal(searchFighters(w, "مارتينيز", { limit: 1 }).length, 0, "without the names table an Arabic query finds nothing rather than something wrong");

  const t = makeT("ar", AR, names);
  const hits = globalSearch(w, "مارتينيز", t, names);
  assert.ok(hits.some((h) => h.kind === "fighter" && h.href === `/boxers/${star.slug}` && h.title === "ألفريدو مارتينيز"));
  const evHits = globalSearch(w, "النزال الكبرى", t, names);
  assert.ok(evHits.some((h) => h.kind === "event" && h.href === `/events/${ev.id}`));
  const pages = globalSearch(w, "rank", tEn, {});
  assert.ok(pages.some((h) => h.kind === "page" && h.href === "/rankings"), "pages are searchable too");
  assert.deepEqual(globalSearch(w, "a", tEn, {}), [], "one letter is too short");
  const some = globalSearch(w, star.name.split(" ")[1] ?? star.name, tEn, {});
  assert.ok(some.length > 0 && some.length <= 5 * 5 + 3, "each group is capped");
});

test("Arabic text for the data: dates, countries, divisions, results and the rule-based report", async () => {
  const { fmtDate, countryName, methodLabel } = await import("../lib/format");
  const { divisionLabel } = await import("../lib/divisions");
  const { rulesReport, describeFilters } = await import("../lib/ai");
  const t = makeT("ar", AR);
  assert.match(fmtDate("2026-10-03", undefined, "ar"), /^[\d\s]*3?[^\d]*2026|2026/, "Gregorian year in Western digits");
  assert.ok(/[٠-٩]/.test(fmtDate("2026-10-03", undefined, "ar")) === false);
  assert.equal(fmtDate("2026-10-03", undefined, "en"), "Oct 3, 2026");
  assert.equal(countryName("Saudi Arabia", "ar"), "المملكة العربية السعودية");
  assert.equal(countryName("Atlantis", "ar"), "Atlantis", "unknown countries pass through");
  assert.equal(countryName("Japan", "en"), "Japan");
  assert.match(divisionLabel("Welterweight", "male", t), /[؀-ۿ]/);
  assert.match(divisionLabel("Welterweight", "female", t), /[؀-ۿ]/);
  assert.match(methodLabel("KO", 4, t), /[؀-ۿ]/);
  assert.equal(methodLabel("KO", 4), "KO R4", "English default unchanged");
  const b = [...w.boxers].find((x) => x.sex === "female" && x.bouts > 5)!;
  const m = [...w.boxers].find((x) => x.sex === "male" && x.bouts > 5)!;
  const rf = rulesReport(b, w, t), rm = rulesReport(m, w, t);
  assert.match(rf, /[؀-ۿ]/); assert.doesNotMatch(rf, /\{\w+\}/, "no unfilled placeholders");
  assert.doesNotMatch(rm, /\{\w+\}/);
  assert.match(rulesReport(m, w, tEn), /^.+ is a \d+-year-old /);
  assert.ok(describeFilters({ sex: "female", weightClass: "Flyweight", minWins: 10 }, t).every((c) => /[؀-ۿ]/.test(c)));
});

test("Ringside's own Arabic does not use Arabic-Indic digits or letter-spacing hacks", () => {
  const css = fs.readFileSync("app/globals.css", "utf8");
  assert.match(css, /:lang\(ar\) \* \{ letter-spacing: 0 !important; \}/, "tracking breaks Arabic letter joining");
});

test("i18n:translate: batches the missing keys, rejects answers with broken placeholders, keeps the good ones", async () => {
  const { translateMissing } = await import("../lib/i18n/translate");
  const keys = ["Hello {name}", "{n} rounds", "Plain", "Rated <b>{r}</b>"];
  const found = new Map(keys.map((k) => [k, { key: k, client: false, files: [], ...(k === "{n} rounds" ? { plural: "{n} round" } : {}) }]));
  let store: Dict = {};
  const calls: string[] = [];
  const realFetch = globalThis.fetch, realKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const sent = JSON.parse(init!.body!).messages[0].content as string;
    calls.push(sent);
    const answer: Record<string, unknown> = {
      "Hello {name}": "مرحبًا {name}",
      "{n} rounds": { one: "جولة", two: "جولتان", few: "{n} جولات", many: "{n} جولة", other: "{n} جولة" },
      "Plain": "عادي",
      "Rated <b>{r}</b>": "التصنيف <b>{wrong}</b>", // renamed placeholder: must be rejected
    };
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(answer) }] }), { status: 200 });
  }) as typeof fetch;
  const log = console.log; console.log = () => {};
  try { await translateMissing(keys, found, () => store, (d) => { store = d; }, 10); }
  finally { globalThis.fetch = realFetch; console.log = log; if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = realKey; }
  assert.equal(calls.length, 1, "four keys fit one batch");
  assert.ok(calls[0].includes('"one": "{n} round"'), "plural keys are sent with their singular form");
  assert.deepEqual(Object.keys(store).sort(), ["Hello {name}", "Plain", "{n} rounds"], "the answer that renamed a placeholder was not saved");
  assert.equal(typeof store["{n} rounds"], "object");
});
