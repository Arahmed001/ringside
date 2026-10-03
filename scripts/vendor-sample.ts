/**
 * npm run vendor:sample -- --fights 10        fetch the latest 10 fights and their fighters from the Boxing Data API
 * npm run vendor:sample -- --fights 10 --since 2025-01-01 --max-requests 40
 * Needs BOXING_API_KEY. A sample of N fights costs at most 1 + 2N requests (one list call, then each fighter once), so 10 fights is
 * about 21 of the free tier's 100 a month; the default cap is 60 and the run stops there rather than going over.
 *
 * It writes data/vendor-samples/boxing-data-api-<date>.json in the FeedData shape (gitignored: never commit vendor data) and
 * prints how many facts had to be approximated. Then check it without touching the database:
 *   npm run data:check -- --file data/vendor-samples/boxing-data-api-<date>.json
 * This is evaluation use; filling the database needs BOXING_API_STORAGE_CONFIRMED=1 (see lib/providers/boxing-data-api.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { boxingDataApiProvider } from "../lib/providers/boxing-data-api";
import { todayIso } from "../lib/clock";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const key = process.env.BOXING_API_KEY;
  if (!key) throw new Error("Set BOXING_API_KEY (your RapidAPI key for the Boxing Data API).");
  const fights = Number(arg("fights") ?? 10);
  const p = boxingDataApiProvider({
    key, baseUrl: process.env.BOXING_API_URL || undefined, purpose: "evaluation", gapMs: 300, log: console.log,
    maxFights: fights, since: arg("since"), maxRequests: Number(arg("max-requests") ?? 60),
  });
  const [boxers, events, bouts] = await Promise.all([p.fetchBoxers(), p.fetchEvents(), p.fetchBouts()]);
  const dir = path.join(process.cwd(), "data", "vendor-samples");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `boxing-data-api-${todayIso()}.json`);
  fs.writeFileSync(file, JSON.stringify({ boxers, events, bouts }, null, 2));
  console.log(`\n${p.requests()} request(s): ${boxers.length} fighters, ${events.length} events, ${bouts.length} bouts -> ${path.relative(process.cwd(), file)}`);
  const n = Object.entries(p.notes()).filter(([, v]) => v > 0);
  console.log(n.length ? `\napproximated or skipped:\n${n.map(([k, v]) => `  ${k.padEnd(28)} ${v}`).join("\n")}` : "\nnothing had to be approximated");
  console.log(`\nnext: npm run data:check -- --file ${path.relative(process.cwd(), file)}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
