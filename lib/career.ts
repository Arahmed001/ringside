/** Which career record a page shows (see `careerView`). A leaf module: pure, no database, so anything may import it. */
type Rec = { wins: number; losses: number; draws: number };
export interface CareerView {
  /** the record to show */
  wins: number; losses: number; draws: number;
  /** "loaded": what the fights Ringside holds add up to (the supplier's total agrees, or it gave none, or the loaded fights are the ones that count);
   *  "supplier": the supplier's career total, because Ringside holds fewer fights than that;
   *  "disputed": the supplier's career total, because the supplier's own fight list gives MORE wins, losses or draws than that total and the load marked the fighter (a wrong
   *  winner, a duplicated or non-professional bout in the list, or a stale total: the fights cannot say which), so the page shows the total and says the two disagree */
  source: "loaded" | "supplier" | "disputed";
  /** fights in the supplier's total, and fights Ringside holds that count in a record (only when source is not "loaded") */
  total: number; held: number;
}
/**
 * Which career record a page shows. The fights Ringside holds add up to a record; a data supplier may also state the career total. When the loaded fights
 * give FEWER wins, losses or draws than the total and none more (a partial load: the history is shorter than the career), the total is shown, labelled, so
 * a 19-0-1 fighter is not shown as 1-0. If the loaded fights give more of anything than the total, or the two agree, or there is no total, the loaded record
 * stands (the supplier's totals trail its results by days, and a conflict is a thing for the check to report, not for a page to pick a side on).
 */
export function careerView(b: Rec & { vendorRecord?: Rec | null; recordDisputed?: boolean }): CareerView {
  const v = b.vendorRecord, held = b.wins + b.losses + b.draws;
  if (b.recordDisputed && v) return { wins: v.wins, losses: v.losses, draws: v.draws, source: "disputed", total: v.wins + v.losses + v.draws, held };
  if (v && b.wins <= v.wins && b.losses <= v.losses && b.draws <= v.draws && (b.wins < v.wins || b.losses < v.losses || b.draws < v.draws))
    return { wins: v.wins, losses: v.losses, draws: v.draws, source: "supplier", total: v.wins + v.losses + v.draws, held };
  return { wins: b.wins, losses: b.losses, draws: b.draws, source: "loaded", total: held, held };
}

export interface KoView {
  /** career knockouts to show, knockouts as a share of wins, and times stopped */
  kos: number; rate: number; stopped: number | null;
  /** "supplier": the supplier's career totals, because Ringside holds only part of the career and the supplier states its knockouts; otherwise what the fights held add up to */
  source: "loaded" | "supplier";
}
/**
 * The knockout figures to show beside `careerView`'s record. When the record shown is the supplier's career total (a career held in part) and the supplier also states
 * the career's knockouts, those are shown, so a 19-0-1 record does not sit beside "1 KO" counted from one fight held. Otherwise they are counted from the fights held.
 */
export function koView(b: Rec & { vendorRecord?: (Rec & { koWins?: number; stopped?: number }) | null; recordDisputed?: boolean; kos: number; koRate: number; koLosses: number }): KoView {
  const c = careerView(b), v = b.vendorRecord;
  if (c.source !== "loaded" && v && typeof v.koWins === "number") return { kos: v.koWins, rate: c.wins ? v.koWins / c.wins : 0, stopped: typeof v.stopped === "number" ? v.stopped : null, source: "supplier" };
  return { kos: b.kos, rate: b.koRate, stopped: b.koLosses, source: "loaded" };
}
export const recordStr = (b: Rec & { vendorRecord?: Rec | null; recordDisputed?: boolean }) => { const c = careerView(b); return `${c.wins}-${c.losses}-${c.draws}`; };

/**
 * The counts a record filter or a sort key compares: the career as the page shows it (`careerView`), so "undefeated" never lists a fighter whose page says 14-1-1
 * because the fights held happen to hold no loss. With no supplier total, or when the fights held are the career, these are the counts of the fights held, as before.
 */
export function careerCounts(b: Rec & { bouts: number; vendorRecord?: Rec | null; recordDisputed?: boolean }): { wins: number; losses: number; draws: number; bouts: number } {
  const c = careerView(b);
  return { wins: c.wins, losses: c.losses, draws: c.draws, bouts: c.source !== "loaded" ? c.total : b.bouts };
}
/**
 * The knockout figures a filter or a sort key compares, or null when there are none to compare: the career is held in part and the supplier gave no knockout totals,
 * so the fights held say nothing about the career (a fact the data does not have never satisfies a filter on it, as everywhere else).
 */
export function knockouts(b: Rec & { vendorRecord?: (Rec & { koWins?: number; stopped?: number }) | null; recordDisputed?: boolean; kos: number; koRate: number; koLosses: number }): { kos: number; rate: number; stopped: number | null } | null {
  if (careerView(b).source === "loaded") return { kos: b.kos, rate: b.koRate, stopped: b.koLosses };
  const k = koView(b);
  return k.source === "supplier" ? { kos: k.kos, rate: k.rate, stopped: k.stopped } : null;
}
