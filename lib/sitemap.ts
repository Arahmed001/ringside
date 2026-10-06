import zlib from "node:zlib";
import { promisify } from "node:util";
import type { World } from "./world";
import { ByteLru, budgetMb } from "./byte-lru";
import type { BoutRow, EventRow } from "./types";
import { LOCALES, localePath } from "./i18n/config";
import { slugifyDivision, DIVISIONS } from "./divisions";
import { memo } from "./memo";
import { belts } from "./lineage";
import { LISTS } from "./records";
import { fightYears } from "./fight-score";
import { currentYear } from "./clock";
import { abs } from "./seo";
import { countryList } from "./countries";
import { publicApiGate } from "./public-api";

const gzipAsync = promisify(zlib.gzip);

export interface SitemapPath { path: string; lastmod: string }

/** URLs per sitemap file. Every path is listed once per language, so a file holds twice this many <url> entries (the limit is 50,000). */
export const PATHS_PER_FILE = 10000;

const STATIC = ["/", "/rankings", "/boxers", "/countries", "/learn", "/tour", "/events", "/compare", "/people", "/orgs", "/weights", "/money", "/titles", "/matchmaking", "/previews", "/tonight", "/all-time", "/fight-of-the-year", "/on-this-day", "/upset-watch", "/trainers", "/ask", "/analytics", "/accountability", "/map", "/data", "/privacy", "/terms"];

/**
 * What is worth listing, in one place: the sitemap lists exactly these, and each page marks itself noindex when it is not one of them, so a page the
 * sitemap leaves out as thin cannot still be offered to search engines by a link, and the two never drift apart.
 */
export const isListedBoxer = (b: { bouts: number }) => b.bouts > 0;
export const isListedEvent = (e: Pick<EventRow, "status">) => e.status !== "cancelled";
/** A finished, uncancelled fight that is a title fight or its card's main event. An upcoming fight is answered by its preview page instead. */
export function isListedBout(w: World, b: BoutRow): boolean {
  if (b.status === "cancelled" || b.upcoming) return false;
  const main = (w.boutsByEvent.get(b.eventId) ?? []).find((x) => x.status !== "cancelled");
  return !!b.title || b === main;
}
/** The main event and co-main of an upcoming, uncancelled card. */
export function isListedPreview(w: World, b: BoutRow): boolean {
  const e = w.eventById.get(b.eventId);
  if (!e || !e.upcoming || e.status === "cancelled" || !b.upcoming || b.status === "cancelled") return false;
  return (w.boutsByEvent.get(e.id) ?? []).filter((x) => x.status !== "cancelled" && x.upcoming).slice(0, 2).includes(b);
}

/**
 * Every page worth indexing, locale-free, with when it last changed. Thin pages are left out on purpose: of the bouts, only
 * title fights and each card's main event get a URL (the rest are one line on the fighter and event pages that already rank).
 */
export const sitemapPaths = (w: World): SitemapPath[] => memo(w, "sitemapPaths", () => {
  const out: SitemapPath[] = [];
  for (const p of STATIC) out.push({ path: p, lastmod: w.today });
  if (publicApiGate().open) out.push({ path: "/developers", lastmod: w.today }); // when the API is closed the page says so and is noindex
  for (const b of belts(w)) out.push({ path: `/titles/${b.slug}`, lastmod: b.lastDate });
  for (const d of DIVISIONS) out.push({ path: `/rankings/${slugifyDivision(d.name)}`, lastmod: w.today });
  for (const b of w.boxers) if (isListedBoxer(b)) out.push({ path: `/boxers/${b.slug}`, lastmod: b.lastFight ?? w.today });
  for (const e of w.events) if (isListedEvent(e)) out.push({ path: `/events/${e.id}`, lastmod: e.date });
  for (const [, list] of w.boutsByEvent) for (const b of list) if (isListedBout(w, b)) out.push({ path: `/bouts/${b.id}`, lastmod: b.date });
  for (const [, list] of w.boutsByEvent) for (const b of list) if (isListedPreview(w, b)) out.push({ path: `/previews/${b.id}`, lastmod: w.today }); // the main event and co-main of every upcoming card with a live bout
  for (const l of LISTS) out.push({ path: `/all-time/${l.id}`, lastmod: w.today });
  for (const y of fightYears(w)) out.push({ path: `/fight-of-the-year/${y}`, lastmod: y === currentYear() ? w.today : `${y}-12-31` });
  for (const p of w.people.values()) out.push({ path: `/people/${p.slug}`, lastmod: w.today });
  for (const o of w.orgs.values()) out.push({ path: `/orgs/${o.slug}`, lastmod: w.today });
  for (const c of countryList(w)) out.push({ path: `/countries/${c.slug}`, lastmod: w.today });
  return out;
});

/** How many sitemap files `n` paths need (at least one, so the index is never empty). */
export const fileCount = (n: number) => Math.max(1, Math.ceil(n / PATHS_PER_FILE));
export const sitemapCount = (w: World) => fileCount(sitemapPaths(w).length);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One <urlset> file: each path in every language, each entry pointing at all of its alternates (hreflang). */
export const sitemapXml = (w: World, index: number): string | null => sitemapFileXml(sitemapPaths(w), index);

export function sitemapFileXml(paths: readonly SitemapPath[], index: number): string | null {
  const slice = paths.slice(index * PATHS_PER_FILE, (index + 1) * PATHS_PER_FILE);
  if (!slice.length && index > 0) return null;
  const urls = slice.flatMap(({ path, lastmod }) => {
    const alts = [...LOCALES.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(abs(localePath(l, path)))}"/>`), `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(abs(localePath("en", path)))}"/>`].join("");
    return LOCALES.map((l) => `<url><loc>${esc(abs(localePath(l, path)))}</loc><lastmod>${lastmod}</lastmod>${alts}</url>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join("")}</urlset>\n`;
}

export function sitemapIndexXml(w: World): string {
  const files = Array.from({ length: sitemapCount(w) }, (_, i) => `<sitemap><loc>${esc(abs(`/sitemaps/${i}.xml`))}</loc><lastmod>${w.today}</lastmod></sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.join("")}</sitemapindex>\n`;
}

// ----- the files as sent: built once per world, kept compressed -----
// A sitemap file is up to 8.6 MB of XML at 35,000 fighters and took 95 ms of the one thread to write out on every request (docs/capacity.md). XML this repetitive
// compresses about twenty to one, so what is kept is the gzipped file: all nineteen fit in a few MB, and a crawler (which always sends Accept-Encoding: gzip) is
// sent 400 KB instead of 8.6 MB. The XML itself is exactly `sitemapXml`'s, so the limits from PLAN 208 (10,000 paths a file, 50,000 URLs, 50 MB) are untouched.
const files = globalThis as unknown as { __ringsideSitemapCache?: ByteLru<string, Buffer>; __ringsideSitemapInflight?: Map<string, Promise<Buffer | null>>; __ringsideWorldIds?: WeakMap<World, number>; __ringsideWorldSeq?: number };
const worldId = (w: World): number => {
  const ids = (files.__ringsideWorldIds ??= new WeakMap());
  let id = ids.get(w);
  if (id === undefined) { id = files.__ringsideWorldSeq = (files.__ringsideWorldSeq ?? 0) + 1; ids.set(w, id); }
  return id;
};

/** The gzipped XML of sitemap file `index` of this world, or null when there is no such file. Kept per world (a rebuilt world is a new key) in a cache bounded by bytes (RINGSIDE_SITEMAP_CACHE_MB, default 32). */
export async function sitemapGzip(w: World, index: number): Promise<Buffer | null> {
  const cache = (files.__ringsideSitemapCache ??= new ByteLru<string, Buffer>(budgetMb(process.env.RINGSIDE_SITEMAP_CACHE_MB, 32)));
  const inflight = (files.__ringsideSitemapInflight ??= new Map());
  const key = `${worldId(w)}|${index}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const xml = sitemapXml(w, index);
      if (xml === null) return null;
      const gz = await gzipAsync(xml); // on the thread pool: the main thread is not held for it
      cache.set(key, gz);
      return gz;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}
