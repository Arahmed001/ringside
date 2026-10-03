/**
 * npm run media:resolve                       resolve headshots for fighters that lack one
 * npm run media:resolve -- --limit 200
 * npm run media:resolve -- --entities          instead: logos, belts and venue photos (--kind belt,org_logo,venue to pick; --limit caps each)
 * npm run media:resolve -- --name "Some Boxer" --year 1990    dry-run lookup, writes nothing
 */
import { getDb } from "../lib/db";
import { resolveMissingMedia } from "../lib/media/resolve";
import { findHeadshot } from "../lib/media/wikimedia";
import { resolveEntityMedia, type EntityKind } from "../lib/media/entities";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const name = arg("name");
  if (name) {
    const out = await findHeadshot({ name, birthYear: Number(arg("year")) });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const db = await getDb();
  if (process.argv.includes("--entities")) {
    const kinds = (arg("kind") ?? "belt,org_logo,venue").split(",").map((k) => k.trim()) as EntityKind[];
    const bad = kinds.filter((k) => !["belt", "org_logo", "venue"].includes(k));
    if (bad.length) throw new Error(`--kind takes belt, org_logo or venue, not ${bad.join(", ")}.`);
    const e = await resolveEntityMedia(db, { limit: Number(arg("limit") ?? 50), kinds, log: console.log });
    console.log(`\nchecked ${e.checked} · matched ${e.matched} · no match ${e.noMatch} · errors ${e.errors}`);
    return;
  }
  const s = await resolveMissingMedia(db, { limit: Number(arg("limit") ?? 50), log: console.log });
  console.log(`\nchecked ${s.checked} · matched ${s.matched} · no match ${s.noMatch} · errors ${s.errors}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
