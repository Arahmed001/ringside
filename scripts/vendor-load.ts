/**
 * npm run vendor:load -- [--dry-run] [--yes] [--storage-confirmed] [options for vendor:backfill]
 * The real load, guided: it shows the check first (what would be refused, why conflicts happen, who would be left out), then asks you to type LOAD, then loads from the cache into
 * DATABASE_PATH (default ~/ringside-real/real.db). It changes nothing until you type LOAD (or give --yes). `--dry-run` stops after the check. The key is read from the key file
 * (`npm run vendor:fetch -- --setup`; not needed for --dry-run, which reads only the cache and sends nothing, so it can be run on a cache that is still part way); the cache should be complete first (`npm run vendor:status`): a load asks the vendor for any fighter the cache lacks.
 * Defaults: --keep-disputed --allow-partial (conflicted fighters stay, marked; --drop-conflicts, --complete-only or --allow-conflicts replace the first), --disputed-file next to the database, --per-hour 400 --patience-min 240.
 * The vendor's confirmation that its data may be stored is yours to state: BOXING_API_STORAGE_CONFIRMED=1 or --storage-confirmed; it is never assumed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { cacheState } from "../lib/vendor-status";
import { DEFAULT_KEY_FILE, defaultCacheDir, readKeyFile } from "../lib/vendor-fetch";
import { isConfirmation, loadPlan } from "../lib/vendor-load";

const argv = process.argv.slice(2);
const take = (flag: string): string | undefined => { const i = argv.indexOf(flag); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, v === undefined || v.startsWith("--") ? 1 : 2); return v; };

function run(args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ["--import", "tsx", path.join(__dirname, "vendor-backfill.ts"), ...args], { stdio: "inherit", env: { ...process.env, ...env } });
    c.on("close", (code) => resolve(code ?? 1));
  });
}
const ask = (q: string): Promise<string> => new Promise((resolve) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); resolve(a); }); });

async function main() {
  const dry = argv.includes("--dry-run"), yes = argv.includes("--yes");
  const keyFile = path.resolve(take("--key-file") ?? process.env.RINGSIDE_KEY_FILE ?? DEFAULT_KEY_FILE);
  const cacheArg = take("--cache-dir");
  const plan = loadPlan([...argv, ...(cacheArg ? ["--cache-dir", cacheArg] : [])], process.env, defaultCacheDir());
  if (plan.refusal && !dry) { console.error(plan.refusal); process.exit(1); }
  // a dry run reads only the cache (--cached-only): no key, no request, no allowance used, so it can be run at any time, on a cache that is still part way
  const key = dry ? undefined : readKeyFile(keyFile);
  const cacheDir = cacheArg ?? defaultCacheDir();
  const c = cacheDir ? cacheState(cacheDir) : null;
  console.log(`vendor:load\n  cache:    ${cacheDir ?? "(the backfill's default)"}${c ? ` (${c.fighters.toLocaleString("en-US")} fighters, ${c.listPages} fight-list pages)` : ""}\n  database: ${plan.database}${fs.existsSync(plan.database) ? "  (exists: a re-load updates it in place; the backfill backs it up first)" : "  (new)"}\n  ${plan.loadArgs.includes("--keep-disputed") ? "disputed: " + plan.disputedFile : "dropped:  " + plan.droppedFile}\n  key:      ${dry ? "(not needed: a dry run reads only the cache and makes no request)" : `${keyFile} (${key!.length} characters)`}\n`);
  // the storage confirmation reaches the backfill only if the owner stated it (the environment or --storage-confirmed): it is never set for them
  const env = { BOXING_API_KEY: key ?? "", DATABASE_PATH: plan.database, ...(plan.refusal ? {} : { BOXING_API_STORAGE_CONFIRMED: "1" }) };
  console.log("step 1: the check (nothing is written to the database)\n");
  const checked = await run(dry ? [...plan.checkArgs, "--cached-only"] : plan.checkArgs, env);
  if (dry) { console.log(`\n--dry-run: stopped after the check (exit ${checked}). Nothing was loaded.`); process.exit(checked); }
  if (checked !== 0 && !argv.includes("--allow-errors")) { console.error(`\nThe check would not allow a load (exit ${checked}); read why above. Nothing was loaded.`); process.exit(checked); }
  if (!yes) {
    if (!process.stdin.isTTY) { console.error("\nThis is not an interactive terminal, so the confirmation cannot be typed. Run it in a terminal tab, or add --yes if you mean it. Nothing was loaded."); process.exit(1); }
    const a = await ask(`\nType LOAD to write this league into ${plan.database} (anything else cancels): `);
    if (!isConfirmation(a)) { console.log("Cancelled. Nothing was loaded."); process.exit(0); }
  }
  console.log("\nstep 2: the load\n");
  const code = await run(plan.loadArgs, env);
  console.log(code === 0 ? `\nLoaded into ${plan.database}. Next: docs/real-data-runbook.md section 4 (check the result by hand), run the site with DATABASE_PATH=${plan.database}, then the daily update (section 5).` : `\nThe load failed (exit ${code}). Read why above; the database file is the only thing it writes.`);
  process.exit(code);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
