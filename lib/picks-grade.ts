/**
 * Grading a visitor's pick'em picks against what happened and against the model. Pure, so the browser runs it on the
 * picks it holds (they never leave the browser) plus the facts the server sends for just those fights.
 */
export interface PickInfo {
  boutId: number; date: string; eventName: string;
  red: { id: number; name: string }; blue: { id: number; name: string };
  /** upcoming: still to come; awaiting: the date has passed but no result is in; decided: has a winner; void: draw or no-contest; cancelled */
  status: "upcoming" | "awaiting" | "decided" | "void" | "cancelled";
  winnerId: number | null;
  /** the model's win probability for red as written down before the fight (the ledger's last snapshot), or null if none was on file */
  modelPRed: number | null;
}

export interface GradedPick {
  info: PickInfo; pickId: number;
  state: "pending" | "right" | "wrong" | "void";
  modelPickId: number | null; model: "right" | "wrong" | null;
}

export interface PicksSummary {
  made: number; pending: number; graded: number; right: number; accuracy: number; voided: number;
  /** the model on the same graded fights it had a prediction for */
  model: { n: number; right: number; accuracy: number };
  /** on those same fights: who was right */
  versus: { both: number; youOnly: number; modelOnly: number; neither: number; n: number };
  streak: { current: number; best: number };
}

export const MAX_PICKS = 200;

export function grade(picks: Record<number, number>, infos: PickInfo[]): { rows: GradedPick[]; summary: PicksSummary } {
  const rows: GradedPick[] = [];
  for (const info of infos) {
    const pickId = picks[info.boutId];
    if (pickId === undefined || (pickId !== info.red.id && pickId !== info.blue.id)) continue; // a pick for a fighter not in this bout is ignored
    const modelPickId = info.modelPRed === null ? null : info.modelPRed >= 0.5 ? info.red.id : info.blue.id;
    let state: GradedPick["state"] = "pending";
    if (info.status === "decided" && info.winnerId !== null) state = pickId === info.winnerId ? "right" : "wrong";
    else if (info.status === "void" || info.status === "cancelled") state = "void";
    const model = state === "right" || state === "wrong" ? (modelPickId === null ? null : modelPickId === info.winnerId ? "right" : "wrong") : null;
    rows.push({ info, pickId, state, modelPickId, model });
  }
  const gradedRows = rows.filter((r) => r.state === "right" || r.state === "wrong").sort((a, b) => a.info.date.localeCompare(b.info.date) || a.info.boutId - b.info.boutId);
  const right = gradedRows.filter((r) => r.state === "right").length;
  const both = gradedRows.filter((r) => r.model);
  const v = { both: 0, youOnly: 0, modelOnly: 0, neither: 0, n: both.length };
  for (const r of both) {
    const you = r.state === "right", m = r.model === "right";
    if (you && m) v.both++; else if (you) v.youOnly++; else if (m) v.modelOnly++; else v.neither++;
  }
  let run = 0, best = 0;
  for (const r of gradedRows) { run = r.state === "right" ? run + 1 : 0; best = Math.max(best, run); }
  const modelRight = both.filter((r) => r.model === "right").length;
  return {
    rows: rows.sort((a, b) => b.info.date.localeCompare(a.info.date) || b.info.boutId - a.info.boutId),
    summary: {
      made: rows.length, pending: rows.filter((r) => r.state === "pending").length, graded: gradedRows.length, right,
      accuracy: gradedRows.length ? right / gradedRows.length : 0, voided: rows.filter((r) => r.state === "void").length,
      model: { n: both.length, right: modelRight, accuracy: both.length ? modelRight / both.length : 0 },
      versus: v, streak: { current: run, best },
    },
  };
}
