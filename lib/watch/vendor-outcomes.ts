import fs from "node:fs";
import path from "node:path";

/** What the vendor's own cached copy of a fight says about how it ended: the outcome word (UD, TKO, D...) and the status, or nothing when the fight is not in the cache. */
export interface VendorSaid { outcome: string | null; status: string | null }

/**
 * Reads the fight-list pages of the vendor cache (`v2-fights__*.json`) once and answers by the vendor's fight id (`bda-b-<id>`). Used only to compare: a result proposed from another
 * source is checked against it, never written from it. A missing or unreadable directory answers nothing for every fight.
 */
export function readVendorOutcomes(dir: string | undefined): (boutExternalId: string) => VendorSaid | undefined {
  const map = new Map<string, VendorSaid>();
  if (dir && fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith("v2-fights__") || !name.endsWith(".json")) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { data?: { id?: string; status?: string; results?: { outcome?: string | null } | null }[] };
        for (const f of j.data ?? []) if (f.id) map.set(`bda-b-${f.id}`, { outcome: f.results?.outcome ?? null, status: f.status ?? null });
      } catch { /* a page that does not read is skipped */ }
    }
  }
  return (id) => map.get(id);
}
