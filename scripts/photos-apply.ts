/**
 * npm run photos:apply -- [--database FILE]      put every recorded, licensed picture onto its fighter's page
 *
 * The record (the picture's address, its licence or the rights-holder's permission, the credit and the source) lives in the accounts database and is made at /review/photos, which also applies
 * it at once. Run this after a reload of the sports database (a reload starts the fighters over) and it puts them all back. A photo that came with the supplier's own feed is never replaced.
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

async function main() {
  const i = process.argv.indexOf("--database");
  const file = path.resolve(i >= 0 ? process.argv[i + 1] : process.env.DATABASE_PATH ?? path.join(os.homedir(), "ringside-real", "real.db"));
  if (!fs.existsSync(file)) { console.error(`${file} does not exist. Nothing was changed.`); process.exit(1); }
  process.env.DATABASE_PATH = file;
  const { accountsDb } = await import("../lib/accounts/store");
  const { applyPhotos, listPhotos } = await import("../lib/photos/store");
  const images = listPhotos(accountsDb());
  const db = new DatabaseSync(file);
  try {
    const r = applyPhotos(images, db);
    console.log(`photos:apply  ${file}\n  ${images.length} recorded: ${r.applied} put on a fighter's page, ${r.kept.length} left (the fighter already has a photo that came with the feed${r.kept.length ? `: ${r.kept.join(", ")}` : ""}), ${r.unknown.length} for a fighter not in this database${r.unknown.length ? ` (${r.unknown.join(", ")})` : ""}.`);
  } finally { db.close(); }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
