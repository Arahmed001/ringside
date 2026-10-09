import type { DatabaseSync } from "node:sqlite";
import type { ChampionSource, FetchOptions } from "../importers/wikipedia-champions";

/** One difference between what a source says now and what we hold. Never applied by the watcher: it becomes a pending proposal. */
export interface Change {
  /** "reign_added" | "reign_changed" | "reign_removed" for the champions lists; each source names its own */
  kind: string;
  /** a stable name for the thing, so the same change is the same proposal on the next run */
  targetKey: string;
  /** a short line for the approval screen ("WBC Heavyweight: Tyson Fury, from 2015-11-28") */
  label: string;
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
  /** where it was read: page, revision, the row's own words */
  evidence: Record<string, unknown>;
}

export interface WatchContext {
  main: DatabaseSync;
  /** options for fetching (cache directory, pause between requests, refresh); the same ones the importers take */
  fetch: FetchOptions;
  log: (m: string) => void;
  /** which bodies' lists to read (default: all four); only the champions source uses it */
  championSources?: ChampionSource[];
  /** a share of a page's rows above which a run proposes nothing from that page (default 0.05 and at least 10 changes) */
  floodShare?: number;
  /** at most this many fighters' articles are read (the results source; a pilot reads a few dozen) */
  limit?: number;
  /** what the vendor's own copy says about a fight (by its `bda-b-…` id), to sort the results proposed into those it agrees with and those it contradicts */
  vendorCheck?: (boutExternalId: string) => { outcome: string | null; status: string | null } | undefined;
}

export interface WatchResult {
  changes: Change[];
  /** the prefixes of target keys this run read successfully: only pending proposals inside them can be found to have gone away */
  scope: string[];
  /** places not proposed from, and why (a page that changed shape, one that read as empty, nothing held yet) */
  refused: { scope: string; reason: string }[];
  /** a pending proposal this says is no longer true even though its place was not read this run (a fight that has got a result meanwhile) */
  retire?: (targetKey: string) => boolean;
  /** how many rows were compared */
  compared: number;
}

/** What applying one approved change came to. `ratings`: a result moved, so the ratings must be recomputed (once, by the caller, after a batch). */
export type ApplyOutcome = { ok: true; changed: boolean; ratings?: boolean } | { ok: false; error: "stale" | "gone" | "bad_proposal" };

/** A source the watcher can look at. Every source declares what it is for and the terms it is read under; a new one starts disabled until those are recorded. */
export interface WatchSource {
  id: string;
  label: string;
  kind: "titles" | "results" | "news" | "details";
  /** the licence or terms it is read under, and the link; shown on the approval screen */
  terms: string;
  enabled: boolean;
  /** looks at the source; absent for a source that is not watched but whose changes can be applied (the vendor's daily update produces its own) */
  run?(ctx: WatchContext): Promise<WatchResult>;
  /** writes one approved change to the live data; only an admin's approval ever calls it. Safe to run twice; refuses a change that no longer fits what is held. */
  apply(main: DatabaseSync, p: { kind: string; targetKey: string; old: unknown; new: unknown; evidence: unknown }): ApplyOutcome;
}
