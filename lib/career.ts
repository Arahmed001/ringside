/** Which career record a page shows (see `careerView`). A leaf module: pure, no database, so anything may import it. */
type Rec = { wins: number; losses: number; draws: number };
export interface CareerView {
  /** the record to show */
  wins: number; losses: number; draws: number;
  /** "loaded": what the fights Ringside holds add up to (the supplier's total agrees, or it gave none, or the loaded fights are the ones that count);
   *  "supplier": the supplier's career total, because Ringside holds fewer fights than that */
  source: "loaded" | "supplier";
  /** fights in the supplier's total, and fights Ringside holds that count in a record (only when source is "supplier") */
  total: number; held: number;
}
/**
 * Which career record a page shows. The fights Ringside holds add up to a record; a data supplier may also state the career total. When the loaded fights
 * give FEWER wins, losses or draws than the total and none more (a partial load: the history is shorter than the career), the total is shown, labelled, so
 * a 19-0-1 fighter is not shown as 1-0. If the loaded fights give more of anything than the total, or the two agree, or there is no total, the loaded record
 * stands (the supplier's totals trail its results by days, and a conflict is a thing for the check to report, not for a page to pick a side on).
 */
export function careerView(b: Rec & { vendorRecord?: Rec | null }): CareerView {
  const v = b.vendorRecord, held = b.wins + b.losses + b.draws;
  if (v && b.wins <= v.wins && b.losses <= v.losses && b.draws <= v.draws && (b.wins < v.wins || b.losses < v.losses || b.draws < v.draws))
    return { wins: v.wins, losses: v.losses, draws: v.draws, source: "supplier", total: v.wins + v.losses + v.draws, held };
  return { wins: b.wins, losses: b.losses, draws: b.draws, source: "loaded", total: held, held };
}
export const recordStr = (b: Rec & { vendorRecord?: Rec | null }) => { const c = careerView(b); return `${c.wins}-${c.losses}-${c.draws}`; };
