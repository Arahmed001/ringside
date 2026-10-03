/**
 * npm run wikidata:import -- --limit 500      fetch up to 500 boxers from Wikidata into the staging table (omit --limit for all ~19.6k)
 * npm run wikidata:import                     a full run; each batch is saved as it goes and boxers fetched in the last 30 days are skipped,
 *                                             so an interrupted run continues where it stopped (--max-age-days N to change, --force to refetch all)
 * npm run wikidata:import -- --extras-only    fill in Hall of Fame / Olympedia IDs and awards for boxers staged before those existed (biographies are not refetched)
 * npm run wikidata:import -- --no-extras      biographies only (one query per batch instead of two)
 * npm run wikidata:import -- --enrich         link our fighters to staged Wikidata entities and fill missing biography fields and honours
 * All need WIKIMEDIA_CONTACT (Wikimedia asks automated clients to identify themselves).
 */
import { getDb } from "../lib/db";
import { enrichFromWikidata, importWikidata } from "../lib/importers/wikidata";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] ?? "true" : undefined; };
const flag = (k: string) => process.argv.includes(`--${k}`);

async function main() {
  const db = await getDb();
  const enrichOnly = arg("enrich") !== undefined && arg("limit") === undefined && !flag("extras-only") && !flag("force");
  if (!enrichOnly) {
    const s = await importWikidata(db, {
      limit: arg("limit") ? Number(arg("limit")) : Infinity,
      extras: !flag("no-extras"), extrasOnly: flag("extras-only"), force: flag("force"),
      ...(arg("max-age-days") ? { maxAgeDays: Number(arg("max-age-days")) } : {}),
      log: console.log,
    });
    console.log("import:", s);
  }
  if (arg("enrich") !== undefined) console.log("enrich:", enrichFromWikidata(db));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
