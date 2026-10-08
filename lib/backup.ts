import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Consistent copies of the databases that cannot be rebuilt: the sports database (it holds the live prediction ledger) and the accounts
 * database (people, picks, edits). `VACUUM INTO` takes a snapshot while the app keeps writing; copying the files with `cp` can give a torn
 * file. Each run writes one folder named for the time (`2026-10-03T12-00-00Z`), checks every copy with `PRAGMA integrity_check`, and removes
 * the oldest folders beyond `keep`. Only folders with that name pattern are ever removed.
 */
/** How many dated backup folders are kept (the oldest are removed) when nothing else is asked for. */
export const DEFAULT_BACKUPS_KEPT = 14;

/** The list of fingerprints written into every backup folder: one line per file, `<sha256>  <name>`, like `sha256sum` prints. */
export const MANIFEST = "checksums.sha256";
export const sha256File = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

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
  const manifest = fs.readdirSync(dir).filter((n) => n !== MANIFEST).sort().map((n) => `${sha256File(path.join(dir, n))}  ${n}`);
  fs.writeFileSync(path.join(dir, MANIFEST), manifest.join("\n") + "\n", { mode: 0o600 });
  result.pruned = pruneBackups(opts.root, opts.keep ?? DEFAULT_BACKUPS_KEPT);
  return result;
}

/**
 * Removes the oldest dated backup folders beyond `keep` (at least 1) and returns their names. Only directories named like a backup this tool writes are ever
 * touched: `before-restore/` (the safety copies a restore makes), a folder someone made by hand and loose files all stay. Pass `Infinity` to prune nothing.
 */
export function pruneBackups(root: string, keep: number): string[] {
  const k = Math.max(1, keep);
  const old = fs.readdirSync(root).filter((n) => STAMP.test(n) && fs.statSync(path.join(root, n)).isDirectory()).sort();
  const gone: string[] = [];
  for (const n of old.slice(0, Math.max(0, old.length - k))) { fs.rmSync(path.join(root, n), { recursive: true, force: true }); gone.push(n); }
  return gone;
}

/** Opens every database in a backup folder and checks it: the tables are there and `integrity_check` says ok. Returns problems (empty = good). */
export function verifyBackup(dir: string, opts: { requireChecksums?: boolean } = {}): string[] {
  const problems: string[] = [];
  const manifestFile = path.join(dir, MANIFEST);
  if (fs.existsSync(manifestFile)) {
    const listed = new Map<string, string>();
    for (const line of fs.readFileSync(manifestFile, "utf8").split("\n")) { const m = /^([0-9a-f]{64})  (.+)$/.exec(line); if (m) listed.set(m[2], m[1]); }
    for (const [name, hash] of listed) {
      const f = path.join(dir, path.basename(name));
      if (!fs.existsSync(f)) problems.push(`${name}: listed in ${MANIFEST} but missing`);
      else if (sha256File(f) !== hash) problems.push(`${name}: checksum does not match (the file changed or was cut short after the backup was made)`);
    }
    for (const n of fs.readdirSync(dir)) if (n.endsWith(".db") && !listed.has(n)) problems.push(`${n}: not listed in ${MANIFEST} (added after the backup was made)`);
  } else if (opts.requireChecksums && fs.existsSync(dir)) problems.push(`no ${MANIFEST} in ${dir}: a backup made before checksums were written cannot be checked for damage in transit`);
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
