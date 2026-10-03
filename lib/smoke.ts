/**
 * The smoke check: every kind of page, in both languages, rendered by a real production server and inspected.
 * A build passing proves the code compiles, not that a page renders; this catches the pages that throw, show a raw
 * placeholder or "undefined", lose their heading or come back in the wrong language or direction. Pure helpers here
 * (route list, page inspection) so they are tested without a server; scripts/smoke.ts drives the server.
 */
import type { World } from "./world";
import { NAV_GROUPS, OFF_NAV } from "./nav";
import { slugifyDivision } from "./divisions";
import { LISTS } from "./records";
import { belts } from "./lineage";
import { fightYears } from "./fight-score";

export type Locale = "en" | "ar";
export interface SmokeRoute { path: string; kind: "page" | "api" | "svg" | "missing"; label: string }

/** Directories under app/[locale] whose URL has a parameter: every one must have a sampler below, or a new page escapes the check. */
export const DYNAMIC_PAGES = ["all-time/[list]", "bouts/[id]", "boxers/[slug]", "events/[id]", "fight-of-the-year/[year]", "orgs/[slug]", "people/[slug]", "previews/[id]", "rankings/[division]", "titles/[slug]"] as const;

const first = <T,>(xs: T[]): T | undefined => xs[0];
const q = (s: string) => encodeURIComponent(s);

/** Representative paths. Everything with a distinct code path is sampled (retired, women's, upcoming, cancelled, draw, title fight...). */
export function smokeRoutes(w: World): SmokeRoute[] {
  const out: SmokeRoute[] = [];
  const page = (path: string, label: string) => out.push({ path, kind: "page", label });
  page("/", "home");
  for (const g of NAV_GROUPS) for (const i of g.items) page(i.href, `nav: ${i.label}`);
  for (const p of OFF_NAV) page(p, `off-nav: ${p}`); // reached from the account menu, not the rail

  const boxers = [...w.boxers].sort((a, b) => b.rating - a.rating);
  const star = boxers[0], retired = boxers.find((b) => !b.active && b.bouts > 5 && b !== star), woman = boxers.find((b) => b.sex === "female"), debut = w.boxers.find((b) => b.bouts <= 1);
  for (const [b, label] of [[star, "top-rated fighter"], [retired, "retired fighter"], [woman, "women's fighter"], [debut, "fighter with almost no fights"]] as const) if (b) page(`/boxers/${b.slug}`, label);
  if (star && woman) page(`/compare?a=${star.slug}&b=${boxers[1].slug}`, "matchup");
  page(`/boxers?q=${q("southpaw welterweights with 10+ KOs")}`, "plain-English search");
  page("/boxers?sex=female", "women's fighter list");
  page("/boxers?page=2", "second page of the fighter list");
  page("/boxers?page=9999", "page number beyond the end");
  const yr = [...new Set(w.events.filter((e) => !e.upcoming && e.status !== "cancelled").map((e) => e.date.slice(0, 4)))].sort()[0];
  if (yr) { page(`/events?year=${yr}`, "events of one year"); page(`/events?year=${yr}&page=2`, "second page of a year's events"); }

  const upcoming = w.bouts.filter((b) => b.upcoming && b.status !== "cancelled");
  const bouts: [string, ((b: (typeof w.bouts)[number]) => boolean)][] = [
    ["decision", (b) => b.method === "UD" && !b.title], ["knockout", (b) => b.method === "KO"], ["title fight", (b) => !!b.title && !!b.winnerId],
    ["draw", (b) => b.method === "DRAW"], ["cancelled bout", (b) => b.status === "cancelled"], ["no result yet", (b) => !b.upcoming && !b.method && b.status !== "cancelled"],
  ];
  const pool = w.bouts.filter((b) => !b.upcoming || b.status === "cancelled");
  for (const [label, test] of bouts) { const b = pool.find(test); if (b) page(`/bouts/${b.id}`, `bout: ${label}`); }
  const up = first(upcoming);
  if (up) { page(`/bouts/${up.id}`, "bout: upcoming"); page(`/previews/${up.id}`, "fight preview"); }

  const events: [string, (e: (typeof w.events)[number]) => boolean][] = [
    ["completed card", (e) => !e.upcoming && e.status !== "cancelled"], ["upcoming card", (e) => e.upcoming && e.status !== "cancelled" && e.status !== "postponed"],
    ["postponed card", (e) => e.status === "postponed"], ["cancelled card", (e) => e.status === "cancelled"],
  ];
  for (const [label, test] of events) { const e = [...w.events].reverse().find(test); if (e) page(`/events/${e.id}`, `event: ${label}`); }

  const roles = (r: string) => [...w.people.values()].find((p) => w.roles.get(p.id)?.has(r));
  for (const r of ["trainer", "manager", "judge", "referee"]) { const p = roles(r); if (p) page(`/people/${p.slug}`, `person: ${r}`); }
  const org = (kind: string) => [...w.orgs.values()].find((o) => o.kind === kind);
  for (const k of ["gym", "promotion", "sanctioning_body"]) { const o = org(k); if (o) page(`/orgs/${o.slug}`, `org: ${k}`); }
  for (const b of belts(w).slice(0, 2)) page(`/titles/${b.slug}`, `belt: ${b.title}`);

  const div = boxers.find((b) => b.sex === "male")?.weightClass;
  if (div) page(`/rankings/${slugifyDivision(div)}`, "division ranking");
  if (woman) page(`/rankings/${slugifyDivision(woman.weightClass)}?sex=female`, "women's division ranking");
  for (const l of [LISTS.find((x) => x.subject === "boxer"), LISTS.find((x) => x.subject === "bout"), LISTS.find((x) => x.subject === "reign")]) if (l) page(`/all-time/${l.id}`, `all-time: ${l.id}`);
  const y = fightYears(w)[0];
  if (y !== undefined) page(`/fight-of-the-year/${y}`, "fight of the year");

  if (star) {
    out.push({ path: `/api/fighters?q=${q(star.name.slice(0, 4))}`, kind: "api", label: "api: fighter search" });
    out.push({ path: `/api/search?q=${q(star.name.slice(0, 4))}`, kind: "api", label: "api: search" });
    out.push({ path: `/api/watch?slugs=${star.slug}`, kind: "api", label: "api: watchlist" });
    out.push({ path: `/api/scout/${star.slug}`, kind: "api", label: "api: scouting report" });
    out.push({ path: `/api/art/portrait/${star.slug}.svg`, kind: "svg", label: "portrait image" });
  }
  if (up) out.push({ path: `/api/preview/${up.id}`, kind: "api", label: "api: preview article" });
  out.push({ path: "/this-page-does-not-exist", kind: "missing", label: "unknown page" });
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));
}

const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

/** What the reader would see, with no markup, scripts or styles. */
export const visibleText = (html: string): string => strip(html);

/**
 * Everything wrong with one response, as short messages (empty = fine). Page checks: a 200, a language and direction that
 * match the URL, exactly one-or-more h1, and no sign of a rendering slip in the text a reader sees (undefined, NaN,
 * [object Object], Infinity, an unfilled {placeholder}, a stack trace or Next's error page).
 */
export function problemsIn(route: SmokeRoute, locale: Locale, status: number, contentType: string, body: string): string[] {
  const bad: string[] = [];
  if (route.kind === "missing") {
    // Next streams a not-found page's content as flight data that the browser renders (a visitor with JavaScript sees the page;
    // one without sees nothing, PLAN.md §29), so the heading is looked for in the markup or the payload, and a real 404 plus noindex are required
    if (status !== 404) bad.push(`expected 404, got ${status}`);
    if (!/noindex/.test(body)) bad.push("the 404 page is not marked noindex");
    if (!/<h1|\\?"h1\\?"/i.test(body)) bad.push("the 404 page has no heading anywhere in its response");
    return bad;
  }
  if (status !== 200) return [`status ${status}`];
  if (route.kind === "api") {
    if (!/json/.test(contentType)) bad.push(`not JSON (${contentType})`);
    else { try { JSON.parse(body); } catch { bad.push("invalid JSON"); } }
    return bad;
  }
  if (route.kind === "svg") {
    if (!/image\/svg\+xml/.test(contentType)) bad.push(`not an SVG (${contentType})`);
    if (!body.startsWith("<svg")) bad.push("body is not an SVG document");
    return bad;
  }
  if (!/html/.test(contentType)) bad.push(`not HTML (${contentType})`);
  const dir = locale === "ar" ? "rtl" : "ltr";
  if (!new RegExp(`<html[^>]*lang="${locale}"`).test(body)) bad.push(`<html lang> is not "${locale}"`);
  if (!new RegExp(`<html[^>]*dir="${dir}"`).test(body)) bad.push(`<html dir> is not "${dir}"`);
  if (!/<h1[\s>]/i.test(body)) bad.push("no <h1>");
  const text = visibleText(body);
  const slips: [RegExp, string][] = [
    [/\bundefined\b/, "the word 'undefined'"], [/\bNaN\b/, "NaN"], [/\[object Object\]/, "[object Object]"], [/(?<![A-Za-z])-?Infinity\b/, "Infinity"],
    [/\{[a-zA-Z]+\}/, "an unfilled {placeholder}"], [/Application error|Internal Server Error|This page couldn.t load|digest:/i, "an error page"],
    [/\bnull\b(?! of)/, "the word 'null'"],
  ];
  for (const [re, what] of slips) { const m = text.match(re); if (m) bad.push(`${what} in the page text: "…${text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40).trim()}…"`); }
  return bad;
}
