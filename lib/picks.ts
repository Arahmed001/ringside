import type { DatabaseSync } from "node:sqlite";
import type { World } from "./world";
import { countsInRecord } from "./methods";
import { MAX_PICKS, type PickInfo } from "./picks-grade";
import { tEn, type T } from "./i18n/t";

/**
 * What the pick'em page needs to grade the bouts one visitor picked: who fought, whether it happened, who won, and the
 * model's pre-fight probability as written down in the ledger (its last snapshot strictly before the event date).
 * The server only ever sees the bout ids, and only for those few fights (never the whole card list).
 */
export function pickInfos(db: DatabaseSync, w: World, ids: number[], t: T = tEn, cap = MAX_PICKS): PickInfo[] {
  const last = db.prepare("SELECT p_red FROM prediction_snapshots WHERE bout_id = ? AND locked_on < ? ORDER BY locked_on DESC LIMIT 1");
  const out: PickInfo[] = [];
  for (const id of new Set(ids.slice(0, cap))) {
    const b = w.boutById.get(id);
    if (!b) continue;
    const red = w.byId.get(b.redId), blue = w.byId.get(b.blueId);
    if (!red || !blue) continue;
    const status: PickInfo["status"] =
      b.status === "cancelled" ? "cancelled" : b.upcoming ? "upcoming" : !b.method ? "awaiting"
      : b.winnerId && countsInRecord(b.method) ? "decided" : "void";
    const snap = (last.get(id, b.date) as { p_red: number } | undefined) ?? null;
    out.push({
      boutId: id, date: b.date, eventName: t.name(b.eventName), red: { id: red.id, name: t.name(red.name) }, blue: { id: blue.id, name: t.name(blue.name) },
      status, winnerId: status === "decided" ? b.winnerId : null, modelPRed: snap ? snap.p_red : null,
    });
  }
  return out;
}
