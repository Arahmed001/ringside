/** npm run data:ingest [-- --strict]  Re-runs the configured provider (BOXING_PROVIDER, BOXING_FILE) into the existing database, upserting: nothing is duplicated, names and other side tables survive. */
import { getDb } from "../lib/db";
import { ingest } from "../lib/ingest";

(async () => {
  const db = await getDb();
  const r = await ingest(db, undefined, { strict: process.argv.includes("--strict") });
  console.log(`run ${r.runId}: ${JSON.stringify(r.counts)}; ${r.errors} error(s), ${r.warnings} warning(s); dropped ${JSON.stringify(r.dropped)}`);
})().catch((e) => { console.error(e); process.exit(1); });
