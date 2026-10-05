/**
 * The licensed feed's whole life: first load, then daily updates. Read docs/real-data-runbook.md before the first run.
 *
 *   npm run vendor:backfill -- --plan              fetch the fight list and say what the fighters will cost; writes nothing (needs only BOXING_API_KEY).
 *                                                  With --cache-dir it keeps the fight-list pages there (and says storing is provisional until confirmed), so the list is paid for once:
 *                                                  the --check or load that follows reads it from the cache. Without --cache-dir, stopping a plan loses the pages read so far.
 *   npm run vendor:backfill -- --check             fetch (resumable), run the validator over everything, print the report; the database is not touched
 *   npm run vendor:backfill                        fetch (resumable), validate (strict), back up, load into the database, recompute ratings
 *   npm run vendor:backfill -- --update            the daily job: fights since the latest card in the database (less 14 days) and the coming weeks, with fresh fighter records
 *
 * Options: --since YYYY-MM-DD  --refresh (fetch everything again)  --gap-ms 300  --retries 4  --max-requests 100000
 *          --per-hour N (never more than N requests an hour, evenly spaced: for a plan with its own hourly limit; or set BOXING_API_PER_HOUR)  --patience-min 90 (how long to wait out a rate-limit refusal before giving up; 0 = don't wait)  --cache-dir <dir>  --offset-limit 10000 (documents a page number can reach; a longer list is read in date windows)
 *          --fighters N (take only the N most recently active fighters, coming fights counting: the fights between two of them are loaded; run again with a bigger N, or none, for the rest: what is fetched is cached)
 *          --with-opponents | --whole-groups (with --fighters N: also fetch every opponent of the N, so each of the N has all his fights; or take whole groups of fighters, newest group first, while they fit in N, so nobody in them has a fight outside: `--plan` prints what each would ask for)
 *          --complete-only (load only the fighters whose records add up exactly to the vendor's career totals, and whose opponents' do: a smaller league in which no record is short)
 *          --cached-only (with --check or a load: make no request, use only what --cache-dir holds, and leave out the fighters not fetched yet; needs no key and does not wait for a fetch under way)
 *          --explain-conflicts (with --check: list the fights behind the first --show 10 conflicts; the tally of causes is always printed)
 *          --allow-incomplete (load even though some fighters could not be fetched)  --allow-errors (load even though the validator found errors)
 *          --min-complete 0.9 (the share of fighters whose loaded fights must add up to the vendor's career record)  --allow-partial  --allow-conflicts
 *          --into-existing (the database already holds other fighters: load alongside them)  --no-backup
 * Everything except --plan fills the cache and the database. Storing is ON by default while the vendor's answer on storage is pending (every run
 * says so); BOXING_API_STORAGE_CONFIRMED=1 records that the vendor agreed in writing and silences the warning, =0 refuses to store.
 * Point DATABASE_PATH at a NEW file for the real league; never at the demo database.
 */
process.env.RINGSIDE_NO_SEED = "1"; // an empty database is what we are here to fill: the app's own first-request seeding must not start
import path from "node:path";
import { boxingDataApiProvider, storageStatus, type BoxingDataApiOptions } from "../lib/providers/boxing-data-api";
import { loadFeed } from "../lib/feed";
import type { DataProvider } from "../lib/providers";
import { countBySeverity, groupIssues, sanitizeFeed } from "../lib/validate";
import { todayIso } from "../lib/clock";
import { acquireBackfillLock, describePlan, foreignFighters, releaseBackfillLock, updateSince } from "../lib/vendor-backfill";
import { coherentCore, describeConflictReport, describeReconciliation, explainConflicts, reconcileDb, reconcileFeed, recordGate, restrictFeed } from "../lib/vendor-verify";

/** how many days the vendor's career totals may trail a result before a surplus counts as a contradiction (daily update audit only; a load is strict) */
const LAG_DAYS = Number(process.env.VENDOR_LAG_DAYS ?? 7);
const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : undefined; };
const flag = (k: string) => argv.includes(`--${k}`);
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m: string) => console.log(`${stamp()}  ${m}`);

async function main() {
  const cachedOnly = flag("cached-only");
  // --cached-only sends nothing, so it needs no key and no lock (it shares no allowance); the key is only a placeholder the adapter never sends
  const key = process.env.BOXING_API_KEY || (cachedOnly ? "cached-only-no-request-is-ever-sent-0000000000" : undefined);
  if (!key) throw new Error("Set BOXING_API_KEY (your RapidAPI key for the Boxing Data API).");
  const plan = flag("plan"), check = flag("check"), update = flag("update");
  if (cachedOnly && (plan || update || flag("refresh") || arg("cache-dir") === undefined)) throw new Error("--cached-only reads what --cache-dir already holds and makes no request: give --cache-dir, and not --plan, --update or --refresh.");
  const planCaches = plan && arg("cache-dir") !== undefined; // a plan told where to cache keeps the list pages: the 400-odd list requests are an hour of the plan's allowance
  // one run at a time per key on this machine: they share the plan's hourly allowance (a plan that keeps nothing still spends it, so it is locked too)
  const lock = cachedOnly ? undefined : acquireBackfillLock(key, { command: process.argv.slice(2).join(" ") });
  const unlock = () => { if (lock) releaseBackfillLock(lock); };
  process.on("exit", unlock);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => process.exit(130));
  if ((!plan || planCaches) && !cachedOnly) storageStatus(); // before anything is created: if storing is switched off (=0) the refusal leaves no cache and no empty database behind
  const gapMs = Number(arg("gap-ms") ?? 300);
  const perHourText = arg("per-hour") ?? process.env.BOXING_API_PER_HOUR; // the plan's own hourly limit: 500 on the Mega plan
  const perHour = perHourText ? Number(perHourText) : undefined;
  if (perHour !== undefined && !(perHour > 0)) throw new Error(`--per-hour (or BOXING_API_PER_HOUR) must be a number above 0, not "${perHourText}".`);
  const fightersText = arg("fighters");
  const maxFighters = fightersText === undefined ? undefined : Number(fightersText);
  if (maxFighters !== undefined && !(Number.isInteger(maxFighters) && maxFighters > 0)) throw new Error(`--fighters must be a whole number above 0, not "${fightersText}".`);
  const completeOnly = flag("complete-only");
  const withOpponents = flag("with-opponents"), wholeGroups = flag("whole-groups");
  if (withOpponents && wholeGroups) throw new Error("--with-opponents and --whole-groups are two ways to choose the fighters: use one.");
  if ((withOpponents || wholeGroups) && maxFighters === undefined) throw new Error("--with-opponents and --whole-groups choose from the first --fighters N: give --fighters N too (without it every fighter is taken anyway).");
  if (update && (maxFighters !== undefined || completeOnly)) throw new Error("--fighters and --complete-only are for the first load, not for --update (an update fetches the fighters of the recent fights, all of them).");
  const base: BoxingDataApiOptions = {
    key, baseUrl: process.env.BOXING_API_URL || undefined, purpose: plan && !planCaches ? "evaluation" : "ingest", // a plan with no --cache-dir reads the list in memory and keeps nothing
    retries: Number(arg("retries") ?? 4), gapMs, perHour, maxFighters, selectMode: wholeGroups ? "groups" : withOpponents ? "opponents" : "recent", patienceMs: Math.max(0, Number(arg("patience-min") ?? 90)) * 60_000, maxRequests: Number(arg("max-requests") ?? 100_000), log, since: arg("since"), offsetLimit: arg("offset-limit") ? Number(arg("offset-limit")) : undefined,
    ...(plan && !planCaches ? {} : { cacheDir: path.resolve(arg("cache-dir") ?? path.join(process.cwd(), "data", "vendor-cache", "boxing-data-api")) }),
    // a daily update must see today's results (not yesterday's cached pages) and fresh career records for the fighters who just fought (a cached record predates the fight, and the audit would call it a contradiction)
    refresh: flag("refresh") || update,
    ...(cachedOnly ? { cachedOnly: true, retries: 0, gapMs: 0 } : {}),
  };

  let db: Awaited<ReturnType<typeof import("../lib/db").getDb>> | undefined;
  if (!plan && !check) {
    db = await (await import("../lib/db")).getDb();
    const f = foreignFighters(db);
    if (f.foreign > 0 && !flag("into-existing")) throw new Error(`This database already holds ${f.foreign} fighter(s) that did not come from this feed${f.example ? ` (for example ${f.example})` : ""}. Loading real fighters next to them would mix the two. Point DATABASE_PATH at a new file, or pass --into-existing if you mean it.`);
    if (update) {
      const since = updateSince(db, todayIso());
      if (!since) throw new Error("There is nothing to update yet: the database has no completed card. Run the backfill first.");
      base.since = arg("since") ?? since;
      log(`updating from ${base.since}`);
    } else if (f.fromFeed > 0) log(`the database already holds ${f.fromFeed} fighters from this feed: this load updates them in place`);
  }

  const provider = boxingDataApiProvider(base);
  const started = Date.now();

  if (plan) {
    for (const line of describePlan(await provider.plan(), { gapMs, perHour })) console.log(line);
    console.log("\nNothing was written. Decide from these numbers, then run without --plan once storage is confirmed.");
    return;
  }

  let raw = await loadFeed(provider);
  const notes = Object.entries(provider.notes()).filter(([, v]) => v > 0);
  log(`fetched: ${raw.boxers.length} fighters, ${raw.events.length} events, ${raw.bouts.length} bouts; ${provider.requests()} request(s) made, ${provider.cacheHits()} answered from the cache, ${(provider.bytes() / 1_048_576).toFixed(1)} MB downloaded, ${Math.round((Date.now() - started) / 1000)} s`);
  if (notes.length) console.log(`approximated or skipped:\n${notes.map(([k, v]) => `  ${k.padEnd(28)} ${v}`).join("\n")}`);
  if (provider.notes().boutsDroppedUnknownFighter > 0 && !flag("allow-incomplete")) {
    throw new Error(`${provider.notes().boutsDroppedUnknownFighter} fight(s) were left out because a fighter could not be fetched (see the "skipped" lines above). Run the same command again: what already succeeded is cached, so it only retries the rest. --allow-incomplete loads without them.`);
  }

  let source: DataProvider = provider;
  if (completeOnly) {
    const core = coherentCore(raw, provider.vendorRecords());
    if (core.fighters.size === 0) throw new Error("--complete-only: not one fighter's loaded fights add up to the vendor's career record (with their opponents', either), so there is nothing to load. Fetch more fighters (a bigger --fighters, or none) and try again.");
    const cut = restrictFeed(raw, core.fighters);
    console.log(`core (--complete-only): ${cut.boxers.length} of ${raw.boxers.length} fighters, ${cut.bouts.length} of ${raw.bouts.length} fights, ${cut.events.length} events. ${core.completeAlone} fighters add up to the vendor's record on their own; ${core.completeAlone - cut.boxers.length} of them are left out because an opponent in a fight that counts does not, and would show a short record. Every record in the core equals the vendor's career total.`);
    raw = cut;
    source = { ...provider, name: provider.name, fetchBoxers: async () => cut.boxers, fetchEvents: async () => cut.events, fetchBouts: async () => cut.bouts };
  } else if (maxFighters !== undefined) console.log(`selection: the ${maxFighters} most recently active fighters (and the fights between them). Their records come out short wherever an opponent was not taken; the records line below says how many (--complete-only keeps only the ones that are right).`);

  const { issues } = sanitizeFeed(raw, { today: todayIso() });
  const sev = countBySeverity(issues);
  console.log(`validator: ${sev.errors} error(s), ${sev.warnings} warning(s), ${sev.infos} note(s)`);
  for (const g of groupIssues(issues, 3)) {
    console.log(`  ${g.severity.toUpperCase().padEnd(7)} ${g.code}  x${g.count}`);
    for (const e of g.examples) console.log(`          ${e.entity} ${e.ref}: ${e.message}`);
  }
  // The one independent figure in the feed: each fighter's career record. A record the loaded fights do not add up to would be published wrongly.
  const gateOpts = { minComplete: Number(arg("min-complete") ?? 0.9), allowPartial: flag("allow-partial"), allowConflicts: flag("allow-conflicts") };
  let gate = { ok: true, reasons: [] as string[] };
  if (!update) {
    const rec = reconcileFeed(raw, provider.vendorRecords());
    for (const line of describeReconciliation(rec)) console.log(line);
    if (rec.conflict) for (const line of describeConflictReport(explainConflicts(raw, provider.vendorRecords(), todayIso()), flag("explain-conflicts") ? Number(arg("show") ?? 10) : 0)) console.log(line);
    gate = recordGate(rec, gateOpts);
  }
  if (check) {
    process.exitCode = sev.errors || !gate.ok ? 1 : 0;
    if (!gate.ok) console.log(`\na load would be refused:\n  - ${gate.reasons.join("\n  - ")}`);
    console.log("\n--check: the database was not touched.");
    return;
  }
  if (!gate.ok) throw new Error(`Nothing was loaded, because ${gate.reasons.join(" Also, ")}`);
  if (sev.errors > 0 && !flag("allow-errors")) throw new Error(`The validator found ${sev.errors} error(s); nothing was loaded. Fix the cause (or pass --allow-errors to drop those rows and load the rest).`);

  const { ingest } = await import("../lib/ingest");
  if (db && foreignFighters(db).total > 0 && !flag("no-backup")) {
    const { backupDatabases } = await import("../lib/backup");
    const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db");
    const backup = () => backupDatabases({ root: path.join(path.dirname(dbPath), "backups"), files: [{ name: "ringside", path: dbPath }], keep: 14 });
    let r;
    try { r = backup(); }
    catch (e) { // a backup folder is named to the second: two loads a second apart would collide, so wait it out once
      if (!/already exists/.test(String(e))) throw e;
      await new Promise((ok) => setTimeout(ok, 1100)); r = backup();
    }
    log(`backed up the database first: ${r.dir}`);
  }
  const report = await ingest(db!, source, { strict: !flag("allow-errors") });
  log(`loaded: ${Object.entries(report.counts).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(", ")}; ${report.errors} error(s), ${report.warnings} warning(s) (run ${report.runId})`);
  if (update) { // the feed held only recent fights, so judge the careers as the database now has them
    const rec = reconcileDb(db!, provider.vendorRecords(), raw.boxers.map((b) => b.externalId), { today: todayIso(), days: LAG_DAYS });
    console.log("after the update:");
    for (const line of describeReconciliation(rec)) console.log(line);
  }
  console.log("\nRatings were recomputed. A running app notices the change by itself: its next request rebuilds the world (no restart).");
}
main().catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}`); process.exit(1); });
