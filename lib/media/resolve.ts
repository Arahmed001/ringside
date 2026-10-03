import type { DatabaseSync } from "node:sqlite";
import { findHeadshot, headshotByEntity } from "./wikimedia";

export interface ResolveSummary { checked: number; matched: number; noMatch: number; errors: number }

const RECHECK_DAYS = 45;

/**
 * Worker: finds free-licensed Wikimedia headshots for fighters that don't have one yet.
 * Highest-rated fighters go first, so a small request budget covers the pages people visit most.
 * Fighters whose provider already supplied a photo are left alone. "no_match" results are
 * retried after RECHECK_DAYS in case Wikidata has since been updated.
 */
export async function resolveMissingMedia(db: DatabaseSync, opts: { limit?: number; log?: (m: string) => void } = {}): Promise<ResolveSummary> {
  const { limit = 50, log = () => {} } = opts;
  const cutoff = new Date(Date.now() - RECHECK_DAYS * 86400000).toISOString();
  const rows = db.prepare(`
    SELECT b.id, b.name, b.birth_year AS birthYear, b.wikidata_id AS qid FROM boxers b
    LEFT JOIN boxer_media m ON m.boxer_id = b.id
    WHERE (b.photo_url IS NULL OR m.status = 'matched')
      AND (m.boxer_id IS NULL OR (m.status = 'no_match' AND m.checked_at < ?))
    ORDER BY b.rating DESC LIMIT ?`).all(cutoff, limit) as { id: number; name: string; birthYear: number; qid: string | null }[];

  const save = db.prepare(`INSERT INTO boxer_media (boxer_id, status, reason, wikidata_id, file_title, thumb_url, page_url, license, license_url, credit, checked_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(boxer_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, wikidata_id=excluded.wikidata_id,
    file_title=excluded.file_title, thumb_url=excluded.thumb_url, page_url=excluded.page_url, license=excluded.license, license_url=excluded.license_url,
    credit=excluded.credit, checked_at=excluded.checked_at`);
  const setPhoto = db.prepare("UPDATE boxers SET photo_url = ?, photo_credit = ? WHERE id = ?");

  const s: ResolveSummary = { checked: 0, matched: 0, noMatch: 0, errors: 0 };
  for (const r of rows) {
    s.checked++;
    try {
      // A fighter already linked to Wikidata skips the name search entirely.
      const out = r.qid ? await headshotByEntity(r.qid) : await findHeadshot({ name: r.name, birthYear: r.birthYear });
      const now = new Date().toISOString();
      if (out.status === "matched") {
        const m = out.match;
        save.run(r.id, "matched", null, m.wikidataId, m.fileTitle, m.thumbUrl, m.pageUrl, m.license, m.licenseUrl, m.credit, now);
        setPhoto.run(m.thumbUrl, JSON.stringify({ text: m.credit, license: m.license, licenseUrl: m.licenseUrl, pageUrl: m.pageUrl, source: "Wikimedia Commons" }), r.id);
        s.matched++;
        log(`✓ ${r.name} → ${m.fileTitle} (${m.license})`);
      } else {
        save.run(r.id, "no_match", out.reason, null, null, null, null, null, null, null, now);
        s.noMatch++;
        log(`– ${r.name}: ${out.reason}`);
      }
    } catch (e) {
      s.errors++;
      log(`! ${r.name}: ${(e as Error).message}`);
      if (/WIKIMEDIA_CONTACT/.test((e as Error).message)) throw e; // misconfiguration: stop, don't burn the list
    }
  }
  return s;
}
