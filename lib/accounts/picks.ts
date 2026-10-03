import type { DatabaseSync } from "node:sqlite";
import { accountsDb, nowIso } from "./store";
import { todayIso } from "../clock";

/**
 * Server-side picks. A pick is stored against the bout's and the boxer's external ids (so a rebuilt sports database keeps them) and
 * is only accepted while the bout is still ahead of us: its card is on a later UTC day than today, it is not cancelled and it has no
 * result. Once the fight day begins a pick is frozen: it can be neither changed nor deleted, so nobody can pick after the fact or
 * quietly drop the ones they got wrong.
 */
/** A ceiling on one account's stored picks, so an account cannot be used to fill the disk. */
export const MAX_PICKS_PER_USER = 5000;

interface BoutFacts { id: number; ext: string; date: string; status: string | null; method: string | null; redId: number; blueId: number; redExt: string; blueExt: string }

const facts = (main: DatabaseSync, boutId: number): BoutFacts | null =>
  (main.prepare(`SELECT b.id id, b.external_id ext, e.date date, b.status status, b.method method, b.red_id redId, b.blue_id blueId, r.external_id redExt, u.external_id blueExt
    FROM bouts b JOIN events e ON e.id = b.event_id JOIN boxers r ON r.id = b.red_id JOIN boxers u ON u.id = b.blue_id WHERE b.id = ?`).get(boutId) as BoutFacts | undefined) ?? null;

export type PickError = "no_such_bout" | "locked" | "not_in_bout" | "too_many";
export const isOpen = (f: Pick<BoutFacts, "date" | "status" | "method">, today = todayIso()) => f.date > today && f.status !== "cancelled" && !f.method;

export function setPick(userId: number, boutId: number, boxerId: number, main: DatabaseSync, acc: DatabaseSync = accountsDb()): { ok: true; changed: boolean } | { ok: false; error: PickError } {
  const f = Number.isInteger(boutId) ? facts(main, boutId) : null;
  if (!f) return { ok: false, error: "no_such_bout" };
  if (!isOpen(f)) return { ok: false, error: "locked" };
  if (boxerId !== f.redId && boxerId !== f.blueId) return { ok: false, error: "not_in_bout" };
  const ext = boxerId === f.redId ? f.redExt : f.blueExt;
  const have = acc.prepare("SELECT boxer_ext FROM picks WHERE user_id = ? AND bout_ext = ?").get(userId, f.ext) as { boxer_ext: string } | undefined;
  if (have?.boxer_ext === ext) return { ok: true, changed: false };
  if (!have) {
    if ((acc.prepare("SELECT COUNT(*) c FROM picks WHERE user_id = ?").get(userId) as { c: number }).c >= MAX_PICKS_PER_USER) return { ok: false, error: "too_many" };
  }
  acc.prepare("INSERT INTO picks (user_id, bout_ext, boxer_ext, picked_at) VALUES (?,?,?,?) ON CONFLICT(user_id, bout_ext) DO UPDATE SET boxer_ext = excluded.boxer_ext, picked_at = excluded.picked_at").run(userId, f.ext, ext, nowIso());
  return { ok: true, changed: true };
}

export function removePick(userId: number, boutId: number, main: DatabaseSync, acc: DatabaseSync = accountsDb()): { ok: true } | { ok: false; error: PickError } {
  const f = Number.isInteger(boutId) ? facts(main, boutId) : null;
  if (!f) return { ok: false, error: "no_such_bout" };
  if (!isOpen(f)) return { ok: false, error: "locked" };
  acc.prepare("DELETE FROM picks WHERE user_id = ? AND bout_ext = ?").run(userId, f.ext);
  return { ok: true };
}

/** A user's picks as `{ boutId: boxerId }` in the current database's numbering. Picks whose bout or boxer no longer exists are skipped, not deleted. */
export function listPicks(userId: number, main: DatabaseSync, acc: DatabaseSync = accountsDb()): Record<number, number> {
  const rows = acc.prepare("SELECT bout_ext, boxer_ext FROM picks WHERE user_id = ?").all(userId) as { bout_ext: string; boxer_ext: string }[];
  return resolve(rows, main);
}

export function resolve(rows: { bout_ext: string; boxer_ext: string }[], main: DatabaseSync): Record<number, number> {
  const out: Record<number, number> = {};
  const bout = main.prepare("SELECT id FROM bouts WHERE external_id = ?"), boxer = main.prepare("SELECT id FROM boxers WHERE external_id = ?");
  for (const r of rows) {
    const b = bout.get(r.bout_ext) as { id: number } | undefined, x = boxer.get(r.boxer_ext) as { id: number } | undefined;
    if (b && x) out[b.id] = x.id;
  }
  return out;
}

/** Adds the picks a visitor made before signing in. Only still-open bouts count (a "pick" for a past fight proves nothing), and a pick already on the account is never overwritten. */
export function importPicks(userId: number, local: Record<string, unknown>, main: DatabaseSync, acc: DatabaseSync = accountsDb()): { added: number; kept: number; locked: number; invalid: number } {
  const out = { added: 0, kept: 0, locked: 0, invalid: 0 };
  for (const [k, v] of Object.entries(local).slice(0, 400)) {
    const bout = Number(k), boxer = Number(v);
    if (!Number.isInteger(bout) || !Number.isInteger(boxer)) { out.invalid++; continue; }
    const f = facts(main, bout);
    if (!f || (boxer !== f.redId && boxer !== f.blueId)) { out.invalid++; continue; }
    if (!isOpen(f)) { out.locked++; continue; }
    if (acc.prepare("SELECT 1 x FROM picks WHERE user_id = ? AND bout_ext = ?").get(userId, f.ext)) { out.kept++; continue; }
    const r = setPick(userId, bout, boxer, main, acc);
    if (r.ok) out.added++; else out.invalid++;
  }
  return out;
}
