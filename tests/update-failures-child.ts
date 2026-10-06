/**
 * A helper process for tests/update-failures.test.ts: runs the daily update's writing half on a database and stops dead at a chosen point (a temp trigger calls
 * a SQL function that writes a marker file and then sleeps), so the test can SIGKILL it exactly there. Or holds a write lock for a while.
 *   node --import tsx tests/update-failures-child.ts <db> txn|ratings <marker>     stall inside the main transaction / inside the ratings recompute (after the commit)
 *   node --import tsx tests/update-failures-child.ts <db> lock:<ms> <marker>       hold the write lock for <ms>
 */
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [file, mode, marker] = process.argv.slice(2);
const nap = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
(async () => {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  if (mode.startsWith("lock:")) {
    db.exec("BEGIN IMMEDIATE");
    fs.writeFileSync(marker, String(process.pid));
    nap(Number(mode.slice(5)));
    db.exec("COMMIT");
    return;
  }
  const { makeLeague, nextDay, updateInProcess } = await import("./update-failures-helpers");
  db.function("stall", () => { fs.writeFileSync(marker, String(process.pid)); nap(120_000); return 1; });
  db.exec(`CREATE TEMP TRIGGER stall_here AFTER INSERT ON ${mode === "txn" ? "bouts" : "rating_history"} BEGIN SELECT stall(); END`);
  await updateInProcess(db, nextDay(makeLeague()).world);
})().catch((e) => { console.error(e); process.exit(1); });
