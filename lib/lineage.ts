import type { World } from "./world";
import type { BoutRow, BoxerFull, Method } from "./types";
import { hasWinner } from "./methods";
import { slugifyDivision } from "./divisions";
import { slugify } from "./slug";
import { memo } from "./memo";
import type { T } from "./i18n/t";

export type HowWon = "won" | "vacant" | "inherited" | "first";

export interface Defense { boutId: number; opponentId: number; date: string; method: Method | null; endRound: number | null }

/** One boxer's time holding one belt. `end` is the date of the fight that ended it, or null while it runs. */
export interface Reign {
  n: number; // 1-based position in the belt's history
  boxerId: number;
  start: string;
  end: string | null;
  boutId: number; // the fight that made them champion
  opponentId: number | null; // who they beat to get it (null when the belt came to them with no title fight against the holder)
  how: HowWon;
  defenses: Defense[];
  draws: number; // title fights drawn while champion (the belt is kept)
  endedBy: "lost" | "vacated" | "passed" | null; // lost = beaten in a title fight, vacated = a vacant-title fight was held, passed = a title fight was won by someone else without the holder
  endedByBoutId: number | null;
  days: number;
}

export interface Belt {
  slug: string;
  orgId: number | null;
  orgName: string;
  title: string; // "World Title", "Interim World Title", "Continental Title"
  division: string;
  sex: "male" | "female";
  reigns: Reign[];
  titleFights: number;
  firstDate: string;
  lastDate: string;
  /** The reign that has not ended, and whether the belt looks live: its holder is active and a title fight was held in the last 18 months. */
  current: Reign | null;
  stale: boolean;
}

const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000));
const monthsAgo = (today: string, m: number) => new Date(Date.parse(today + "T12:00:00Z") - m * 30.4 * 86400000).toISOString().slice(0, 10);

/**
 * Belts and their champions, rebuilt from the title fights in the data. A belt is one sanctioning body, one title name
 * (so an interim belt is its own line), one division and one sex. Walking its title fights in date order:
 *  - the first winner on record becomes champion ("first on record": the lineage before the data starts is unknown);
 *  - a vacant-title fight makes its winner champion (and ends any reign still running, as "vacated");
 *  - the champion beating a challenger is a defence; the champion losing hands the belt to the winner;
 *  - a draw keeps the belt; a no-contest changes nothing;
 *  - if neither fighter is the champion and the bout is for the title, the belt "passed" to the winner (the champion was stripped or retired).
 * What the data cannot show (stripped, vacated by retirement, belts that changed hands with no title fight) is not guessed.
 */
export const belts = (w: World): Belt[] => memo(w, "belts", () => {
  const groups = new Map<string, { meta: Omit<Belt, "reigns" | "titleFights" | "firstDate" | "lastDate" | "current" | "stale">; bouts: BoutRow[] }>();
  for (const b of w.bouts) {
    if (!b.title || b.upcoming || !b.method || b.status === "cancelled" || b.method === "NC") continue;
    const sex = w.byId.get(b.redId)?.sex ?? "male";
    const org = b.titleOrgId ? w.orgs.get(b.titleOrgId) : undefined;
    const orgName = org?.name ?? "Unsanctioned";
    const slug = [slugify(orgName), slugify(b.title), slugifyDivision(b.weightClass), sex === "female" ? "women" : ""].filter(Boolean).join("-");
    const g = groups.get(slug) ?? groups.set(slug, { meta: { slug, orgId: org?.id ?? null, orgName, title: b.title, division: b.weightClass, sex }, bouts: [] }).get(slug)!;
    g.bouts.push(b);
  }
  const cutoff = monthsAgo(w.today, 18);
  const out: Belt[] = [];
  for (const { meta, bouts } of groups.values()) {
    const reigns: Reign[] = [];
    let cur = null as Reign | null;
    const end = (r: Reign, date: string, how: Reign["endedBy"], boutId: number | null) => { r.end = date; r.endedBy = how; r.endedByBoutId = boutId; r.days = daysBetween(r.start, date); };
    const crown = (boxerId: number, b: BoutRow, opponentId: number | null, how: HowWon): Reign => {
      const r: Reign = { n: reigns.length + 1, boxerId, start: b.date, end: null, boutId: b.id, opponentId, how, defenses: [], draws: 0, endedBy: null, endedByBoutId: null, days: 0 };
      reigns.push(r);
      return r;
    };
    for (const b of bouts) { // w.bouts is chronological
      const winner = hasWinner(b.method) ? b.winnerId : null;
      if (!winner) { if (cur && (b.redId === cur.boxerId || b.blueId === cur.boxerId)) cur.draws++; continue; }
      const loser = winner === b.redId ? b.blueId : b.redId;
      if (!cur) cur = crown(winner, b, loser, b.titleVacant ? "vacant" : "first");
      else if (b.titleVacant) { end(cur, b.date, "vacated", b.id); cur = crown(winner, b, loser, "vacant"); }
      else if (winner === cur.boxerId) cur.defenses.push({ boutId: b.id, opponentId: loser, date: b.date, method: b.method, endRound: b.endRound });
      else if (loser === cur.boxerId) { end(cur, b.date, "lost", b.id); cur = crown(winner, b, loser, "won"); }
      else { end(cur, b.date, "passed", b.id); cur = crown(winner, b, null, "inherited"); }
    }
    const last = reigns[reigns.length - 1];
    if (last && !last.end) last.days = daysBetween(last.start, w.today);
    const current = last && !last.end ? last : null;
    const lastDate = bouts[bouts.length - 1].date;
    const holder = current && w.byId.get(current.boxerId);
    out.push({ ...meta, reigns, titleFights: bouts.length, firstDate: bouts[0].date, lastDate, current, stale: !!current && (!holder?.active || lastDate < cutoff) });
  }
  return out.sort((a, b) => a.division.localeCompare(b.division) || a.orgName.localeCompare(b.orgName) || a.title.localeCompare(b.title));
});

export const beltBySlug = (w: World, slug: string): Belt | undefined => memo(w, "beltIndex", () => new Map(belts(w).map((b) => [b.slug, b]))).get(slug);

export interface HeldBelt { belt: Belt; reign: Reign }

/** Every reign a fighter has had, newest first. */
export const reignsOf = (w: World, boxerId: number): HeldBelt[] =>
  (memo(w, "reignsByBoxer", () => {
    const m = new Map<number, HeldBelt[]>();
    for (const belt of belts(w)) for (const reign of belt.reigns) (m.get(reign.boxerId) ?? m.set(reign.boxerId, []).get(reign.boxerId)!).push({ belt, reign });
    for (const l of m.values()) l.sort((a, b) => b.reign.start.localeCompare(a.reign.start));
    return m;
  }).get(boxerId) ?? []);

/** Belts a fighter holds right now (a live reign, even if the belt looks dormant). */
export const beltsHeld = (w: World, boxerId: number): Belt[] => reignsOf(w, boxerId).filter((h) => h.reign.end === null).map((h) => h.belt);

export interface BeltStats {
  champions: number;
  longest: Reign | null;
  mostDefenses: Reign | null;
  mostReigns: { boxer: BoxerFull; reigns: number } | null;
  totalDefenses: number;
}

export function beltStats(w: World, belt: Belt): BeltStats {
  const longest = belt.reigns.reduce<Reign | null>((m, r) => (!m || r.days > m.days ? r : m), null);
  const mostDefenses = belt.reigns.reduce<Reign | null>((m, r) => (!m || r.defenses.length > m.defenses.length ? r : m), null);
  const count = new Map<number, number>();
  for (const r of belt.reigns) count.set(r.boxerId, (count.get(r.boxerId) ?? 0) + 1);
  const top = [...count].sort((a, b) => b[1] - a[1])[0];
  const boxer = top ? w.byId.get(top[0]) : undefined;
  return { champions: count.size, longest, mostDefenses, mostReigns: boxer && top[1] > 1 ? { boxer, reigns: top[1] } : null, totalDefenses: belt.reigns.reduce((s, r) => s + r.defenses.length, 0) };
}

/** "Global Boxing Council (GBC) · World Title", names in the reader's language. The division is shown separately. */
export const beltLabel = (b: Belt, t: T): string => `${t.name(b.orgName)} · ${t.name(b.title)}`;
