/**
 * Looks at a public source and stores what differs from our data as PENDING proposals. It never changes the live data: only an admin's approval does that (PLAN 253).
 *
 *   npm run watch -- --source champions            read the Wikipedia lists (cached), compare with the reigns held, store the differences
 *   npm run watch -- --source champions --dry-run  show the differences and store nothing
 *   npm run watch -- --source results --limit 40  read the Wikipedia records of 40 fighters with past fights held without a result, propose the results found
 *   npm run watch -- --list                        the pending proposals
 *
 * Options: --org WBO,IBF (only some bodies)  --cache-dir <dir> (default data/wikipedia-cache)  --refresh (ignore the cache)  --gap-ms 1500
 * Needs WIKIMEDIA_CONTACT for the Wikipedia source (your own email or site: Wikimedia asks automated clients to identify themselves).
 */
import path from "node:path";
import { getDb } from "../lib/db";
import { accountsDb } from "../lib/accounts/store";
import { CHAMPION_SOURCES } from "../lib/importers/wikipedia-champions";
import { SOURCES, runWatch } from "../lib/watch/run";
import { listProposals } from "../lib/watch/proposals";
import { reportLines } from "../lib/watch/report";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const flag = (k: string) => process.argv.includes(`--${k}`);

async function main() {
  const acc = accountsDb();
  if (flag("list")) {
    const rows = listProposals(acc);
    for (const p of rows) console.log(`#${p.id} [${p.source}] ${p.kind}: ${p.label}`);
    console.log(`${rows.length} pending`);
    return;
  }
  const id = arg("source");
  if (!id) throw new Error(`Say which source: --source ${SOURCES.filter((s) => s.run).map((s) => s.id.split(":").pop()).join(" | ")}`);
  const main = await getDb();
  const dryRun = flag("dry-run");
  const orgs = arg("org")?.split(",").map((x) => x.trim().toUpperCase());
  const r = await runWatch(id, {
    main, limit: arg("limit") ? Number(arg("limit")) : undefined, log: (m) => console.log(m), championSources: CHAMPION_SOURCES.filter((x) => !orgs || orgs.includes(x.org)),
    fetch: { refresh: flag("refresh"), gapMs: Number(arg("gap-ms") ?? 1500), cacheDir: path.resolve(arg("cache-dir") ?? path.join(process.cwd(), "data", "wikipedia-cache")) },
  }, acc, { dryRun });
  console.log(`\n${reportLines(r, dryRun).join("\n")}`);
  if (r.refused.length) process.exitCode = 3;
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
