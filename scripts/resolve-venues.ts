/**
 * npm run venues:resolve                                   look up venues on our events that have not been checked yet
 * npm run venues:resolve -- --limit 200
 * npm run venues:resolve -- --name "Wembley Stadium" --city London --country "United Kingdom"    dry run, writes nothing
 * Needs WIKIMEDIA_CONTACT (Wikimedia asks automated clients to identify themselves).
 */
import { getDb } from "../lib/db";
import { findVenue, resolveVenues } from "../lib/importers/venues";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const name = arg("name");
  if (name) {
    console.log(JSON.stringify(await findVenue({ name, city: arg("city") ?? "", country: arg("country") ?? "" }), null, 2));
    return;
  }
  const s = await resolveVenues(await getDb(), { limit: Number(arg("limit") ?? 50), log: console.log });
  console.log(`\nchecked ${s.checked} · matched ${s.matched} · no match ${s.noMatch} · ambiguous ${s.ambiguous} · errors ${s.errors}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
