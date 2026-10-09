import { SOURCES } from "./run";

/**
 * WATCH_SOURCES: which sources the nightly job looks at, and how often. A comma-separated list of `source` or `source:nightly` or `source:weekly`
 * (champions:weekly,champions:nightly are the same source twice: the first wins). Empty or unset: the nightly job does not watch anything. A name that is not a known
 * source, or a source that is switched off, is reported and skipped, never a reason to stop the night. "Weekly" means Mondays (UTC): no state is kept, so
 * a night that is missed is simply picked up the Monday after.
 */
export type Every = "nightly" | "weekly";
export interface Watched { id: string; every: Every }
export interface WatchPlan { watched: Watched[]; warnings: string[] }

export function parseWatchSources(text: string | undefined, known = SOURCES): WatchPlan {
  const out: WatchPlan = { watched: [], warnings: [] };
  const find = (name: string) => known.find((s) => s.id === name || s.id.endsWith(`:${name}`));
  for (const raw of (text ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    // the last part is the frequency when it is one; a source's own id may contain a colon ("wikipedia:champions")
    const parts = raw.split(":"), last = parts[parts.length - 1].toLowerCase();
    const freq = parts.length > 1 && (last === "nightly" || last === "weekly") ? last : null;
    const name = (freq ? parts.slice(0, -1) : parts).join(":");
    const src = name ? find(name) : undefined;
    if (!src) {
      const badFrequency = !freq && parts.length > 1 && find(parts.slice(0, -1).join(":"));
      out.warnings.push(badFrequency || !name ? `WATCH_SOURCES: "${raw}" is not source or source:nightly or source:weekly: skipped.` : `WATCH_SOURCES: no such source "${name}" (known: ${known.map((k) => k.id.split(":").pop()).join(", ")}): skipped.`);
      continue;
    }
    if (!src.enabled) { out.warnings.push(`WATCH_SOURCES: ${src.id} is switched off until its terms are recorded: skipped.`); continue; }
    if (out.watched.some((w) => w.id === src.id)) continue;
    out.watched.push({ id: src.id, every: (freq ?? "nightly") as Every });
  }
  return out;
}

export const isDue = (w: Watched, now: Date): boolean => w.every === "nightly" || now.getUTCDay() === 1;
