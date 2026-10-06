/**
 * npm run backup [-- --dir /data/backups] [--keep 14]     snapshot ringside.db and accounts.db (and model-fit.json) into a timestamped folder
 * npm run backup -- verify /data/backups/2026-10-03T12-00-00Z   check a backup before you rely on it
 * npm run backup -- restore <folder> [--dry-run] [--even-if-running] [--allow-unchecked] [--port 3000]   put a backup back (verifies it, saves the current data first, swaps atomically)
 * Default folder: `backups/` next to DATABASE_PATH (on the same volume, so copy it OFF the volume too: a backup on the disk that dies is not one).
 * Safe while the app is running. The accounts copy is personal data: keep it as private as the original.
 */
import path from "node:path";
import { accountsPath } from "../lib/accounts/store";
import { restoreBackup } from "../lib/restore";
import { backupDatabases, DEFAULT_BACKUPS_KEPT, verifyBackup } from "../lib/backup";

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : undefined; };
const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db");

if (argv[0] === "verify") {
  const problems = verifyBackup(argv[1] ?? "");
  console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "backup is good: every database opens, passes integrity_check, has its tables and matches its checksums");
  process.exit(problems.length ? 1 : 0);
}
async function restoreCli(): Promise<number> {
  const folder = argv[1] && !argv[1].startsWith("--") ? path.resolve(argv[1]) : "";
  if (!folder) { console.log("Say which backup: npm run backup -- restore /data/backups/<folder>   (add --dry-run to see what it would do and change nothing)"); return 2; }
  const dataDir = path.dirname(dbPath);
  const res = await restoreBackup({
    backupDir: folder, dryRun: argv.includes("--dry-run"), allowRunning: argv.includes("--even-if-running"), allowUnchecked: argv.includes("--allow-unchecked"), port: flag("port") ? Number(flag("port")) : 3000,
    databases: [{ name: "ringside", path: dbPath }, { name: "accounts", path: accountsPath(), private: true }],
    extra: [{ name: "model-fit", path: path.join(dataDir, "model-fit.json") }],
    safetyRoot: path.join(dataDir, "backups", "before-restore"),
  });
  for (const l of res.did) console.log(`  ${l}`);
  if (res.refused.length) { console.log(`\nREFUSED: ${res.refused[0]}`); for (const l of res.refused.slice(1)) console.log(l); return 1; }
  if (res.dryRun) { console.log("\nDry run finished. Nothing was changed. Run the same command without --dry-run to restore."); return 0; }
  for (const c of res.counts) console.log(`  now in place: ${c}`);
  console.log("\nRestored. Start the site again and check /api/health.");
  if (res.safetyDir) console.log(`To undo: stop the site, then run   npm run backup -- restore ${res.safetyDir}\n(that puts back exactly what was here before this restore).`);
  return 0;
}
if (argv[0] === "restore") { restoreCli().then((c) => process.exit(c), (e) => { console.error(`restore failed unexpectedly: ${(e as Error).message}`); process.exit(1); }); } else {
const r = backupDatabases({
  root: path.resolve(flag("dir") ?? path.join(path.dirname(dbPath), "backups")), keep: flag("keep") ? Number(flag("keep")) : DEFAULT_BACKUPS_KEPT,
  files: [{ name: "ringside", path: dbPath }, { name: "accounts", path: accountsPath(), private: true }],
  extra: [{ name: "model-fit", path: path.join(path.dirname(dbPath), "model-fit.json") }],
});
console.log(`backup written to ${r.dir}`);
for (const f of r.files) console.log(`  ${f.name}.db  ${(f.bytes / 1024).toFixed(0)} KB  integrity ${f.integrity}`);
for (const s of r.skipped) console.log(`  skipped ${s}`);
if (r.pruned.length) console.log(`  removed old backups: ${r.pruned.join(", ")}`);
process.exit(r.files.some((f) => f.integrity !== "ok") || !r.files.length ? 1 : 0);
}
