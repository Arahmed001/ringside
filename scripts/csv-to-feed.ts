/**
 * npm run data:from-csv -- --dir my-data --out feed.json
 *   my-data/fighters.csv, my-data/events.csv and my-data/fights.csv (saved from a spreadsheet as "CSV") become feed.json.
 * Nothing is loaded into the site: check the result with `npm run data:check -- --file feed.json` first.
 * Exits 1 and writes nothing if any row cannot be read; every complaint names the file and the row.
 */
import fs from "node:fs";
import path from "node:path";
import { convertCsv } from "../lib/csv-feed";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };

function main() {
  const dir = arg("dir"), out = arg("out") ?? "feed.json";
  if (!dir) { console.error("Say which folder holds the three files:  npm run data:from-csv -- --dir my-data --out feed.json"); process.exit(1); }
  const read = (n: string) => {
    const f = path.join(dir, `${n}.csv`);
    if (!fs.existsSync(f)) { console.error(`I cannot find ${f}. The folder needs fighters.csv, events.csv and fights.csv.`); process.exit(1); }
    return fs.readFileSync(f, "utf8");
  };
  const { feed, problems } = convertCsv({ fighters: read("fighters"), events: read("events"), fights: read("fights") });
  if (problems.length) {
    console.error(`${problems.length} thing(s) to fix before this can be used:\n`);
    for (const p of problems.slice(0, 50)) console.error(`  ${p.file}.csv, row ${p.row}: ${p.message}`);
    if (problems.length > 50) console.error(`  ... and ${problems.length - 50} more`);
    console.error("\nNothing was written. Fix the rows above in the spreadsheet, save as CSV again and re-run.");
    process.exit(1);
  }
  fs.writeFileSync(out, JSON.stringify(feed, null, 1));
  console.log(`Wrote ${out}: ${feed.boxers.length} fighters, ${feed.events.length} events, ${feed.bouts.length} fights.`);
  console.log(`Next:  npm run data:check -- --file ${out}`);
}
main();
