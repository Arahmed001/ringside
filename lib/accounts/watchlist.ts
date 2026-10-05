import type { DatabaseSync } from "node:sqlite";
import { accountsDb, nowIso } from "./store";
import { MAX_WATCH } from "../watch";

/**
 * A signed-in person's watchlist. Stored against the boxer's external id (so a rebuilt sports database keeps it), and handed back as slugs, which is
 * what the pages use. Fighters that no longer exist are skipped, not deleted. A ceiling of MAX_WATCH keeps an account from being used to fill the disk.
 */
export type WatchError = "no_such_boxer" | "too_many";

const extOf = (main: DatabaseSync, slug: string): string | null =>
  ((main.prepare("SELECT external_id ext FROM boxers WHERE slug = ?").get(slug) as { ext: string } | undefined)?.ext) ?? null;

export function listWatch(userId: number, main: DatabaseSync, acc: DatabaseSync = accountsDb()): string[] {
  const rows = acc.prepare("SELECT boxer_ext FROM watchlist WHERE user_id = ? ORDER BY added_at, boxer_ext").all(userId) as { boxer_ext: string }[];
  const slug = main.prepare("SELECT slug FROM boxers WHERE external_id = ?");
  const out: string[] = [];
  for (const r of rows) { const s = slug.get(r.boxer_ext) as { slug: string } | undefined; if (s) out.push(s.slug); }
  return out;
}

export function addWatch(userId: number, slug: string, main: DatabaseSync, acc: DatabaseSync = accountsDb()): { ok: true } | { ok: false; error: WatchError } {
  const ext = typeof slug === "string" ? extOf(main, slug) : null;
  if (!ext) return { ok: false, error: "no_such_boxer" };
  if (acc.prepare("SELECT 1 x FROM watchlist WHERE user_id = ? AND boxer_ext = ?").get(userId, ext)) return { ok: true };
  if ((acc.prepare("SELECT COUNT(*) c FROM watchlist WHERE user_id = ?").get(userId) as { c: number }).c >= MAX_WATCH) return { ok: false, error: "too_many" };
  acc.prepare("INSERT INTO watchlist (user_id, boxer_ext, added_at) VALUES (?,?,?)").run(userId, ext, nowIso());
  return { ok: true };
}

export function removeWatch(userId: number, slug: string, main: DatabaseSync, acc: DatabaseSync = accountsDb()): { ok: true } {
  const ext = typeof slug === "string" ? extOf(main, slug) : null;
  if (ext) acc.prepare("DELETE FROM watchlist WHERE user_id = ? AND boxer_ext = ?").run(userId, ext);
  return { ok: true };
}

/** Adds the fighters a visitor starred before signing in. Never removes anything; stops quietly at the ceiling. */
export function importWatch(userId: number, slugs: unknown[], main: DatabaseSync, acc: DatabaseSync = accountsDb()): { added: number; invalid: number; full: boolean } {
  const out = { added: 0, invalid: 0, full: false };
  for (const s of slugs.slice(0, MAX_WATCH)) {
    if (typeof s !== "string") { out.invalid++; continue; }
    const had = !!extOf(main, s) && !!acc.prepare("SELECT 1 x FROM watchlist WHERE user_id = ? AND boxer_ext = ?").get(userId, extOf(main, s));
    const r = addWatch(userId, s, main, acc);
    if (!r.ok) { if (r.error === "too_many") { out.full = true; break; } out.invalid++; } else if (!had) out.added++;
  }
  return out;
}
