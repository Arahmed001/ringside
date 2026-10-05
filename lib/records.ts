import type { World } from "./world";
import type { BoutRow, BoxerFull } from "./types";
import { hasWinner, isStoppage } from "./methods";
import { belts, reignsOf, type Belt, type Reign } from "./lineage";
import { bestFightsEver, type FightScore } from "./fight-score";
import { biggestUpsets } from "./analytics";
import { msg, type T } from "./i18n/t";
import { divisionFromSlug } from "./divisions";
import { memo } from "./memo";

export interface Scope { sex?: "male" | "female"; division?: string }

export type ListId =
  | "greatest" | "peak" | "wins" | "kos" | "ko-rate" | "win-streak" | "quality-wins" | "title-wins"
  | "defenses" | "longest-reign" | "reign-defenses" | "divisions"
  | "fights" | "upsets" | "fastest-kos" | "knockdowns";

export type Group = "fighters" | "titles" | "fights";

export interface ListDef {
  id: ListId;
  group: Group;
  title: string;
  blurb: string;
  /** What a row is about: a fighter, one fight, or one reign of one belt. */
  subject: "boxer" | "bout" | "reign";
  /** Whether the sex and division filters apply (every list but a few is scoped). */
  scoped: boolean;
}

/** Every list, in the order the hub shows them. The `msg` marks are what the translation scanner picks up. */
export const LISTS: ListDef[] = [
  { id: "greatest", group: "fighters", subject: "boxer", scoped: true, title: msg("Greatest of all time"),
    blurb: msg("A legacy score from six things: the highest rating reached, wins over highly rated opponents, years as champion, title defences, the longest winning run, and honours. The weights are a judgment; each part is shown out of 100 on every row. Fighters with ten or more bouts.") },
  { id: "peak", group: "fighters", subject: "boxer", scoped: true, title: msg("Highest peak rating"),
    blurb: msg("The best rating anyone reached, after any fight. Ratings are Elo-style and unofficial.") },
  { id: "wins", group: "fighters", subject: "boxer", scoped: true, title: msg("Most wins"), blurb: msg("Wins on record, by any method.") },
  { id: "kos", group: "fighters", subject: "boxer", scoped: true, title: msg("Most knockouts"), blurb: msg("Wins by knockout, technical knockout or corner retirement.") },
  { id: "ko-rate", group: "fighters", subject: "boxer", scoped: true, title: msg("Highest knockout rate"), blurb: msg("The share of wins that ended early. Fighters with at least 15 wins.") },
  { id: "win-streak", group: "fighters", subject: "boxer", scoped: true, title: msg("Longest winning run"), blurb: msg("The most wins in a row at any point in a career. Draws and no-contests do not break a run; a loss does.") },
  { id: "quality-wins", group: "fighters", subject: "boxer", scoped: true, title: msg("Most wins over top opposition"), blurb: msg("Wins over opponents who were rated 1600 or higher going into the fight.") },
  { id: "title-wins", group: "titles", subject: "boxer", scoped: true, title: msg("Most title fight wins"), blurb: msg("Wins in fights with a title on the line, defences and challenges alike.") },
  { id: "defenses", group: "titles", subject: "boxer", scoped: true, title: msg("Most title defences"), blurb: msg("Successful defences added up over every reign.") },
  { id: "longest-reign", group: "titles", subject: "reign", scoped: true, title: msg("Longest title reigns"), blurb: msg("Days as champion of one belt in one reign. A reign that is still running counts up to today.") },
  { id: "reign-defenses", group: "titles", subject: "reign", scoped: true, title: msg("Most defences in a single reign"), blurb: msg("The longest chain of defences without losing the belt.") },
  { id: "divisions", group: "titles", subject: "boxer", scoped: false, title: msg("Champions in the most divisions"), blurb: msg("Different weight divisions in which a fighter has been champion of a belt.") },
  { id: "fights", group: "fights", subject: "bout", scoped: true, title: msg("Greatest fights"), blurb: msg("The highest fight scores in the data: knockdowns, a close or late finish, plenty of action, evenly matched fighters, an upset, a title on the line, a comeback. The same score that picks each year’s fight of the year.") },
  { id: "upsets", group: "fights", subject: "bout", scoped: true, title: msg("Biggest upsets"), blurb: msg("The largest rating gaps overcome by the winner, using each fighter’s rating going into the fight.") },
  { id: "fastest-kos", group: "fights", subject: "bout", scoped: true, title: msg("Fastest knockouts"), blurb: msg("Knockouts and stoppages ended soonest after the opening bell.") },
  { id: "knockdowns", group: "fights", subject: "bout", scoped: true, title: msg("Most knockdowns in a fight"), blurb: msg("Both fighters’ knockdowns added together.") },
];

export const listDef = (id: string): ListDef | undefined => LISTS.find((l) => l.id === id);
export const GROUP_TITLE: Record<Group, string> = { fighters: msg("Fighters"), titles: msg("Titles"), fights: msg("Fights") };

export interface Row {
  rank: number;
  boxer?: BoxerFull;
  bout?: BoutRow;
  belt?: Belt;
  reign?: Reign;
  value: number;
  /** Extra numbers for the line under the value (legacy score parts, peak date, seconds into a round ...). */
  detail?: Record<string, number | string>;
}

// ---- one pass over every career ----

interface Career {
  peak: number; peakDate: string | null;
  qualityWins: number; titleWins: number;
  defenses: number; reignDays: number;
  streak: number;
  divisions: Set<string>;
}
const QUALITY = 1600;

const careers = (w: World): Map<number, Career> => memo(w, "careers", () => {
  const m = new Map<number, Career>();
  const get = (id: number) => m.get(id) ?? m.set(id, { peak: 1500, peakDate: null, qualityWins: 0, titleWins: 0, defenses: 0, reignDays: 0, streak: 0, divisions: new Set() }).get(id)!;
  for (const [id, hist] of w.history) {
    const c = get(id);
    for (const h of hist) if (h.rating > c.peak || c.peakDate === null) { c.peak = h.rating; c.peakDate = h.date; }
  }
  for (const [id, list] of w.boutsByBoxer) {
    const c = get(id);
    let run = 0;
    for (const b of list) {
      if (b.upcoming || !b.method || b.method === "NC") continue;
      if (b.winnerId === id && hasWinner(b.method)) {
        run++; if (run > c.streak) c.streak = run;
        if (b.title) c.titleWins++;
        const pre = w.boutPre.get(b.id);
        const opp = pre ? (id === b.redId ? pre.blue : pre.red) : 1500;
        if (opp >= QUALITY) c.qualityWins++;
      } else if (b.winnerId !== null) run = 0; // a loss; a draw leaves the run alone
    }
  }
  for (const belt of belts(w)) for (const r of belt.reigns) {
    const c = get(r.boxerId);
    c.defenses += r.defenses.length; c.reignDays += reignDays(belt, r); c.divisions.add(belt.division);
  }
  return m;
});

const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000));
/** Days a reign lasted. One that is still "running" on a dormant belt (its holder is inactive) stops at the belt's last title fight instead of counting on to today. */
export const reignDays = (belt: Belt, r: Reign): number => (r.end === null && belt.stale ? daysBetween(r.start, belt.lastDate) : r.days);

const LEGACY: { key: string; weight: number; part: (c: Career, honours: number) => number | null }[] = [
  { key: "peak", weight: 0.30, part: (c) => Math.min(1, Math.max(0, (c.peak - 1500) / 300)) },
  { key: "quality", weight: 0.25, part: (c) => Math.min(1, c.qualityWins / 8) },
  { key: "reign", weight: 0.15, part: (c) => Math.min(1, c.reignDays / (365 * 8)) },
  { key: "defenses", weight: 0.10, part: (c) => Math.min(1, c.defenses / 15) },
  { key: "streak", weight: 0.10, part: (c) => Math.min(1, c.streak / 30) },
  { key: "honours", weight: 0.10, part: (_c, honours) => (honours > 0 ? Math.min(1, honours / 3) : null) },
];
export const LEGACY_PARTS = LEGACY.map((p) => p.key);
const hasHonours = (w: World) => memo(w, "hasHonours", () => w.honoursByBoxer.size > 0);

const inScope = (b: BoxerFull, s: Scope) => (!s.sex || b.sex === s.sex) && (!s.division || b.weightClass === s.division);
const boutInScope = (w: World, b: BoutRow, s: Scope) => (!s.division || b.weightClass === s.division) && (!s.sex || w.byId.get(b.redId)?.sex === s.sex);
const done = (w: World): BoutRow[] => memo(w, "records:done", () => w.bouts.filter((b) => !b.upcoming && b.status === "completed" && !!b.method));

const rankRows = <T extends Omit<Row, "rank">>(rows: T[], n: number, tie?: (a: T, b: T) => number): Row[] =>
  rows.sort((a, b) => b.value - a.value || (tie ? tie(a, b) : 0)).slice(0, n).map((r, i) => ({ ...r, rank: i + 1 }));

const alphabetical = (a: { boxer?: BoxerFull }, b: { boxer?: BoxerFull }) => (a.boxer?.name ?? "").localeCompare(b.boxer?.name ?? "");

/** The seconds a bout lasted before it ended, counting from the first bell. `roundTime` is the clock in the final round. */
export function secondsIn(b: BoutRow): number | null {
  if (!b.endRound) return null;
  const m = /^(\d+):(\d{2})$/.exec(b.roundTime ?? "");
  return (b.endRound - 1) * 180 + (m ? Number(m[1]) * 60 + Number(m[2]) : 0);
}

/** One list, filtered to `scope`, best first. Results are cached per world, scope and size. */
export function recordList(w: World, id: ListId, scope: Scope = {}, n = 25): Row[] {
  const def = listDef(id);
  const sc = def?.scoped ? scope : {};
  return memo(w, `record:${id}:${sc.sex ?? ""}:${sc.division ?? ""}:${n}`, () => compute(w, id, sc, n));
}

function compute(w: World, id: ListId, scope: Scope, n: number): Row[] {
  const pool = w.boxers.filter((b) => inScope(b, scope));
  const cs = careers(w);
  const career = (b: BoxerFull) => cs.get(b.id);
  switch (id) {
    case "greatest": {
      const withHonours = hasHonours(w);
      const rows = pool.filter((b) => b.bouts >= 10).map((boxer) => {
        const c = cs.get(boxer.id)!;
        const honours = w.honoursByBoxer.get(boxer.id)?.filter((h) => h.kind === "hall_of_fame" || h.kind === "award").length ?? 0;
        let sum = 0, avail = 0; const detail: Record<string, number> = {};
        for (const p of LEGACY) {
          const v = p.part(c, honours);
          if (v === null && !withHonours) continue; // nobody has honours in this data, so the part is left out for everyone
          const x = v ?? 0;
          sum += p.weight * x; avail += p.weight; detail[p.key] = Math.round(x * 100);
        }
        return { boxer, value: Math.round((100 * sum) / avail), detail };
      });
      return rankRows(rows, n, (a, b) => (b.boxer.rating - a.boxer.rating) || alphabetical(a, b));
    }
    case "peak": return rankRows(pool.filter((b) => b.bouts > 0).map((boxer) => ({ boxer, value: Math.round(career(boxer)?.peak ?? boxer.rating), detail: { date: career(boxer)?.peakDate ?? "" } })), n, alphabetical);
    case "wins": return rankRows(pool.filter((b) => b.wins > 0).map((boxer) => ({ boxer, value: boxer.wins, detail: { bouts: boxer.bouts } })), n, alphabetical);
    case "kos": return rankRows(pool.filter((b) => b.kos > 0).map((boxer) => ({ boxer, value: boxer.kos, detail: { wins: boxer.wins } })), n, alphabetical);
    case "ko-rate": return rankRows(pool.filter((b) => b.wins >= 15).map((boxer) => ({ boxer, value: boxer.kos / boxer.wins, detail: { kos: boxer.kos, wins: boxer.wins } })), n, (a, b) => (b.boxer.wins - a.boxer.wins) || alphabetical(a, b));
    case "win-streak": return rankRows(pool.filter((b) => (career(b)?.streak ?? 0) > 0).map((boxer) => ({ boxer, value: career(boxer)!.streak })), n, alphabetical);
    case "quality-wins": return rankRows(pool.filter((b) => (career(b)?.qualityWins ?? 0) > 0).map((boxer) => ({ boxer, value: career(boxer)!.qualityWins })), n, alphabetical);
    case "title-wins": return rankRows(pool.filter((b) => (career(b)?.titleWins ?? 0) > 0).map((boxer) => ({ boxer, value: career(boxer)!.titleWins })), n, alphabetical);
    case "defenses": return rankRows(pool.filter((b) => (career(b)?.defenses ?? 0) > 0).map((boxer) => ({ boxer, value: career(boxer)!.defenses, detail: { reigns: reignsOf(w, boxer.id).length } })), n, alphabetical);
    case "divisions": return rankRows(pool.filter((b) => (career(b)?.divisions.size ?? 0) > 1).map((boxer) => ({ boxer, value: career(boxer)!.divisions.size })), n, alphabetical);
    case "longest-reign": case "reign-defenses": {
      const rows: Omit<Row, "rank">[] = [];
      for (const belt of belts(w)) {
        for (const reign of belt.reigns) {
          const boxer = w.byId.get(reign.boxerId);
          if (!boxer || !inScope(boxer, scope)) continue;
          const value = id === "longest-reign" ? reignDays(belt, reign) : reign.defenses.length;
          if (value > 0) rows.push({ boxer, belt, reign, value });
        }
      }
      return rankRows(rows, n, (a, b) => (reignDays(b.belt!, b.reign!) - reignDays(a.belt!, a.reign!)) || alphabetical(a, b));
    }
    case "fights": return bestFightsEver(w, Math.max(n, 25), scope.division).filter((s) => !scope.sex || w.byId.get(s.bout.redId)?.sex === scope.sex).slice(0, n).map((s: FightScore, i) => ({ rank: i + 1, bout: s.bout, value: s.score }));
    case "upsets": return biggestUpsets(w, 200).filter((u) => boutInScope(w, u.bout, scope)).slice(0, n).map((u, i) => ({ rank: i + 1, bout: u.bout, value: Math.round(u.gap), detail: { winner: Math.round(u.winnerRating), loser: Math.round(u.loserRating) } }));
    case "fastest-kos": {
      const rows: Omit<Row, "rank">[] = [];
      for (const b of done(w)) {
        if (!isStoppage(b.method) || !boutInScope(w, b, scope)) continue;
        const s = secondsIn(b);
        if (s !== null) rows.push({ bout: b, value: s });
      }
      return rows.sort((a, b) => a.value - b.value || a.bout!.date.localeCompare(b.bout!.date)).slice(0, n).map((r, i) => ({ ...r, rank: i + 1 }));
    }
    case "knockdowns": {
      const rows: Omit<Row, "rank">[] = [];
      for (const b of done(w)) { const k = b.kdRed + b.kdBlue; if (k >= 2 && boutInScope(w, b, scope)) rows.push({ bout: b, value: k, detail: { red: b.kdRed, blue: b.kdBlue } }); }
      return rankRows(rows, n, (a, b) => b.bout!.date.localeCompare(a.bout!.date));
    }
  }
}

/** The span the records are drawn from, so "all-time" is never read as "since boxing began". */
export const dataSpan = (w: World): { from: string; to: string; bouts: number } | null => memo(w, "dataSpan", () => {
  const d = done(w);
  return d.length ? { from: d[0].date, to: d[d.length - 1].date, bouts: d.length } : null;
});

/** The text for one row's value and the line under it, in the reader's language. */
export function rowText(id: ListId, r: Row, t: T): { value: string; sub: string | null } {
  const d = r.detail ?? {};
  const fmtDays = (days: number) => (days >= 365 ? t("{y} years, {d} days", { y: Math.floor(days / 365), d: days % 365 }) : t.n(days, "{n} day", "{n} days"));
  switch (id) {
    case "greatest": return { value: String(r.value), sub: LEGACY_PARTS.filter((k) => k in d).map((k) => `${t(PART_NAME[k])} ${d[k]}`).join(" · ") };
    case "peak": return { value: String(r.value), sub: d.date ? String(d.date) : null };
    case "wins": return { value: String(r.value), sub: t.n(Number(d.bouts), "{n} fight", "{n} fights") };
    case "kos": return { value: String(r.value), sub: t.n(Number(d.wins), "{n} win", "{n} wins") };
    case "ko-rate": return { value: `${Math.round(r.value * 100)}%`, sub: t("{kos} knockouts in {wins} wins", { kos: d.kos, wins: d.wins }) };
    case "win-streak": case "quality-wins": case "title-wins": return { value: String(r.value), sub: null };
    case "defenses": return { value: String(r.value), sub: t.n(Number(d.reigns), "{n} reign", "{n} reigns") };
    case "divisions": return { value: String(r.value), sub: null };
    case "longest-reign": return { value: fmtDays(r.value), sub: r.reign ? t.n(r.reign.defenses.length, "{n} defence", "{n} defences") : null };
    case "reign-defenses": return { value: String(r.value), sub: r.reign && r.belt ? fmtDays(reignDays(r.belt, r.reign)) : null };
    case "fights": return { value: String(r.value), sub: null };
    case "upsets": return { value: t.n(r.value, "{n} point", "{n} points"), sub: t("rated {winner} beat {loser}", { winner: d.winner, loser: d.loser }) };
    case "fastest-kos": return { value: `${Math.floor(r.value / 60)}:${String(r.value % 60).padStart(2, "0")}`, sub: r.bout?.endRound ? t("round {r}", { r: r.bout.endRound }) : null };
    case "knockdowns": return { value: String(r.value), sub: t("{a} and {b}", { a: d.red, b: d.blue }) };
  }
}

/** The six parts of the legacy score, named for the line under each row. */
export const PART_NAME: Record<string, string> = {
  peak: msg("peak"), quality: msg("top wins"), reign: msg("reigns"), defenses: msg("defences"), streak: msg("run"), honours: msg("honours"),
};

/** How a boxer stands in the all-time lists: each list they are in the top `n` of, best first. Used on profiles. */
export function recordsOf(w: World, boxerId: number, n = 10): { id: ListId; rank: number }[] {
  const out: { id: ListId; rank: number }[] = [];
  for (const def of LISTS) {
    if (def.subject === "bout") continue;
    const row = recordList(w, def.id, {}, n).find((r) => r.boxer?.id === boxerId);
    if (row) out.push({ id: def.id, rank: row.rank });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** Reads `?sex=` and `?division=` from a page's query string; anything unrecognised means "no filter". */
export function parseScope(sp: { sex?: string; division?: string }): { scope: Scope; sex: "male" | "female" | undefined; division: string | undefined } {
  const sex = sp.sex === "male" || sp.sex === "female" ? sp.sex : undefined;
  const d = sp.division ? divisionFromSlug(sp.division) : undefined;
  return { scope: { sex, division: d?.name }, sex, division: d ? sp.division : undefined };
}
