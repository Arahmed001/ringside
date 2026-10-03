/**
 * npm run wikidata:import -- --limit 500     fetch up to 500 boxers from Wikidata into the staging table (omit --limit for all ~19.6k)
 * npm run wikidata:import -- --enrich        link our fighters to staged Wikidata entities and fill missing biography fields
 * Both need WIKIMEDIA_CONTACT (Wikimedia asks automated clients to identify themselves).
 */
import { getDb } from "../lib/db";
import { enrichFromWikidata, importWikidata } from "../lib/importers/wikidata";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] ?? "true" : undefined; };

async function main() {
  const db = await getDb();
  if (arg("enrich") === undefined || arg("limit") !== undefined) {
    const s = await importWikidata(db, { limit: arg("limit") ? Number(arg("limit")) : Infinity, log: console.log });
    console.log("import:", s);
  }
  if (arg("enrich") !== undefined) console.log("enrich:", enrichFromWikidata(db));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
