/**
 * npm run media:resolve                       resolve headshots for fighters that lack one
 * npm run media:resolve -- --limit 200
 * npm run media:resolve -- --name "Some Boxer" --year 1990    dry-run lookup, writes nothing
 */
import { getDb } from "../lib/db";
import { resolveMissingMedia } from "../lib/media/resolve";
import { findHeadshot } from "../lib/media/wikimedia";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const name = arg("name");
  if (name) {
    const out = await findHeadshot({ name, birthYear: Number(arg("year")) });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const db = await getDb();
  const s = await resolveMissingMedia(db, { limit: Number(arg("limit") ?? 50), log: console.log });
  console.log(`\nchecked ${s.checked} · matched ${s.matched} · no match ${s.noMatch} · errors ${s.errors}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
