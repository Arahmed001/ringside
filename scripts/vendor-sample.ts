/**
 * npm run vendor:sample -- --fights 10        fetch the latest 10 fights and their fighters from the Boxing Data API
 * npm run vendor:sample -- --fights 10 --since 2025-01-01 --max-requests 40
 * npm run vendor:sample -- --from-raw data/vendor-samples/raw   re-run the mapping over saved responses: NO requests are made, no key needed
 * npm run vendor:sample -- --fights 10 --save-raw     also keep every raw response in data/vendor-samples/raw/ (gitignored), to fix a mapping offline
 * Needs BOXING_API_KEY. A sample of N fights costs at most 1 + 2N requests (one list call, then each fighter once), so 10 fights is
 * about 21 of the free tier's 100 a month; the default cap is 60 and the run stops there rather than going over.
 *
 * It writes data/vendor-samples/boxing-data-api-<date>.json in the FeedData shape (gitignored: never commit vendor data) and
 * prints how many facts had to be approximated. Then check it without touching the database:
 *   npm run data:check -- --file data/vendor-samples/boxing-data-api-<date>.json
 * This is evaluation use; filling the database is `npm run vendor:backfill` (storing is on by default, provisionally; see docs/real-data-runbook.md).
 */
import fs from "node:fs";
import path from "node:path";
import { boxingDataApiProvider, replayFetch } from "../lib/providers/boxing-data-api";
import { todayIso } from "../lib/clock";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const fromRaw = arg("from-raw");
  const key = fromRaw ? "replay" : process.env.BOXING_API_KEY;
  if (!key) throw new Error("Set BOXING_API_KEY (your RapidAPI key for the Boxing Data API), or replay saved responses with --from-raw <dir>.");
  const fights = Number(arg("fights") ?? 10);
  const p = boxingDataApiProvider({
    key, baseUrl: process.env.BOXING_API_URL || undefined, purpose: "evaluation", gapMs: fromRaw ? 0 : 300, log: console.log,
    ...(fromRaw ? { fetchImpl: replayFetch(path.resolve(fromRaw)), maxRequests: 10_000 } : {}),
    maxFights: fights, since: arg("since"), maxRequests: Number(arg("max-requests") ?? 60),
    rawDir: process.argv.includes("--save-raw") && !fromRaw ? path.join(process.cwd(), "data", "vendor-samples", "raw") : undefined,
  });
  const [boxers, events, bouts] = await Promise.all([p.fetchBoxers(), p.fetchEvents(), p.fetchBouts()]);
  const dir = path.join(process.cwd(), "data", "vendor-samples");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `boxing-data-api-${todayIso()}.json`);
  fs.writeFileSync(file, JSON.stringify({ boxers, events, bouts }, null, 2));
  console.log(`\n${fromRaw ? "replayed from saved responses (no requests made)" : `${p.requests()} request(s)`}: ${boxers.length} fighters, ${events.length} events, ${bouts.length} bouts -> ${path.relative(process.cwd(), file)}`);
  const n = Object.entries(p.notes()).filter(([, v]) => v > 0);
  console.log(n.length ? `\napproximated or skipped:\n${n.map(([k, v]) => `  ${k.padEnd(28)} ${v}`).join("\n")}` : "\nnothing had to be approximated");
  console.log(`\nnext: npm run data:check -- --file ${path.relative(process.cwd(), file)}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
