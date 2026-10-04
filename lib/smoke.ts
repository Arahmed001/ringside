/**
 * The smoke check: every kind of page, in both languages, rendered by a real production server and inspected.
 * A build passing proves the code compiles, not that a page renders; this catches the pages that throw, show a raw
 * placeholder or "undefined", lose their heading or come back in the wrong language or direction. Pure helpers here
 * (route list, page inspection) so they are tested without a server; scripts/smoke.ts drives the server.
 */
import { countOn, shiftDay } from "./on-this-day";
import { careerView, recordStr, type World } from "./world";
import { NAV_GROUPS, OFF_NAV } from "./nav";
import { slugifyDivision } from "./divisions";
import { LISTS } from "./records";
import { belts } from "./lineage";
import { fightYears } from "./fight-score";
import { mulberry32 } from "./prng";
import { orgsRanking, trainerLeaderboard } from "./team";
import { judgeStats } from "./officials";
import { ORGS_PAGE, PEOPLE_PAGE } from "./people-list";

export type Locale = "en" | "ar";
export interface SmokeRoute { path: string; kind: "page" | "api" | "svg" | "missing"; label: string; /** text the page must show (a search that has to find someone) */ mustShow?: string; /** not requested on the Arabic site: the path carries English the person typed, which the page rightly echoes */ englishOnly?: boolean }

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
  // a fighter whose history Ringside holds only in part: the page shows the supplier's career total, and says so (a partial load; none in the demo league)
  const partial = boxers.find((b) => careerView(b).source === "supplier");
  if (partial) out.push({ path: `/boxers/${partial.slug}`, kind: "page", label: "fighter with a partial history (the supplier's career total shown)", mustShow: recordStr(partial) });
  if (star && woman) page(`/compare?a=${star.slug}&b=${boxers[1].slug}`, "matchup");
  page(`/boxers?q=${q("southpaw welterweights with 10+ KOs")}`, "plain-English search");
  page("/boxers?sex=female", "women's fighter list");
  // a name with a letter missing must still find the fighter (the nearest spellings are offered instead of an empty page): the best-rated fighter with a surname long enough to lose a letter
  const longName = boxers.find((b) => b.name.split(" ").slice(-1)[0].length >= 6);
  if (longName) {
    const p = longName.name.split(" "), last = p[p.length - 1];
    out.push({ path: `/boxers?q=${q(`${p.slice(0, -1).join(" ")} ${last.slice(0, 2)}${last.slice(3)}`)}`, kind: "page", label: "fighter search with a letter missing", mustShow: longName.name, englishOnly: true });
  }
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
  // the leaderboards are paged and have a name filter: a trainer below the first page must be on the second, and a judge spelt with a letter missing must still be found
  const trainers = trainerLeaderboard(w, 4);
  if (trainers.length > PEOPLE_PAGE) out.push({ path: "/people?role=trainer&page=2", kind: "page", label: "second page of the trainer leaderboard", mustShow: trainers[PEOPLE_PAGE].person.name });
  const judge = judgeStats(w).judges.find((j) => j.person.name.split(" ").slice(-1)[0].length >= 6);
  if (judge) {
    const p = judge.person.name.split(" "), last = p[p.length - 1];
    out.push({ path: `/people?role=judge&q=${q(`${p.slice(0, -1).join(" ")} ${last.slice(0, 2)}${last.slice(3)}`)}`, kind: "page", label: "judge search with a letter missing", mustShow: judge.person.name, englishOnly: true });
  }
  page("/people?role=trainer&page=9999", "trainer leaderboard page beyond the end");
  // gyms and promotions are paged and filterable too: a gym below the first page must be on the second, and a promotion spelt with a letter missing must be found
  const { gyms: rankedGyms, promos: rankedPromos } = orgsRanking(w);
  if (rankedGyms.length > ORGS_PAGE) out.push({ path: "/orgs?kind=gym&page=2", kind: "page", label: "second page of the gyms", mustShow: rankedGyms[ORGS_PAGE].o.name });
  const promo = rankedPromos.find((x) => x.o.name.split(" ").slice(-1)[0].length >= 6);
  if (promo) {
    const p = promo.o.name.split(" "), last = p[p.length - 1];
    out.push({ path: `/orgs?kind=promotion&q=${q(`${p.slice(0, -1).join(" ")} ${last.slice(0, 2)}${last.slice(3)}`.trim())}`, kind: "page", label: "promotion search with a letter missing", mustShow: promo.o.name, englishOnly: true });
  }
  page("/orgs?kind=gym&page=9999", "gym list page beyond the end");
  page("/rankings/welterweight?page=9999", "division ranking page beyond the end");
  page("/rankings/welterweight?q=zzzq", "division ranking filter that finds no one");
  const org = (kind: string) => [...w.orgs.values()].find((o) => o.kind === kind);
  for (const k of ["gym", "promotion", "sanctioning_body"]) { const o = org(k); if (o) page(`/orgs/${o.slug}`, `org: ${k}`); }
  for (const b of belts(w).slice(0, 2)) page(`/titles/${b.slug}`, `belt: ${b.title}`);

  const div = boxers.find((b) => b.sex === "male")?.weightClass;
  if (div) page(`/rankings/${slugifyDivision(div)}`, "division ranking");
  if (woman) page(`/rankings/${slugifyDivision(woman.weightClass)}?sex=female`, "women's division ranking");
  for (const l of [LISTS.find((x) => x.subject === "boxer"), LISTS.find((x) => x.subject === "bout"), LISTS.find((x) => x.subject === "reign")]) if (l) page(`/all-time/${l.id}`, `all-time: ${l.id}`);
  const y = fightYears(w)[0];
  if (y !== undefined) page(`/fight-of-the-year/${y}`, "fight of the year");

  // on this day: the busiest date, one with nothing on it, the leap day, and a date that does not exist (a 404, not a quietly different page)
  const days = Array.from({ length: 366 }, (_, i) => shiftDay("01-01", i)).map((k) => ({ k, n: countOn(w, k).fights + countOn(w, k).births }));
  const busiest = days.reduce((a, b) => (b.n > a.n ? b : a)), quiet = days.find((d) => d.n === 0);
  if (busiest.n > 0) page(`/on-this-day?d=${busiest.k}`, "on this day: busiest date");
  if (quiet) page(`/on-this-day?d=${quiet.k}`, "on this day: a date with nothing on it");
  page("/on-this-day?d=02-29", "on this day: leap day");
  out.push({ path: "/on-this-day?d=02-30", kind: "missing", label: "on this day: a date that does not exist" });

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

/** `n` of the items, the same ones every time for a seed, in no particular order (all of them when `n` is as many as there are). */
function sample<T>(items: T[], n: number, seed: number): T[] {
  if (n >= items.length) return items;
  const r = mulberry32(seed);
  return items.map((x) => ({ x, k: r() })).sort((a, b) => a.k - b.k).slice(0, n).map((e) => e.x);
}

/**
 * Many more pages than `smokeRoutes`, for hunting what only some records trip: up to `perKind` of every kind of page with a parameter (fighters, bouts, events,
 * people, organisations, previews, belts), plus every division's ranking for both sexes, every all-time list, every fight-of-the-year and a head to head for the
 * fighters of each sampled bout. Fighters are chosen to include the extremes (the most and the fewest fights, the oldest and youngest, no facts at all) before
 * the random ones. The same league and seed always give the same pages.
 */
export function crawlRoutes(w: World, perKind: number, seed = 5): SmokeRoute[] {
  const out: SmokeRoute[] = [];
  const page = (path: string, label: string) => out.push({ path, kind: "page", label });
  const byBouts = [...w.boxers].sort((a, b) => b.bouts - a.bouts || a.id - b.id);
  const unknown = w.boxers.filter((b) => b.reachCm === null || b.heightCm === null || b.birthYear === null || b.stance === null);
  const extremes = [...byBouts.slice(0, 5), ...byBouts.slice(-5), ...unknown.slice(0, 5), ...[...w.boxers].filter((b) => b.age !== null).sort((a, b) => (b.age ?? 0) - (a.age ?? 0)).slice(0, 3)];
  const fighters = [...new Map([...extremes, ...sample(w.boxers, perKind, seed)].map((b) => [b.id, b])).values()];
  for (const b of fighters) page(`/boxers/${b.slug}`, "crawl: fighter");
  const bouts = sample(w.bouts, perKind, seed + 1);
  for (const b of bouts) page(`/bouts/${b.id}`, "crawl: bout");
  for (const b of bouts.slice(0, Math.ceil(perKind / 2))) { const red = w.byId.get(b.redId), blue = w.byId.get(b.blueId); if (red && blue) page(`/compare?a=${red.slug}&b=${blue.slug}`, "crawl: head to head"); }
  for (const b of sample(w.bouts.filter((x) => x.upcoming && x.status !== "cancelled"), perKind, seed + 2)) page(`/previews/${b.id}`, "crawl: preview");
  for (const e of sample(w.events, perKind, seed + 3)) page(`/events/${e.id}`, "crawl: event");
  for (const p of sample([...w.people.values()], perKind, seed + 4)) page(`/people/${p.slug}`, "crawl: person");
  for (const o of sample([...w.orgs.values()], perKind, seed + 5)) page(`/orgs/${o.slug}`, "crawl: organisation");
  for (const b of belts(w)) page(`/titles/${b.slug}`, "crawl: belt");
  for (const d of new Set(w.boxers.map((b) => `${b.sex}|${b.weightClass}`))) { const [sex, name] = d.split("|"); page(`/rankings/${slugifyDivision(name)}${sex === "female" ? "?sex=female" : ""}`, "crawl: division ranking"); }
  for (const l of LISTS) page(`/all-time/${l.id}`, "crawl: all-time list");
  for (const y of fightYears(w)) page(`/fight-of-the-year/${y}`, "crawl: fight of the year");
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
  if (route.label === "home") {
    // the home page's two commitments: one heading (the next fight, or the brand line between seasons) and a question box that goes to /ask
    if ((body.match(/<h1[\s>]/gi) ?? []).length !== 1) bad.push("the home page should have exactly one <h1>");
    if (!/<h2[^>]*\sid="ask"/.test(body)) bad.push("the home page has no ask-the-data section");
    if (!new RegExp(`<form[^>]*\\saction="${locale === "ar" ? "/ar" : ""}/ask"`).test(body)) bad.push("the home page's question box does not go to /ask");
  }
  const text = visibleText(body);
  if (route.mustShow && locale === "en" && !text.includes(route.mustShow)) bad.push(`the page does not show "${route.mustShow}"`);
  const slips: [RegExp, string][] = [
    [/\bundefined\b/, "the word 'undefined'"], [/\bNaN\b/, "NaN"], [/\[object Object\]/, "[object Object]"], [/(?<![A-Za-z])-?Infinity\b/, "Infinity"],
    [/\{[a-zA-Z]+\}/, "an unfilled {placeholder}"], [/Application error|Internal Server Error|This page couldn.t load|digest:/i, "an error page"],
    [/\bnull\b(?! of)/, "the word 'null'"],
  ];
  for (const [re, what] of slips) { const m = text.match(re); if (m) bad.push(`${what} in the page text: "…${text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40).trim()}…"`); }
  return bad;
}

/**
 * English left behind on an Arabic page. Looked for in the page's own HTML (client components are rendered into it too):
 *  - any Latin word of three or more letters in the text a reader sees, in the title or in the description, one block of text at a time,
 *  - any attribute a reader's tools announce (aria-label, title, placeholder, alt) that has Latin words and no Arabic.
 * Not counted: brand and technical terms (`LATIN_OK`), text inside an element marked `lang="en"` (words that are English by nature, such as a
 * data source's name or a validator message, which a screen reader should say in English anyway), and ALL-CAPS abbreviations of five letters or fewer.
 * Only meaningful for the demo league, whose names are all transliterated; a real feed's untransliterated names would be flagged.
 */
export const LATIN_OK = [/\bRingside\b/g, /\bElo\b/g, /\bPCA\b/g, /\bClaude\b/g, /\bEnglish\b/g /* the language switch names the other language in itself */, /\bnpm run [\w:-]+/g, /\bhttps?\b/g /* a protocol name, written as it is in Arabic prose too */, /\bsample\.json\b/g, /\bdata:check\b/g, /Demo earnings list \(simulated\)/g /* the demo provider's own source label */,
  /\b(?:Olympedia|BoxRec|CompuBox|Wikidata|Wikimedia|Commons|Forbes|Sportico|ESPN)\b/g /* other organisations' names */, /\blib\/providers\b/g, /\bPLAN\.md\b/g, /\bdemo\b/g /* the demo provider's name, shown as a data source */,
  /\blog-loss\b/g, /\bBrier\b/g /* statistics terms the Data page keeps in Latin until a native reviewer decides on an Arabic wording */];
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** Removes every element marked lang="en", with whatever is inside it (nested elements of the same name included). */
export function withoutEnglishIslands(html: string): string {
  const open = /<([a-z][a-z0-9]*)\b[^>]*\slang="en"[^>]*>/i;
  let out = html;
  for (let guard = 0; guard < 5000; guard++) {
    const m = open.exec(out);
    if (!m) return out;
    const tag = m[1].toLowerCase(), re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    re.lastIndex = m.index + m[0].length;
    let depth = 1, end = -1, x: RegExpExecArray | null;
    while ((x = re.exec(out))) { depth += x[1] ? -1 : /\/>$/.test(x[0]) ? 0 : 1; if (depth === 0) { end = x.index + x[0].length; break; } }
    out = out.slice(0, m.index) + " " + (end < 0 ? "" : out.slice(end));
  }
  return out;
}

export function arabicLeaks(html: string): string[] {
  const out: string[] = [];
  const clean = (s: string) => LATIN_OK.reduce((t, re) => t.replace(re, " "), decode(s).replace(/\bR\s+Ring\s*side\b/g, " ")).replace(/\b[A-Z]{2,5}\b/g, " ");
  const head = [...html.matchAll(/<title[^>]*>([^<]*)<\/title>/gi), ...html.matchAll(/<meta[^>]+(?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)"[^>]+content="([^"]*)"/gi)].map((m) => m[1]);
  const body = withoutEnglishIslands(html.replace(/<head[\s\S]*?<\/head>/i, "")).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const blocks = [...head.map((h) => ["head", h] as const), ...body.split(/<[^>]+>/).map((t) => ["text", t] as const)];
  for (const [where, text] of blocks) {
    const words = clean(text).match(/[A-Za-z][A-Za-z'’-]{2,}/g);
    if (words) out.push(`${where}: "${decode(text).trim().replace(/\s+/g, " ").slice(0, 80)}"`);
  }
  const attrs = withoutEnglishIslands(html);
  for (const m of attrs.matchAll(/\s(aria-label|title|placeholder|alt)="([^"]*)"/g)) {
    const v = clean(m[2]).trim();
    if (v && !/[\u0600-\u06ff]/.test(v) && /[A-Za-z]{3,}/.test(v)) out.push(`${m[1]}: "${decode(m[2]).slice(0, 80)}"`);
  }
  return [...new Set(out)];
}
