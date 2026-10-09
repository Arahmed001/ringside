import type { DatabaseSync } from "node:sqlite";

/**
 * A Wayback Machine copy of each headline's original, found with the Internet Archive's availability API (https://archive.org/help/wayback_api.php), so a link that goes
 * dead still leads somewhere. Only an address the Archive itself reports is stored, and only if it is on archive.org over https. A headline with no snapshot is asked about
 * again after a week. A few per run and a second apart: the API is free and asks for modest use.
 */
export const ARCHIVE_BATCH = 25, RETRY_DAYS = 7;

export function snapshotUrl(body: unknown): string | null {
  const url = (body as { archived_snapshots?: { closest?: { available?: boolean; url?: string } } })?.archived_snapshots?.closest;
  if (!url?.available || typeof url.url !== "string") return null;
  try { const u = new URL(url.url.replace(/^http:/, "https:")); return u.protocol === "https:" && (u.hostname === "web.archive.org" || u.hostname === "archive.org") ? u.href : null; } catch { return null; }
}

export async function findArchives(db: DatabaseSync, o: { contact: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; limit?: number }): Promise<{ checked: number; found: number }> {
  const f = o.fetchImpl ?? fetch, sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))), now = o.now ?? Date.now;
  const before = new Date(now() - RETRY_DAYS * 86400_000).toISOString();
  const rows = db.prepare("SELECT id, url FROM news_items WHERE archive_url IS NULL AND (archive_checked_at IS NULL OR archive_checked_at < ?) ORDER BY COALESCE(published, fetched_at) DESC LIMIT ?").all(before, o.limit ?? ARCHIVE_BATCH) as { id: number; url: string }[];
  const set = db.prepare("UPDATE news_items SET archive_url = ?, archive_checked_at = ? WHERE id = ?");
  let found = 0;
  for (const r of rows) {
    let snap: string | null = null;
    try {
      const res = await f(`https://archive.org/wayback/available?url=${encodeURIComponent(r.url)}`, { headers: { "user-agent": `RingsideNews/1.0 (+${o.contact})` }, signal: AbortSignal.timeout(20000) });
      if (res.status === 429) break; // asked to slow down: stop and try again next run
      if (res.ok) snap = snapshotUrl(await res.json());
    } catch { /* unreachable: asked again next run */ continue; }
    set.run(snap, new Date(now()).toISOString(), r.id);
    if (snap) found++;
    await sleep(1000);
  }
  return { checked: rows.length, found };
}
