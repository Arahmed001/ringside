import type { World } from "./world";
import { searchFighters } from "./fighter-search";
import { normalize } from "./fighter-search";
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
  { href: "/previews", label: msg("Fight previews"), words: "previews preview upcoming fights predictions picks what to watch" },
  { href: "/titles", label: msg("Title lineages"), words: "titles belts champions lineage reigns world continental" },
  { href: "/all-time", label: msg("All-time lists"), words: "all-time records greatest of all time goat longest reign most knockouts fastest knockout biggest upsets best fights" },
  { href: "/fight-of-the-year", label: msg("Fight of the year"), words: "fight of the year foty best fight award greatest fights" },
  { href: "/upset-watch", label: msg("Upset watch"), words: "upset watch underdog danger longshot alerts feed surprises" },
  { href: "/trainers", label: msg("Trainer impact"), words: "trainer impact effect camp coach head trainer switch changing trainer underdog" },
  { href: "/matchmaking", label: msg("Matchmaking"), words: "matchmaking fights to make next opponent dream fight builder" },
  { href: "/boxers", label: msg("Fighters"), words: "fighters boxers search" },
  { href: "/events", label: msg("Events"), words: "events cards calendar schedule results" },
  { href: "/compare", label: msg("Matchups"), words: "matchups compare predictor predictions" },
  { href: "/people", label: msg("Corners"), words: "corners trainers managers judges referees" },
  { href: "/orgs", label: msg("Gyms, promotions & bodies"), words: "gyms promotions promoters belts sanctioning" },
  { href: "/weights", label: msg("Weigh-ins"), words: "weigh-ins weights scale" },
  { href: "/money", label: msg("Fight money"), words: "money purses gate ppv pay-per-view earnings revenue tickets broadcasters viewers" },
  { href: "/analytics", label: msg("Analytics"), words: "analytics statistics stats" },
  { href: "/accountability", label: msg("Track record"), words: "track record accountability accuracy calibration backtest model predictions how good" },
  { href: "/map", label: msg("Style Map"), words: "style map" },
  { href: "/data", label: msg("Data"), words: "data model coverage sources" },
];

const ROLE_ORDER = ["trainer", "manager", "judge", "referee"] as const;
const ROLE_NAME = { trainer: msg("Trainer"), manager: msg("Manager"), judge: msg("Judge"), referee: msg("Referee") };
const KIND_NAME: Record<string, string> = { gym: msg("Gym"), promotion: msg("Promotion"), sanctioning_body: msg("Sanctioning body"), broadcaster: msg("Broadcaster") };
void ROLE_LABEL;

/**
 * Everything ⌘K searches: fighters, trainers/managers/judges/referees, events (name, city, venue), gyms/promotions/bodies, and the
 * site's pages. Matches English and, when a name table is given, Arabic spellings; each group is capped so the list stays scannable.
 */
export function globalSearch(w: World, query: string, t: T, names: Names, perGroup = 5): SearchHit[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const words = q.split(" ");
  const match = (...parts: (string | undefined | null)[]) => {
    const hay = normalize(parts.filter(Boolean).join(" "));
    return words.every((x) => hay.includes(x)) ? (hay.startsWith(q) ? 0 : 1) : -1;
  };
  const out: SearchHit[] = [];

  const pages = PAGES.map((p) => ({ p, r: match(t(p.label), p.label, p.words) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r).slice(0, 3);
  for (const { p } of pages) out.push({ kind: "page", title: t(p.label), href: p.href });

  for (const b of searchFighters(w, query, { limit: perGroup, names }))
    out.push({ kind: "fighter", title: t.name(b.name), subtitle: `${recordStr(b)} · ${divisionLabel(b.weightClass, b.sex, t)} · ${countryName(b.country, t.locale)}`, href: `/boxers/${b.slug}` });

  const people = [...w.people.values()].map((p) => ({ p, r: match(p.name, names[p.name]) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name)).slice(0, perGroup);
  for (const { p } of people) {
    const roles = ROLE_ORDER.filter((r) => w.roles.get(p.id)?.has(r)).map((r) => t(ROLE_NAME[r]));
    out.push({ kind: "person", title: t.name(p.name), subtitle: roles.join(" · ") || undefined, href: `/people/${p.slug}` });
  }

  const events: { e: (typeof w.events)[number]; r: number }[] = [];
  for (let i = w.events.length - 1; i >= 0 && events.length < perGroup; i--) { // newest first, stop when full
    const e = w.events[i];
    const r = match(e.name, names[e.name], e.city, names[e.city], e.venue, names[e.venue]);
    if (r >= 0 && e.status !== "cancelled") events.push({ e, r });
  }
  for (const { e } of events.sort((a, b) => a.r - b.r)) out.push({ kind: "event", title: t.name(e.name), subtitle: `${fmtDate(e.date, undefined, t.locale)} · ${t.name(e.city)}`, href: `/events/${e.id}` });

  const orgs = [...w.orgs.values()].map((o) => ({ o, r: match(o.name, names[o.name]) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r || a.o.name.localeCompare(b.o.name)).slice(0, perGroup);
  for (const { o } of orgs) out.push({ kind: "org", title: t.name(o.name), subtitle: [t(KIND_NAME[o.kind] ?? "Organisation"), o.city ? t.name(o.city) : null].filter(Boolean).join(" · "), href: `/orgs/${o.slug}` });
  return out;
}
