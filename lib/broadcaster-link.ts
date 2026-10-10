import type { DatabaseSync } from "node:sqlite";
import { broadcasterSlug, canonicalBroadcaster } from "./broadcasters";

/**
 * Turns the events' free-text broadcaster into organisations: one `orgs` row (kind "broadcaster") for each channel, and `events.broadcaster_org_id` pointing at it, so a
 * channel has a page with its cards. Offline and repeatable: a name that no longer appears keeps its row, an event whose broadcaster changed is re-pointed.
 */
export function linkBroadcasters(db: DatabaseSync): { broadcasters: number; events: number; unnamed: number } {
  const rows = db.prepare("SELECT id, broadcaster FROM events WHERE broadcaster IS NOT NULL AND broadcaster <> ''").all() as { id: number; broadcaster: string }[];
  const byName = new Map<string, number[]>();
  let unnamed = 0;
  for (const r of rows) {
    const name = canonicalBroadcaster(r.broadcaster);
    if (!name) { unnamed++; continue; }
    byName.set(name, [...(byName.get(name) ?? []), r.id]);
  }
  const upsert = db.prepare("INSERT INTO orgs (external_id, slug, name, kind) VALUES (?, ?, ?, 'broadcaster') ON CONFLICT(external_id) DO UPDATE SET name = excluded.name RETURNING id");
  const point = db.prepare("UPDATE events SET broadcaster_org_id = ? WHERE id = ?");
  const clear = db.prepare("UPDATE events SET broadcaster_org_id = NULL WHERE broadcaster_org_id IS NOT NULL AND (broadcaster IS NULL OR broadcaster = '')");
  let linked = 0;
  db.exec("BEGIN");
  try {
    for (const [name, ids] of byName) {
      const slug = broadcasterSlug(name);
      const org = upsert.get(`broadcaster:${slug}`, slug, name) as { id: number };
      for (const id of ids) { point.run(org.id, id); linked++; }
    }
    clear.run();
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return { broadcasters: byName.size, events: linked, unnamed };
}
