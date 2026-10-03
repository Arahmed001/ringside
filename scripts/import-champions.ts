/**
 * World title reigns from Wikipedia's lists of WBA, WBC, IBF and WBO champions (text CC BY-SA 4.0, credited on each fighter's page).
 *
 *   npm run champions:import                      fetch the four men's lists (cached), read every reign, store them, link them to our fighters
 *   npm run champions:import -- --org WBO,IBF     only some bodies
 *   npm run champions:import -- --link-only       no network: re-link the stored reigns (after a wikidata:import --enrich)
 *   npm run champions:import -- --refresh         ignore the cache and fetch the pages again
 *
 * Options: --cache-dir <dir> (default data/wikipedia-cache)  --gap-ms 1500 (pause between requests; Wikipedia rate-limits shared addresses, so a 429 is waited out)
 * Needs WIKIMEDIA_CONTACT (your own email or site: Wikimedia asks automated clients to identify themselves). A reign is linked to a fighter only
 * through the fighter's Wikidata ID, so run `npm run wikidata:import` and `-- --enrich` first; without them the reigns are stored but link to no one.
 */
import path from "node:path";
import { getDb } from "../lib/db";
import { CHAMPION_SOURCES, importChampions, linkReigns } from "../lib/importers/wikipedia-champions";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const flag = (k: string) => process.argv.includes(`--${k}`);

async function main() {
  const db = await getDb();
  if (flag("link-only")) { console.log(`linked ${linkReigns(db)} reigns`); return; }
  const orgs = arg("org")?.split(",").map((s) => s.trim().toUpperCase());
  const sources = CHAMPION_SOURCES.filter((s) => !orgs || orgs.includes(s.org));
  if (!sources.length) throw new Error(`No such body: ${arg("org")}. Choose from ${CHAMPION_SOURCES.map((s) => s.org).join(", ")}.`);
  const s = await importChampions(db, {
    sources, refresh: flag("refresh"), gapMs: Number(arg("gap-ms") ?? 1500), log: (m) => console.log(m),
    cacheDir: path.resolve(arg("cache-dir") ?? path.join(process.cwd(), "data", "wikipedia-cache")),
  });
  console.log(`\n${s.reigns} reigns from ${s.pages} page(s); ${s.qidsResolved} Wikidata IDs resolved; ${s.linked} reigns linked to our fighters`);
  if (s.skipped) console.log(`${s.skipped} row(s) could not be read (a date the page misspells, a single date with no end) and were left out rather than guessed`);
  if (s.notes.divisionUnknown) console.log(`${s.notes.divisionUnknown} division heading(s) are not in Ringside's list (for example Bridgerweight); their reigns are kept under the page's name`);
  if (s.linked === 0) console.log("None linked: run `npm run wikidata:import` and `npm run wikidata:import -- --enrich` so our fighters carry Wikidata IDs, then `npm run champions:import -- --link-only`.");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
