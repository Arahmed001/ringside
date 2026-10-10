/**
 * npm run broadcasters:link [-- --database FILE]    make an organisation page for each broadcaster named on the cards (offline, repeatable)
 */
import os from "node:os";
import path from "node:path";
import { linkBroadcasters } from "../lib/broadcaster-link";

async function main() {
  const i = process.argv.indexOf("--database");
  if (i > -1) process.env.DATABASE_PATH = path.resolve(process.argv[i + 1].replace(/^~/, os.homedir())); // set before lib/db is loaded: it reads the path once, and adds the columns newer than the file
  const db = await (await import("../lib/db")).getDb();
  const r = linkBroadcasters(db);
  console.log(`${r.broadcasters} broadcasters, ${r.events} cards linked, ${r.unnamed} cards whose broadcaster field names nobody ("Pay Per View", "N/A"...).`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
