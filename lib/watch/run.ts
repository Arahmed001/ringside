import type { DatabaseSync } from "node:sqlite";
import { championsSource } from "./champions";
import { resultsSource } from "./results";
import { vendorSource } from "./vendor-apply";
import { reconcile, type ReconcileReport } from "./proposals";
import type { WatchContext, WatchResult, WatchSource } from "./types";

/** Every source the watcher knows. A new source is added here disabled, with its terms written down, and enabled once someone has read them. */
export const SOURCES: WatchSource[] = [championsSource, resultsSource, vendorSource];

export interface WatchReport { source: string; compared: number; changes: number; refused: WatchResult["refused"]; proposals: ReconcileReport | null }

/** Looks at one source and stores what differs as pending proposals. With `dryRun` nothing is stored. Never touches the live data. */
export async function runWatch(sourceId: string, ctx: WatchContext, acc: DatabaseSync, o: { dryRun?: boolean; now?: string } = {}): Promise<WatchReport> {
  const src = SOURCES.find((s) => s.id === sourceId || s.id.endsWith(`:${sourceId}`));
  if (!src) throw new Error(`No such source: ${sourceId}. Choose from ${SOURCES.map((s) => s.id).join(", ")}.`);
  if (!src.enabled) throw new Error(`${src.id} is switched off until its terms have been read and recorded.`);
  if (!src.run) throw new Error(`${src.id} is not looked at by the watcher: its changes come from the daily update.`);
  const r = await src.run(ctx);
  const proposals = o.dryRun ? null : reconcile(acc, src.id, r.changes, r.retire ? (k: string) => r.scope.some((x) => k.startsWith(x)) || r.retire!(k) : r.scope, o.now);
  return { source: src.id, compared: r.compared, changes: r.changes.length, refused: r.refused, proposals };
}
