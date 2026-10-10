/**
 * npm run venues:osm                                    place the venues of our events that Wikidata did not, from OpenStreetMap (address, category, coordinates)
 * npm run venues:osm -- --limit 200
 * npm run venues:osm -- --name "Wembley Stadium" --city London --country "United Kingdom"     dry run, writes nothing
 * One request a second (OpenStreetMap's rule), so 1,000 venues take about 20 minutes; every answer is stored and a venue is never asked twice. Needs WIKIMEDIA_CONTACT (sent as the
 * contact in the User-Agent). Data © OpenStreetMap contributors (ODbL); the credit is shown wherever it is used.
 */
import { cleanContact } from "../lib/media/wikimedia";
import { getDb } from "../lib/db";
import { findPlace, resolvePlaces } from "../lib/importers/osm-venues";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const contact = cleanContact(process.env.WIKIMEDIA_CONTACT);
  const name = arg("name");
  if (name) { console.log(JSON.stringify(await findPlace({ name, city: arg("city") ?? "", country: arg("country") ?? "" }, { contact: contact || "dry-run@invalid.example" }), null, 2)); return; }
  const s = await resolvePlaces(await getDb(), { limit: Number(arg("limit") ?? 100), contact, log: console.log });
  console.log(`\nchecked ${s.checked} · placed ${s.found} · no match ${s.noMatch} · ambiguous ${s.ambiguous} · errors ${s.errors}`);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
