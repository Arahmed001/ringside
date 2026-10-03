import type { DatabaseSync } from "node:sqlite";
import type { FeedData } from "./feed";
import type { CareerRecord } from "./providers/boxing-data-api";

/**
 * What can be checked about a licensed feed, and what cannot. Nothing here can show the vendor's facts are TRUE: that needs a primary
 * source (a commission record, the fight itself). What it can show is whether the feed agrees with itself, and the one figure that
 * can contradict the loaded fights is each fighter's career record: the vendor states "19-0-1", and the fights we hold either add up
 * to that or they do not. A record that does not add up is a record Ringside would publish wrongly, so it is the check that gates a load.
 */
export type RecordStatus = "complete" | "partial" | "conflict";

/**
 * - complete: the fights we hold give exactly the vendor's wins, losses and draws.
 * - partial: they give fewer of at least one, and no more of any: fights are missing (the plan's window is shorter than the career, or a
 *   fighter could not be fetched). Expected on a limited window; the page would show a SHORTER record than the fighter really has.
 * - conflict: they give MORE of something than the vendor's own career total: the feed contradicts itself (a duplicated fight, a wrong
 *   winner, a stale career record).
 */
export function classifyRecord(loaded: CareerRecord, vendor: CareerRecord): RecordStatus {
  if (loaded.wins > vendor.wins || loaded.losses > vendor.losses || loaded.draws > vendor.draws) return "conflict";
  return loaded.wins === vendor.wins && loaded.losses === vendor.losses && loaded.draws === vendor.draws ? "complete" : "partial";
}

export interface Mismatch { externalId: string; name: string; loaded: string; vendor: string }
export interface Reconciliation {
  /** fighters the vendor gave a career record for */
  checked: number;
  complete: number; partial: number; conflict: number;
  /** fighters in the data with no vendor record to check against (not counted in `share`) */
  noVendorRecord: number;
  /**
   * Daily update only (`reconcileDb` with `recent`): fighters whose loaded fights exceed the vendor's total, but only because of a fight in the last
   * few days. The vendor's career totals trail its results (seen: a fight on the 27th, the record updated on the 29th, still without it), so this is
   * "the total probably has not caught up", not a contradiction. Not counted as complete, and never counted as a conflict. Always 0 for a load.
   */
  lagging: number;
  /** complete / checked; 0 when nothing could be checked */
  share: number;
  conflicts: Mismatch[]; partials: Mismatch[]; laggards: Mismatch[];
}
const fmt = (r: CareerRecord) => `${r.wins}-${r.losses}-${r.draws}`;

function reconcile(fighters: { externalId: string; name: string }[], loaded: Map<string, CareerRecord>, vendor: Map<string, CareerRecord>, recent?: Map<string, CareerRecord>): Reconciliation {
  const out: Reconciliation = { checked: 0, complete: 0, partial: 0, conflict: 0, noVendorRecord: 0, lagging: 0, share: 0, conflicts: [], partials: [], laggards: [] };
  for (const f of fighters) {
    const v = vendor.get(f.externalId);
    if (!v) { out.noVendorRecord++; continue; }
    const l = loaded.get(f.externalId) ?? { wins: 0, losses: 0, draws: 0 };
    let status: RecordStatus | "lagging" = classifyRecord(l, v);
    // a conflict that disappears once the last few days' fights are set aside is explained by the vendor's total trailing them
    const r = recent?.get(f.externalId);
    if (status === "conflict" && r && classifyRecord({ wins: l.wins - r.wins, losses: l.losses - r.losses, draws: l.draws - r.draws }, v) !== "conflict") status = "lagging";
    out.checked++; out[status]++;
    const m = { externalId: f.externalId, name: f.name, loaded: fmt(l), vendor: fmt(v) };
    if (status === "conflict") out.conflicts.push(m); else if (status === "partial") out.partials.push(m); else if (status === "lagging") out.laggards.push(m);
  }
  out.share = out.checked ? out.complete / out.checked : 0;
  return out;
}

const add = (m: Map<string, CareerRecord>, id: string, k: keyof CareerRecord) => { const r = m.get(id) ?? { wins: 0, losses: 0, draws: 0 }; r[k]++; m.set(id, r); };

/** Reconciles a feed (before anything is written) against the vendor's career records. Fights with a winner count as a win and a loss, a DRAW as a draw each; cancelled fights and fights with no result count for nothing. */
export function reconcileFeed(feed: FeedData, vendor: Map<string, CareerRecord>): Reconciliation {
  const loaded = new Map<string, CareerRecord>();
  for (const b of feed.bouts) {
    if (b.status === "cancelled") continue;
    if (b.winnerExternalId) {
      add(loaded, b.winnerExternalId, "wins");
      add(loaded, b.winnerExternalId === b.redExternalId ? b.blueExternalId : b.redExternalId, "losses");
    } else if (b.method === "DRAW") { add(loaded, b.redExternalId, "draws"); add(loaded, b.blueExternalId, "draws"); }
  }
  return reconcile(feed.boxers, loaded, vendor);
}

/**
 * The same check against what is in the database now (the daily update: the feed holds only the recent fights, the database holds the careers). Optionally only for some fighters.
 * With `lag`, a conflict that only the fights of the last `days` days cause is reported as `lagging` instead (see `Reconciliation.lagging`). Without it the check is strict, as it is for a load.
 */
export function reconcileDb(db: DatabaseSync, vendor: Map<string, CareerRecord>, only?: Iterable<string>, lag?: { today: string; days: number }): Reconciliation {
  const boxers = db.prepare("SELECT id, external_id, name FROM boxers WHERE external_id IS NOT NULL").all() as { id: number; external_id: string; name: string }[];
  const wanted = only ? new Set(only) : null;
  const byId = new Map(boxers.map((b) => [b.id, b.external_id]));
  const loaded = new Map<string, CareerRecord>();
  const rows = db.prepare("SELECT b.red_id, b.blue_id, b.winner_id, b.method, b.status, e.date AS date FROM bouts b LEFT JOIN events e ON e.id = b.event_id").all() as { red_id: number; blue_id: number; winner_id: number | null; method: string | null; status: string | null; date: string | null }[];
  const recent = lag ? new Map<string, CareerRecord>() : undefined;
  const cutoff = lag ? new Date(Date.parse(`${lag.today}T00:00:00Z`) - lag.days * 86_400_000).toISOString().slice(0, 10) : "";
  for (const b of rows) {
    if (b.status === "cancelled") continue;
    const red = byId.get(b.red_id), blue = byId.get(b.blue_id);
    const isRecent = !!recent && !!b.date && b.date >= cutoff;
    const count = (id: string | undefined, k: keyof CareerRecord) => { if (!id) return; add(loaded, id, k); if (isRecent) add(recent!, id, k); };
    if (b.winner_id) {
      const l = b.winner_id === b.red_id ? blue : red;
      count(byId.get(b.winner_id), "wins"); count(l, "losses");
    } else if (b.method === "DRAW") { count(red, "draws"); count(blue, "draws"); }
  }
  return reconcile(boxers.filter((b) => !wanted || wanted.has(b.external_id)).map((b) => ({ externalId: b.external_id, name: b.name })), loaded, vendor, recent);
}

export interface GateOptions { minComplete: number; allowPartial: boolean; allowConflicts: boolean }
/** Whether a load may go ahead, and if not, why in plain words. Conflicts always need a deliberate override; partial records need either enough complete ones or an override. */
export function recordGate(r: Reconciliation, o: GateOptions): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.conflict > 0 && !o.allowConflicts) reasons.push(`${r.conflict} fighter(s) have MORE wins, losses or draws in the loaded fights than the vendor's own career total, so the feed contradicts itself (${r.conflicts.slice(0, 3).map((m) => `${m.name}: loaded ${m.loaded}, vendor ${m.vendor}`).join("; ")}). --allow-conflicts loads anyway.`);
  if (r.checked === 0 && !o.allowPartial) reasons.push("the feed gave no career records, so nothing can be checked. --allow-partial loads anyway.");
  else if (r.checked > 0 && r.share < o.minComplete && !o.allowPartial) reasons.push(`only ${(r.share * 100).toFixed(1)}% of fighters (${r.complete} of ${r.checked}) have loaded fights that add up to the vendor's career record; ${(o.minComplete * 100).toFixed(0)}% is required. The rest would show a SHORTER record than they have (${r.partials.slice(0, 3).map((m) => `${m.name}: loaded ${m.loaded}, vendor ${m.vendor}`).join("; ")}). This is what a plan whose history is shorter than the careers does. --allow-partial loads anyway; --min-complete changes the bar.`);
  return { ok: reasons.length === 0, reasons };
}

export function describeReconciliation(r: Reconciliation): string[] {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [`records: ${r.complete} of ${r.checked} fighters (${pct(r.share)}) have loaded fights that add up exactly to the vendor's career record`];
  if (r.partial) lines.push(`  ${r.partial} partial: fights are missing, so the page would show a shorter record than the fighter has${r.partials.length ? ` (e.g. ${r.partials.slice(0, 3).map((m) => `${m.name} loaded ${m.loaded} vs vendor ${m.vendor}`).join("; ")})` : ""}`);
  if (r.conflict) lines.push(`  ${r.conflict} CONFLICT: more than the vendor's own career total, so the feed contradicts itself (e.g. ${r.conflicts.slice(0, 3).map((m) => `${m.name} loaded ${m.loaded} vs vendor ${m.vendor}`).join("; ")})`);
  if (r.lagging) lines.push(`  ${r.lagging} career total(s) probably lagging: the loaded fights exceed the vendor's total only because of a fight in the last few days, and the vendor's totals trail its results (e.g. ${r.laggards.slice(0, 3).map((m) => `${m.name} loaded ${m.loaded} vs vendor ${m.vendor}`).join("; ")}). Not a contradiction yet: the next day's update will show whether the total caught up.`);
  if (r.noVendorRecord) lines.push(`  ${r.noVendorRecord} fighter(s) came with no career record, so nothing can be checked for them`);
  return lines;
}
