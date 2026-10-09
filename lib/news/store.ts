import type { DatabaseSync } from "node:sqlite";
import type { NewsEntry } from "./parse";
import { isVideoSource } from "./sources";

/** One stored headline. */
export interface NewsItem { id: number; source: string; title: string; url: string; published: string | null; snippet: string; archiveUrl: string | null }

/** Adds the entries a feed gave; one already held (same outlet, same guid) is left as it was. Returns how many were new. */
export function saveEntries(db: DatabaseSync, source: string, entries: NewsEntry[], now = new Date().toISOString()): number {
  const ins = db.prepare("INSERT OR IGNORE INTO news_items (source, guid, title, url, published, snippet, fetched_at) VALUES (?,?,?,?,?,?,?)");
  let added = 0;
  let img: ReturnType<DatabaseSync["prepare"]> | null = null;
  try { img = db.prepare("INSERT INTO news_images (source, guid, image_url) VALUES (?,?,?) ON CONFLICT(source, guid) DO UPDATE SET image_url = excluded.image_url"); } catch { /* a database without the table has no pictures */ }
  db.exec("BEGIN");
  try { for (const e of entries) { added += Number(ins.run(source, e.guid, e.title, e.url, e.published, e.snippet, now).changes); if (img && e.image) img.run(source, e.guid, e.image); } db.exec("COMMIT"); }
  catch (e) { db.exec("ROLLBACK"); throw e; }
  return added;
}

/** Headlines older than this many days are dropped on every refresh: this is a feed of what is new, not an archive. */
export const KEEP_DAYS = 120;
export function prune(db: DatabaseSync, now = Date.now()): number {
  const cut = new Date(now - KEEP_DAYS * 86400_000).toISOString();
  const n = Number(db.prepare("DELETE FROM news_items WHERE COALESCE(published, fetched_at) < ?").run(cut).changes);
  try { db.exec("DELETE FROM news_images WHERE NOT EXISTS (SELECT 1 FROM news_items n WHERE n.source = news_images.source AND n.guid = news_images.guid)"); } catch { /* no such table */ }
  return n;
}

type Row = { id: number; source: string; title: string; url: string; published: string | null; snippet: string | null; archive_url: string | null };
const toItem = (r: Row): NewsItem => ({ id: r.id, source: r.source, title: r.title, url: r.url, published: r.published, snippet: r.snippet ?? "", archiveUrl: r.archive_url });

/** Newest first. A database without the table (an old one, or the demo) has no news. */
export function latest(db: DatabaseSync, limit = 200, source?: string, kind?: "news" | "video"): NewsItem[] {
  if (kind) return latest(db, limit * 3, source).filter((n) => isVideoSource(n.source) === (kind === "video")).slice(0, limit);
  try {
    const rows = source
      ? db.prepare("SELECT * FROM news_items WHERE source = ? ORDER BY COALESCE(published, fetched_at) DESC, id DESC LIMIT ?").all(source, limit)
      : db.prepare("SELECT * FROM news_items ORDER BY COALESCE(published, fetched_at) DESC, id DESC LIMIT ?").all(limit);
    return (rows as Row[]).map(toItem);
  } catch { return []; }
}
