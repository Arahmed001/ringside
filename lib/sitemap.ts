import type { World } from "./world";
import { LOCALES, localePath } from "./i18n/config";
import { slugifyDivision, DIVISIONS } from "./divisions";
import { memo } from "./memo";
import { belts } from "./lineage";
import { LISTS } from "./records";
import { fightYears } from "./fight-score";
import { currentYear } from "./clock";
import { abs } from "./seo";
import { countryList } from "./countries";

export interface SitemapPath { path: string; lastmod: string }

/** URLs per sitemap file. Every path is listed once per language, so a file holds twice this many <url> entries (the limit is 50,000). */
export const PATHS_PER_FILE = 10000;

const STATIC = ["/", "/rankings", "/boxers", "/countries", "/learn", "/tour", "/events", "/compare", "/people", "/orgs", "/weights", "/money", "/titles", "/matchmaking", "/previews", "/tonight", "/all-time", "/fight-of-the-year", "/on-this-day", "/upset-watch", "/trainers", "/ask", "/analytics", "/accountability", "/map", "/data", "/privacy", "/terms"];

/**
 * Every page worth indexing, locale-free, with when it last changed. Thin pages are left out on purpose: of the bouts, only
 * title fights and each card's main event get a URL (the rest are one line on the fighter and event pages that already rank).
 */
export const sitemapPaths = (w: World): SitemapPath[] => memo(w, "sitemapPaths", () => {
  const out: SitemapPath[] = [];
  for (const p of STATIC) out.push({ path: p, lastmod: w.today });
  for (const b of belts(w)) out.push({ path: `/titles/${b.slug}`, lastmod: b.lastDate });
  for (const d of DIVISIONS) out.push({ path: `/rankings/${slugifyDivision(d.name)}`, lastmod: w.today });
  for (const b of w.boxers) if (b.bouts > 0) out.push({ path: `/boxers/${b.slug}`, lastmod: b.lastFight ?? w.today });
  for (const e of w.events) if (e.status !== "cancelled") out.push({ path: `/events/${e.id}`, lastmod: e.date });
  for (const [, list] of w.boutsByEvent) {
    const main = list.find((b) => b.status !== "cancelled");
    for (const b of list) if (b.status !== "cancelled" && !b.upcoming && (b.title || b === main)) out.push({ path: `/bouts/${b.id}`, lastmod: b.date });
  }
  for (const e of w.events) { // previews: the main event and co-main of every upcoming card with a live bout
    if (!e.upcoming || e.status === "cancelled") continue;
    for (const b of (w.boutsByEvent.get(e.id) ?? []).filter((x) => x.status !== "cancelled" && x.upcoming).slice(0, 2)) out.push({ path: `/previews/${b.id}`, lastmod: w.today });
  }
  for (const l of LISTS) out.push({ path: `/all-time/${l.id}`, lastmod: w.today });
  for (const y of fightYears(w)) out.push({ path: `/fight-of-the-year/${y}`, lastmod: y === currentYear() ? w.today : `${y}-12-31` });
  for (const p of w.people.values()) out.push({ path: `/people/${p.slug}`, lastmod: w.today });
  for (const o of w.orgs.values()) out.push({ path: `/orgs/${o.slug}`, lastmod: w.today });
  for (const c of countryList(w)) out.push({ path: `/countries/${c.slug}`, lastmod: w.today });
  return out;
});

export const sitemapCount = (w: World) => Math.max(1, Math.ceil(sitemapPaths(w).length / PATHS_PER_FILE));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One <urlset> file: each path in every language, each entry pointing at all of its alternates (hreflang). */
export function sitemapXml(w: World, index: number): string | null {
  const slice = sitemapPaths(w).slice(index * PATHS_PER_FILE, (index + 1) * PATHS_PER_FILE);
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
