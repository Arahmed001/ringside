/**
 * npm run news:refresh -- [--dry-run] [--database FILE]      read the boxing outlets' public feeds and keep their headlines (title, short excerpt, date, link: no bodies, no images)
 *
 * Needs NEWS_CONTACT (an email address or web page; it goes in the User-Agent so an outlet can reach whoever runs this). Feeds of outlets that limit their feeds to
 * non-commercial sites are read only with NEWS_NONCOMMERCIAL=1, which is your statement that the site earns nothing. Safe to run every hour: it asks only for what changed.
 * Headlines older than 120 days are dropped. `--no-archive` skips looking up Wayback Machine copies. `--dry-run` lists the feeds it would read and reads none.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { refreshNews } from "../lib/news/fetch";
import { findArchives } from "../lib/news/archive";
import { NEWS_SOURCES, sourcesFor } from "../lib/news/sources";

async function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const file = path.resolve(arg("--database") ?? process.env.DATABASE_PATH ?? path.join(os.homedir(), "ringside-real", "real.db"));
  const use = sourcesFor();
  console.log(`news:refresh  database: ${file}\n  feeds read (${use.length} of ${NEWS_SOURCES.length}):`);
  for (const s of NEWS_SOURCES) console.log(`    ${use.includes(s) ? "yes" : "no "}  ${s.name.padEnd(18)} ${s.use === "open" ? "open" : "non-commercial sites only (set NEWS_NONCOMMERCIAL=1 if this site earns nothing)"}`);
  if (process.argv.includes("--dry-run")) { console.log("\n--dry-run: nothing was read."); return; }
  const contact = process.env.NEWS_CONTACT ?? "";
  if (!contact) { console.error("\nNEWS_CONTACT is not set (an email address or web page for the User-Agent). Nothing was read."); process.exit(1); }
  if (!fs.existsSync(file)) { console.error(`\n${file} does not exist. Nothing was read.`); process.exit(1); }
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS news_items (id INTEGER PRIMARY KEY, source TEXT NOT NULL, guid TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, published TEXT, snippet TEXT, fetched_at TEXT NOT NULL, archive_url TEXT, archive_checked_at TEXT, UNIQUE (source, guid)); CREATE INDEX IF NOT EXISTS idx_news_published ON news_items (published DESC); CREATE TABLE IF NOT EXISTS news_feeds (source TEXT PRIMARY KEY, etag TEXT, last_modified TEXT, checked_at TEXT, status TEXT, items INTEGER);");
    console.log("");
    const out = await refreshNews(db, { contact, log: (l) => console.log(`  ${l}`) });
    const arc = process.argv.includes("--no-archive") ? null : await findArchives(db, { contact });
    if (arc) console.log(`  Wayback copies: ${arc.found} found of ${arc.checked} asked about`);
    const total = (db.prepare("SELECT COUNT(*) c FROM news_items").get() as { c: number }).c;
    console.log(`\n${out.reduce((s, o) => s + o.added, 0)} new headlines; ${total} kept. ${out.filter((o) => !o.ok).length ? `${out.filter((o) => !o.ok).length} feed(s) did not answer (see above); the others were read.` : ""}`);
  } finally { db.close(); }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
