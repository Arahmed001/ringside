/**
 * World title reigns from Wikipedia's lists of WBA, WBC, IBF and WBO champions (text CC BY-SA 4.0, credited on each fighter's page).
 *
 *   npm run champions:import                      fetch the four men's lists (cached), read every reign, store them, link them to our fighters
 *   npm run champions:import -- --org WBO,IBF     only some bodies
 *   npm run champions:import -- --link-only       no network: re-link the stored reigns (after a wikidata:import --enrich)
 *   npm run champions:import -- --refresh         ignore the cache and fetch the pages again
 *   npm run champions:import -- --apply-all       replace the stored reigns with the pages' at once, without approval (the owner's own override; logged)
 *
 * The first import into an empty table stores what the pages say: there is nothing to approve over. Once reigns are held, the same command only LOOKS: it compares the
 * pages with what is held and stores the differences as proposals for an administrator to approve at /review/updates (the same as `npm run watch -- --source champions`),
 * and changes nothing live. A re-import used to overwrite what had been approved and what had not; it no longer can unless --apply-all says so.
 *
 * Options: --cache-dir <dir> (default data/wikipedia-cache)  --gap-ms 1500 (pause between requests; Wikipedia rate-limits shared addresses, so a 429 is waited out)
 * Needs WIKIMEDIA_CONTACT (your own email or site: Wikimedia asks automated clients to identify themselves). A reign is linked to a fighter only
 * through the fighter's Wikidata ID, so run `npm run wikidata:import` and `-- --enrich` first; without them the reigns are stored but link to no one.
 */
import path from "node:path";
import { getDb } from "../lib/db";
import { CHAMPION_SOURCES, ensureReignTable, importChampions, linkReigns } from "../lib/importers/wikipedia-champions";
import { accountsDb, audit } from "../lib/accounts/store";
import { runWatch } from "../lib/watch/run";
import { reportLines } from "../lib/watch/report";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const flag = (k: string) => process.argv.includes(`--${k}`);

async function main() {
  const db = await getDb();
  if (flag("link-only")) { console.log(`linked ${linkReigns(db)} reigns`); return; }
  const orgs = arg("org")?.split(",").map((s) => s.trim().toUpperCase());
  const sources = CHAMPION_SOURCES.filter((s) => !orgs || orgs.includes(s.org));
  if (!sources.length) throw new Error(`No such body: ${arg("org")}. Choose from ${CHAMPION_SOURCES.map((s) => s.org).join(", ")}.`);
  const fetch = { refresh: flag("refresh"), gapMs: Number(arg("gap-ms") ?? 1500), cacheDir: path.resolve(arg("cache-dir") ?? path.join(process.cwd(), "data", "wikipedia-cache")) };
  ensureReignTable(db);
  const held = (db.prepare(`SELECT COUNT(*) c FROM title_reigns WHERE source IN (${sources.map(() => "?").join(",")})`).get(...sources.map((x) => x.page)) as { c: number }).c;
  if (held > 0 && !flag("apply-all")) {
    console.log(`${held} reign(s) are already held for ${sources.map((x) => x.org).join(", ")}: looking for differences instead of replacing them (use --apply-all to replace them without approval).`);
    const r = await runWatch("champions", { main: db, championSources: sources, fetch, log: (m) => console.log(m) }, accountsDb());
    console.log(`\n${reportLines(r, false).join("\n")}`);
    if (r.proposals && r.proposals.added + r.proposals.updated > 0) console.log("  Decide on them at /review/updates (administrators).");
    if (r.refused.length) process.exitCode = 3;
    return;
  }
  const s = await importChampions(db, { sources, ...fetch, log: (m) => console.log(m) });
  if (held > 0) { audit(accountsDb(), "operator", "update.apply_all", "wikipedia:champions", JSON.stringify({ orgs: sources.map((x) => x.org), replaced: held, now: s.reigns })); console.log(`--apply-all: ${held} held reign(s) replaced by ${s.reigns} from the pages, without approval (logged).`); }
  console.log(`\n${s.reigns} reigns from ${s.pages} page(s); ${s.qidsResolved} Wikidata IDs resolved; ${s.linked} reigns linked to our fighters`);
  if (s.skipped) console.log(`${s.skipped} row(s) could not be read (a date the page misspells, a single date with no end) and were left out rather than guessed`);
  if (s.notes.divisionUnknown) console.log(`${s.notes.divisionUnknown} division heading(s) are not in Ringside's list (for example Bridgerweight); their reigns are kept under the page's name`);
  if (s.linked === 0) console.log("None linked: run `npm run wikidata:import` and `npm run wikidata:import -- --enrich` so our fighters carry Wikidata IDs, then `npm run champions:import -- --link-only`.");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
