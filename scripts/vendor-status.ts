/**
 * npm run vendor:status -- [--cache-dir DIR] [--no-total]
 * Where a long vendor fetch stands: how much of the league is in the cache, whether a fetch is running, whether the key is set in THIS terminal tab, how long is
 * left, and the next command that fits. It reads files on this machine only: no request is made and the key is never printed or sent (only its length).
 * `--no-total` skips reading the fight list from the cache (about 10 seconds) when only the counts are wanted.
 */
import path from "node:path";
import { boxingDataApiProvider } from "../lib/providers/boxing-data-api";
import fs from "node:fs";
import { DEFAULT_KEY_FILE, backgroundFiles, keyFileState, logTail } from "../lib/vendor-fetch";
import { cacheState, describeStatus, keyState, runningBackfills } from "../lib/vendor-status";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : undefined; };

async function main() {
  const cacheDir = path.resolve(arg("cache-dir") ?? path.join(process.cwd(), "data", "vendor-cache", "boxing-data-api"));
  const cache = cacheState(cacheDir);
  let total: number | null = null;
  if (!argv.includes("--no-total") && cache.listPages > 0) {
    try {
      // the fight list is read from the cache (cachedOnly: no request, no key needed); the number of fighters in it is what the fetch is working towards
      const p = boxingDataApiProvider({ key: "status-only-no-request-is-ever-sent-0000000000", purpose: "evaluation", fetchImpl: (async () => { throw new Error("no request"); }) as typeof fetch, cacheDir, cachedOnly: true, scheduleDays: 0, retries: 0, gapMs: 0, log: () => {} });
      total = (await p.plan()).fighters;
    } catch { console.log("(the fight list could not be read from the cache, so the total is unknown; run the fetch once to read it)\n"); }
  }
  const logPath = backgroundFiles(cacheDir).log, logStat = fs.existsSync(logPath) ? fs.statSync(logPath) : null;
  const log = logStat ? { path: logPath, tail: logTail(logPath, 3), ageMinutes: (Date.now() - logStat.mtimeMs) / 60000 } : undefined;
  for (const line of describeStatus({ cacheDir, log, cache, total, running: runningBackfills(), key: keyState(process.env.BOXING_API_KEY), keyFile: keyFileState(process.env.RINGSIDE_KEY_FILE ?? DEFAULT_KEY_FILE), storageConfirmed: process.env.BOXING_API_STORAGE_CONFIRMED, databasePath: process.env.DATABASE_PATH })) console.log(line);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
