import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { backupDatabases, verifyBackup } from "./backup";

/**
 * Packs a finished sports database (`real.db`) into a folder the host can restore with `npm run backup -- restore`: one consistent copy
 * (`VACUUM INTO`, so the -wal is folded in and a running site does no harm), its checksum list, and nothing else. The folder carries NO
 * accounts database and no model file, so restoring it leaves the host's people, picks and edits exactly as they are.
 * It reads the source and writes only inside `outRoot`; it never opens the source for writing.
 */
export interface ShipResult { dir: string; bytes: number; counts: string[]; problems: string[] }

const COUNTS: [string, string][] = [["boxers", "fighters"], ["bouts", "fights"], ["events", "cards"]];

export function shipDatabase(o: { database: string; outRoot: string; now?: Date; minFighters?: number }): ShipResult {
  const fail = (p: string): ShipResult => ({ dir: "", bytes: 0, counts: [], problems: [p] });
  if (!fs.existsSync(o.database)) return fail(`there is no database at ${o.database}`);
  const counts: string[] = []; let fighters = 0;
  try {
    const db = new DatabaseSync(o.database, { readOnly: true });
    try {
      for (const [t, label] of COUNTS) { const c = (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c; counts.push(`${c.toLocaleString("en-US")} ${label}`); if (t === "boxers") fighters = c; }
    } finally { db.close(); }
  } catch (e) { return fail(`${o.database} is not a Ringside database (${(e as Error).message})`); }
  const min = o.minFighters ?? 1000;
  if (fighters < min) return fail(`${o.database} holds only ${fighters} fighters (fewer than ${min}): this looks like the demo or a partial database, not the finished one. Pass --allow-small if it really is the one to ship.`);
  fs.mkdirSync(o.outRoot, { recursive: true, mode: 0o700 });
  const r = backupDatabases({ root: o.outRoot, files: [{ name: "ringside", path: o.database }], keep: Infinity, now: o.now });
  const problems = verifyBackup(r.dir, { requireChecksums: true });
  if (r.files.some((f) => f.integrity !== "ok")) problems.push("the copy did not pass integrity_check");
  return { dir: r.dir, bytes: r.files[0]?.bytes ?? 0, counts, problems };
}
