import type { World } from "./world";
import type { BoxerFull, EventRow, Org, Person } from "./types";
import { isEmptyTable, searchFighters } from "./fighter-search";
import { normalize } from "./fighter-search";
import { buildWordIndex, nearTexts, wordsOf } from "./fuzzy";
import { divisionLabel } from "./divisions";
import { countryName, fmtDate } from "./format";
import { recordStr } from "./world";
import { msg, type Names, type T } from "./i18n/t";
import { ROLE_LABEL } from "./team";

export type HitKind = "page" | "fighter" | "person" | "event" | "org";
export interface SearchHit { kind: HitKind; title: string; subtitle?: string; href: string }

/** The pages ⌘K can jump to (locale-free paths; keywords help "weigh" find Weigh-ins). */
export const PAGES: { href: string; label: string; words: string }[] = [
  { href: "/rankings", label: msg("Rankings"), words: "rankings pound for pound p4p divisions" },
  { href: "/tonight", label: msg("Tonight"), words: "tonight today tonights fight night live card results now" },
  { href: "/previews", label: msg("Fight previews"), words: "previews preview upcoming fights predictions picks what to watch" },
  { href: "/titles", label: msg("Title lineages"), words: "titles belts champions lineage reigns world continental" },
  { href: "/all-time", label: msg("All-time lists"), words: "all-time records greatest of all time goat longest reign most knockouts fastest knockout biggest upsets best fights" },
  { href: "/fight-of-the-year", label: msg("Fight of the year"), words: "fight of the year foty best fight award greatest fights" },
  { href: "/on-this-day", label: msg("On this day"), words: "on this day today in boxing history anniversary birthday born date calendar" },
  { href: "/upset-watch", label: msg("Upset watch"), words: "upset watch underdog danger longshot alerts feed surprises" },
  { href: "/trainers", label: msg("Trainer impact"), words: "trainer impact effect camp coach head trainer switch changing trainer underdog" },
  { href: "/ask", label: msg("Ask the data"), words: "ask question answer ai chat natural language query data who has the most" },
  { href: "/matchmaking", label: msg("Matchmaking"), words: "matchmaking fights to make next opponent dream fight builder" },
  { href: "/boxers", label: msg("Fighters"), words: "fighters boxers search" },
  { href: "/events", label: msg("Events"), words: "events cards calendar schedule results" },
  { href: "/compare", label: msg("Matchups"), words: "matchups compare predictor predictions" },
  { href: "/people", label: msg("Corners"), words: "corners trainers managers judges referees" },
  { href: "/orgs", label: msg("Gyms, promotions & bodies"), words: "gyms promotions promoters belts sanctioning" },
  { href: "/weights", label: msg("Weigh-ins"), words: "weigh-ins weights scale" },
  { href: "/money", label: msg("Fight money"), words: "money purses gate ppv pay-per-view earnings revenue tickets broadcasters viewers" },
  { href: "/analytics", label: msg("Analytics"), words: "analytics statistics stats" },
  { href: "/tour", label: msg("Take the tour"), words: "tour video walkthrough demo intro guide how it works getting started new" },
  { href: "/watchlist", label: msg("My watchlist"), words: "my watchlist watch list follow following starred favourite favorite fighters next fight" },
  { href: "/picks", label: msg("My picks"), words: "my picks pick em pickem predictions streak record vs model" },
  { href: "/accountability", label: msg("Track record"), words: "track record accountability accuracy calibration backtest model predictions how good" },
  { href: "/map", label: msg("Style map"), words: "style map" },
  { href: "/data", label: msg("Data"), words: "data model coverage sources" },
  { href: "/privacy", label: msg("Privacy"), words: "privacy data cookies delete account export personal information storage tracking gdpr" },
  { href: "/terms", label: msg("Terms"), words: "terms conditions small print use betting advice affiliated removal correction legal" },
];

const ROLE_ORDER = ["trainer", "manager", "judge", "referee"] as const;
const ROLE_NAME = { trainer: msg("Trainer"), manager: msg("Manager"), judge: msg("Judge"), referee: msg("Referee") };
const KIND_NAME: Record<string, string> = { gym: msg("Gym"), promotion: msg("Promotion"), sanctioning_body: msg("Sanctioning body"), broadcaster: msg("Broadcaster") };
void ROLE_LABEL;

/** The other things the palette finds, as lists with an index of their words, per world and per table of translated names, for the near-spelling guesses. */
interface NearGroup<T> { items: T[]; vocab: Map<string, number[]> }
interface Near { people: NearGroup<Person>; events: NearGroup<EventRow>; orgs: NearGroup<Org> }
const nearCache = new WeakMap<World, WeakMap<Names, Near>>();
const NO_TABLE: Names = {};
/** Exported so a test can see that the index is built once per world and table, not once per keystroke. */
export function nearOf(w: World, names: Names): Near {
  if (isEmptyTable(names)) names = NO_TABLE;
  let per = nearCache.get(w);
  if (!per) { per = new WeakMap(); nearCache.set(w, per); }
  let near = per.get(names);
  if (!near) {
    const group = <T,>(items: T[], parts: (x: T) => (string | undefined | null)[]): NearGroup<T> => ({ items, vocab: buildWordIndex(items.map((x) => normalize(parts(x).filter(Boolean).join(" ")))) });
    near = {
      people: group([...w.people.values()], (p) => [p.name, names[p.name]]),
      events: group(w.events.filter((e) => e.status !== "cancelled"), (e) => [e.name, names[e.name], e.city, names[e.city], e.venue, names[e.venue]]),
      orgs: group([...w.orgs.values()], (o) => [o.name, names[o.name]]),
    };
    per.set(names, near);
  }
  return near;
}
/** What the exact match reads, folded once per world and table of translated names instead of once per keystroke: each person, event and organisation's searchable text. */
interface Exact { people: { p: Person; hay: string }[]; orgs: { o: Org; hay: string }[]; /** newest first, called-off events left out */ events: { e: EventRow; hay: string }[] }
const exactCache = new WeakMap<World, WeakMap<Names, Exact>>();
/** Exported so a test can see that the index is built once per world and table, not once per keystroke. */
export function exactOf(w: World, names: Names): Exact {
  if (isEmptyTable(names)) names = NO_TABLE;
  let per = exactCache.get(w);
  if (!per) { per = new WeakMap(); exactCache.set(w, per); }
  let ex = per.get(names);
  if (!ex) {
    const fold = (...parts: (string | undefined | null)[]) => normalize(parts.filter(Boolean).join(" "));
    ex = {
      people: [...w.people.values()].map((p) => ({ p, hay: fold(p.name, names[p.name]) })),
      orgs: [...w.orgs.values()].map((o) => ({ o, hay: fold(o.name, names[o.name]) })),
      events: w.events.filter((e) => e.status !== "cancelled").reverse().map((e) => ({ e, hay: fold(e.name, names[e.name], e.city, names[e.city], e.venue, names[e.venue]) })),
    };
    per.set(names, ex);
  }
  return ex;
}

/** The items of a group with a word close to each word typed, fewest slips first, capped. */
function nearItems<T>(g: NearGroup<T>, typed: string[], order: (a: T, b: T) => number, cap: number): T[] {
  return [...nearTexts(g.vocab, typed)].map(([i, cost]) => ({ x: g.items[i], cost })).sort((a, b) => a.cost - b.cost || order(a.x, b.x)).slice(0, cap).map((r) => r.x);
}

/**
 * Everything ⌘K searches: fighters, trainers/managers/judges/referees, events (name, city, venue), gyms/promotions/bodies, and the
 * site's pages. Matches English and, when a name table is given, Arabic spellings; each group is capped so the list stays scannable.
 */
export function globalSearch(w: World, query: string, t: T, names: Names, perGroup = 5): SearchHit[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const words = q.split(" ");
  const matchHay = (hay: string) => (words.every((x) => hay.includes(x)) ? (hay.startsWith(q) ? 0 : 1) : -1);
  const match = (...parts: (string | undefined | null)[]) => matchHay(normalize(parts.filter(Boolean).join(" ")));
  const out: SearchHit[] = [];

  const pages = PAGES.map((p) => ({ p, r: match(t(p.label), p.label, p.words) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r).slice(0, 3);
  for (const { p } of pages) out.push({ kind: "page", title: t(p.label), href: p.href });

  const fighterHit = (b: BoxerFull): SearchHit => ({ kind: "fighter", title: t.name(b.name), subtitle: `${recordStr(b)} · ${divisionLabel(b.weightClass, b.sex, t)} · ${countryName(b.country, t.locale)}`, href: `/boxers/${b.slug}` });
  for (const b of searchFighters(w, query, { limit: perGroup, names, forgiving: false })) out.push(fighterHit(b));

  const exact = exactOf(w, names);
  const people = exact.people.map(({ p, hay }) => ({ p, r: matchHay(hay) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name)).slice(0, perGroup);
  const personHit = (p: Person): SearchHit => {
    const roles = ROLE_ORDER.filter((r) => w.roles.get(p.id)?.has(r)).map((r) => t(ROLE_NAME[r]));
    return { kind: "person", title: t.name(p.name), subtitle: roles.join(" · ") || undefined, href: `/people/${p.slug}` };
  };
  const eventHit = (e: EventRow): SearchHit => ({ kind: "event", title: t.name(e.name), subtitle: `${fmtDate(e.date, undefined, t.locale)} · ${t.name(e.city)}`, href: `/events/${e.id}` });
  const orgHit = (o: Org): SearchHit => ({ kind: "org", title: t.name(o.name), subtitle: [t(KIND_NAME[o.kind] ?? "Organisation"), o.city ? t.name(o.city) : null].filter(Boolean).join(" · "), href: `/orgs/${o.slug}` });
  for (const { p } of people) out.push(personHit(p));

  const events: { e: (typeof w.events)[number]; r: number }[] = [];
  for (const { e, hay } of exact.events) { // newest first, stop when full
    if (events.length >= perGroup) break;
    const r = matchHay(hay);
    if (r >= 0) events.push({ e, r });
  }
  for (const { e } of events.sort((a, b) => a.r - b.r)) out.push(eventHit(e));

  const orgs = exact.orgs.map(({ o, hay }) => ({ o, r: matchHay(hay) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r || a.o.name.localeCompare(b.o.name)).slice(0, perGroup);
  for (const { o } of orgs) out.push(orgHit(o));
  // A typo in a name is only worth a guess when nothing else matched: otherwise "rankigns" would show names beside the page it means.
  // Then every kind of name gets one, close spellings first.
  if (!out.length) {
    const near = nearOf(w, names), typed = wordsOf(q);
    for (const b of searchFighters(w, query, { limit: perGroup, names })) out.push(fighterHit(b));
    for (const p of nearItems(near.people, typed, (a, b) => a.name.localeCompare(b.name), perGroup)) out.push(personHit(p));
    for (const e of nearItems(near.events, typed, (a, b) => b.date.localeCompare(a.date) || b.id - a.id, perGroup)) out.push(eventHit(e));
    for (const o of nearItems(near.orgs, typed, (a, b) => a.name.localeCompare(b.name), perGroup)) out.push(orgHit(o));
  }
  return out;
}
