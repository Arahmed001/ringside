/**
 * npm run data:check                         validate the configured provider (demo by default); writes nothing
 * npm run data:check -- --file sample.json   validate a vendor sample converted to the FeedData JSON shape (see lib/providers/file.ts)
 * Exits 1 if any row would be dropped as an error, so it can gate a deploy or a vendor evaluation.
 */
import { getProvider } from "../lib/ingest";
import { fileProvider } from "../lib/providers/file";
import { loadFeed } from "../lib/feed";
import { countBySeverity, groupIssues, sanitizeFeed } from "../lib/validate";
import { todayIso } from "../lib/clock";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const file = arg("file");
  const provider = file ? fileProvider(file) : getProvider();
  const raw = await loadFeed(provider);
  const { feed, issues, dropped } = sanitizeFeed(raw, { today: todayIso() });
  console.log(`feed: ${file ?? provider.name}\n`);
  console.log("rows in -> kept");
  for (const k of Object.keys(raw) as (keyof typeof raw)[]) console.log(`  ${k.padEnd(11)} ${String(raw[k].length).padStart(7)} -> ${String(feed[k].length).padStart(7)}`);
  const sev = countBySeverity(issues);
  console.log(`\n${sev.errors} error(s), ${sev.warnings} warning(s), ${sev.infos} note(s)${Object.keys(dropped).length ? `; dropped ${JSON.stringify(dropped)}` : ""}\n`);
  for (const g of groupIssues(issues, 3)) {
    console.log(`${g.severity.toUpperCase().padEnd(7)} ${g.code}  x${g.count}`);
    for (const e of g.examples) console.log(`          ${e.entity} ${e.ref}: ${e.message}`);
  }
  if (!issues.length) console.log("No issues found.");
  process.exitCode = sev.errors ? 1 : 0;
}
main().catch((e) => { console.error(e.message); process.exit(1); });
