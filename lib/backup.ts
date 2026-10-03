import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Consistent copies of the databases that cannot be rebuilt: the sports database (it holds the live prediction ledger) and the accounts
 * database (people, picks, edits). `VACUUM INTO` takes a snapshot while the app keeps writing; copying the files with `cp` can give a torn
 * file. Each run writes one folder named for the time (`2026-10-03T12-00-00Z`), checks every copy with `PRAGMA integrity_check`, and removes
 * the oldest folders beyond `keep`. Only folders with that name pattern are ever removed.
 */
export interface BackupFile { name: string; path: string; private?: boolean }
export interface BackupResult { dir: string; files: { name: string; bytes: number; integrity: string }[]; skipped: string[]; pruned: string[] }

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;
export const stampOf = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");

export function backupDatabases(opts: { root: string; files: BackupFile[]; keep?: number; now?: Date; extra?: BackupFile[] }): BackupResult {
  const dir = path.join(opts.root, stampOf(opts.now ?? new Date()));
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists (two backups in the same second?)`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const result: BackupResult = { dir, files: [], skipped: [], pruned: [] };
  for (const f of opts.files) {
    if (!fs.existsSync(f.path)) { result.skipped.push(`${f.name} (no file at ${f.path})`); continue; }
    const out = path.join(dir, `${f.name}.db`);
    const src = new DatabaseSync(f.path, { readOnly: true });
    try { src.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); } finally { src.close(); }
    if (f.private) fs.chmodSync(out, 0o600);
    const copy = new DatabaseSync(out, { readOnly: true });
    let integrity = "?";
    try { integrity = String((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check); } finally { copy.close(); }
    result.files.push({ name: f.name, bytes: fs.statSync(out).size, integrity });
  }
  for (const f of opts.extra ?? []) if (fs.existsSync(f.path)) fs.copyFileSync(f.path, path.join(dir, path.basename(f.path)));
  const keep = Math.max(1, opts.keep ?? 14);
  const old = fs.readdirSync(opts.root).filter((n) => STAMP.test(n) && fs.statSync(path.join(opts.root, n)).isDirectory()).sort();
  for (const n of old.slice(0, Math.max(0, old.length - keep))) { fs.rmSync(path.join(opts.root, n), { recursive: true, force: true }); result.pruned.push(n); }
  return result;
}

/** Opens every database in a backup folder and checks it: the tables are there and `integrity_check` says ok. Returns problems (empty = good). */
export function verifyBackup(dir: string): string[] {
  const problems: string[] = [];
  const must: Record<string, string[]> = { ringside: ["boxers", "bouts", "events", "prediction_snapshots"], accounts: ["users", "picks", "contributions"] };
  const present = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".db")) : [];
  if (!present.length) return [`no database files in ${dir}`];
  for (const n of present) {
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(path.join(dir, n), { readOnly: true });
      const ok = String((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check);
      if (ok !== "ok") problems.push(`${n}: integrity_check says ${ok}`);
      const have = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
      for (const t of must[n.replace(/\.db$/, "")] ?? []) if (!have.has(t)) problems.push(`${n}: table ${t} is missing`);
    } catch (e) { problems.push(`${n}: cannot be read (${(e as Error).message})`); } // a badly damaged file may not even open
    finally { db?.close(); }
  }
  return problems;
}
