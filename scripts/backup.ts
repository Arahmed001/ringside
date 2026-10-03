/**
 * npm run backup [-- --dir /data/backups] [--keep 14]     snapshot ringside.db and accounts.db (and model-fit.json) into a timestamped folder
 * npm run backup -- verify /data/backups/2026-10-03T12-00-00Z   check a backup before you rely on it
 * Default folder: `backups/` next to DATABASE_PATH (on the same volume, so copy it OFF the volume too: a backup on the disk that dies is not one).
 * Safe while the app is running. The accounts copy is personal data: keep it as private as the original.
 */
import path from "node:path";
import { accountsPath } from "../lib/accounts/store";
import { backupDatabases, verifyBackup } from "../lib/backup";

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : undefined; };
const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db");

if (argv[0] === "verify") {
  const problems = verifyBackup(argv[1] ?? "");
  console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "backup is good: every database opens, passes integrity_check and has its tables");
  process.exit(problems.length ? 1 : 0);
}
const r = backupDatabases({
  root: path.resolve(flag("dir") ?? path.join(path.dirname(dbPath), "backups")), keep: flag("keep") ? Number(flag("keep")) : 14,
  files: [{ name: "ringside", path: dbPath }, { name: "accounts", path: accountsPath(), private: true }],
  extra: [{ name: "model-fit", path: path.join(path.dirname(dbPath), "model-fit.json") }],
});
console.log(`backup written to ${r.dir}`);
for (const f of r.files) console.log(`  ${f.name}.db  ${(f.bytes / 1024).toFixed(0)} KB  integrity ${f.integrity}`);
for (const s of r.skipped) console.log(`  skipped ${s}`);
if (r.pruned.length) console.log(`  removed old backups: ${r.pruned.join(", ")}`);
process.exit(r.files.some((f) => f.integrity !== "ok") || !r.files.length ? 1 : 0);
