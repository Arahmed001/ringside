/**
 * npm run first-look -- --database FILE [--out FILE.md]      a counts-only description of a loaded database: how big, how complete, what is empty
 *
 * Reads the database (it is only read) and writes Markdown with numbers and shares only: no fighter, card or venue is named, so it can be pasted into a chat or a
 * ticket without sharing the supplier's data. Meant for the first real load: what the pages will have to show, and which of them will have nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const file = arg("--database");
if (!file || !fs.existsSync(file)) { console.error("Usage: npm run first-look -- --database FILE [--out FILE.md]"); process.exit(2); }
const db = new DatabaseSync(path.resolve(file), { readOnly: true });
type Row = Record<string, string | number | null>;
const all = (sql: string): Row[] => db.prepare(sql).all() as Row[];
const one = (sql: string): number => Number(Object.values(all(sql)[0] ?? { n: 0 })[0] ?? 0);
const n = (x: number) => x.toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : "-");
const table = (head: string[], rows: (string | number)[][]) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const TODAY = process.env.RINGSIDE_NOW ?? new Date().toISOString().slice(0, 10);

const fighters = one("SELECT COUNT(*) FROM boxers");
const bouts = one("SELECT COUNT(*) FROM bouts");
const events = one("SELECT COUNT(*) FROM events");
const have = (col: string) => one(`SELECT COUNT(*) FROM boxers WHERE ${col} IS NOT NULL AND ${col} <> ''`);
const out: string[] = [];
out.push(`# First look at ${path.basename(file)}`, "", `Counts only: no name of a fighter, card or place. Read on ${TODAY}.`, "");
out.push("## Size", "", table(["", "count"], [["Fighters", n(fighters)], ["Fights", n(bouts)], ["Cards", n(events)], ["Organisations", n(one("SELECT COUNT(*) FROM orgs"))], ["Rating points (one per fight per fighter)", n(one("SELECT COUNT(*) FROM rating_history"))]]), "");

const women = one("SELECT COUNT(*) FROM boxers WHERE sex = 'female'");
out.push("## Fighters", "", `${n(women)} women (${pct(women, fighters)}), ${n(fighters - women)} men.`, "");
out.push(table(["What the supplier gave", "fighters", "share"], [
  ["birth year", have("birth_year")], ["stance", have("stance")], ["height", have("height_cm")], ["reach", have("reach_cm")], ["weight class", have("weight_class")], ["country", have("country")], ["turned-pro year", have("turned_pro")],
  ["a photo", have("photo_url")], ["a nickname", have("nickname")], ["a Wikidata link", have("wikidata_id")], ["a BoxRec number", have("boxrec_id")],
].map(([k, v]) => [k, n(v as number), pct(v as number, fighters)])), "");
const heldCol = "(SELECT COUNT(*) FROM bouts b WHERE b.red_id = x.id OR b.blue_id = x.id)";
const depth = all(`SELECT CASE WHEN held = 0 THEN '0' WHEN held = 1 THEN '1' WHEN held <= 5 THEN '2-5' WHEN held <= 15 THEN '6-15' WHEN held <= 30 THEN '16-30' ELSE '31+' END AS k, COUNT(*) AS c FROM (SELECT ${heldCol} AS held FROM boxers x) GROUP BY k`);
const order = ["0", "1", "2-5", "6-15", "16-30", "31+"];
out.push("Fights held per fighter:", "", table(["fights held", "fighters", "share"], order.map((k) => { const c = Number(depth.find((r) => r.k === k)?.c ?? 0); return [k, n(c), pct(c, fighters)]; })), "");
const vendorTotal = "(COALESCE(vendor_wins,0) + COALESCE(vendor_losses,0) + COALESCE(vendor_draws,0))";
const withTotals = one(`SELECT COUNT(*) FROM boxers WHERE vendor_wins IS NOT NULL`);
const complete = one(`SELECT COUNT(*) FROM (SELECT ${vendorTotal} AS total, ${heldCol} AS held FROM boxers x WHERE vendor_wins IS NOT NULL) WHERE held >= total AND total > 0`);
const partial = one(`SELECT COUNT(*) FROM (SELECT ${vendorTotal} AS total, ${heldCol} AS held FROM boxers x WHERE vendor_wins IS NOT NULL) WHERE held < total`);
out.push(`Career totals from the supplier: ${n(withTotals)} fighters have one. For ${n(complete)} (${pct(complete, withTotals)}) every fight in the total is held; for ${n(partial)} (${pct(partial, withTotals)}) some are missing (the page then says the record is the supplier's total and how many fights are held). ${n(one("SELECT COUNT(*) FROM boxers WHERE record_disputed = 1"))} records are marked disputed (the held fights and the supplier's total disagree).`, "");
out.push("Top countries:", "", table(["country", "fighters", "share"], all("SELECT country AS k, COUNT(*) AS c FROM boxers WHERE country <> '' GROUP BY country ORDER BY c DESC LIMIT 12").map((r) => [String(r.k), n(Number(r.c)), pct(Number(r.c), fighters)])), "");
out.push("Weight classes:", "", table(["weight class", "fighters"], all("SELECT COALESCE(NULLIF(weight_class,''),'(none)') AS k, COUNT(*) AS c FROM boxers GROUP BY k ORDER BY c DESC").map((r) => [String(r.k), n(Number(r.c))])), "");

const finished = one("SELECT COUNT(*) FROM bouts WHERE method IS NOT NULL AND method <> ''");
const cancelled = one("SELECT COUNT(*) FROM bouts WHERE status = 'cancelled'");
out.push("## Fights", "", table(["", "count", "share"], [
  ["with a result (method known)", finished, pct(finished, bouts)], ["cancelled", cancelled, pct(cancelled, bouts)],
  ["no method and not cancelled", bouts - finished - cancelled, pct(bouts - finished - cancelled, bouts)],
  ["with a winner named", one("SELECT COUNT(*) FROM bouts WHERE winner_id IS NOT NULL"), pct(one("SELECT COUNT(*) FROM bouts WHERE winner_id IS NOT NULL"), bouts)],
  ["with the scheduled rounds known", one("SELECT COUNT(*) FROM bouts WHERE rounds IS NOT NULL"), pct(one("SELECT COUNT(*) FROM bouts WHERE rounds IS NOT NULL"), bouts)],
  ["with the round it ended in", one("SELECT COUNT(*) FROM bouts WHERE end_round IS NOT NULL"), pct(one("SELECT COUNT(*) FROM bouts WHERE end_round IS NOT NULL"), bouts)],
  ["with the supplier's judges' scores", one("SELECT COUNT(*) FROM bouts WHERE vendor_scores IS NOT NULL AND vendor_scores <> ''"), pct(one("SELECT COUNT(*) FROM bouts WHERE vendor_scores IS NOT NULL AND vendor_scores <> ''"), bouts)],
  ["for a title", one("SELECT COUNT(*) FROM bouts WHERE title IS NOT NULL AND title <> ''"), pct(one("SELECT COUNT(*) FROM bouts WHERE title IS NOT NULL AND title <> ''"), bouts)],
].map(([k, v, s]) => [k as string, n(v as number), s as string])), "");
out.push("How fights ended:", "", table(["method", "fights", "share of results"], all("SELECT method AS k, COUNT(*) AS c FROM bouts WHERE method IS NOT NULL AND method <> '' GROUP BY method ORDER BY c DESC").map((r) => [String(r.k), n(Number(r.c)), pct(Number(r.c), finished)])), "");
const years = all("SELECT SUBSTR(e.date,1,3) || '0s' AS k, COUNT(*) AS c FROM bouts b JOIN events e ON e.id = b.event_id GROUP BY k ORDER BY k");
out.push("Fights by decade:", "", table(["decade", "fights"], years.map((r) => [String(r.k), n(Number(r.c))])), "");
const span = all("SELECT MIN(date) AS a, MAX(date) AS z FROM events")[0];
const upcoming = one(`SELECT COUNT(*) FROM events WHERE date > '${TODAY}' AND (status IS NULL OR status <> 'cancelled')`);
out.push("## Cards", "", `${n(events)} cards from ${span.a} to ${span.z}; ${n(upcoming)} still to come, ${n(one("SELECT COUNT(*) FROM events WHERE status = 'cancelled'"))} called off.`, "");
out.push(table(["what the supplier gave", "cards", "share"], [
  ["a venue", one("SELECT COUNT(*) FROM events WHERE venue IS NOT NULL AND venue <> ''")], ["a city", one("SELECT COUNT(*) FROM events WHERE city IS NOT NULL AND city <> ''")],
  ["a country", one("SELECT COUNT(*) FROM events WHERE country IS NOT NULL AND country <> '' AND country <> 'Unknown'")], ["a broadcaster", one("SELECT COUNT(*) FROM events WHERE broadcaster IS NOT NULL AND broadcaster <> ''")],
  ["a poster", one("SELECT COUNT(*) FROM events WHERE poster_url IS NOT NULL AND poster_url <> ''")], ["an attendance", one("SELECT COUNT(*) FROM events WHERE attendance IS NOT NULL")],
].map(([k, v]) => [k as string, n(v as number), pct(v as number, events)])), "");

out.push("## What is empty, and so which pages will have nothing to show", "", "Some of these are filled by other tools than the supplier's load (title reigns by the Wikipedia champions import, venues by the venue check, honours and photos by Wikidata); an empty table is only a gap if that tool has not run.", "");
const EMPTY: [string, string, string][] = [
  ["scorecards", "judge tables, scoring disputes, home-decision checks", "Judges and Scorecards pages"], ["officials", "referee and judge pages", "Officials pages"], ["corners", "trainer and manager pages, team impact", "People pages for trainers and managers"],
  ["punch_stats", "punch-stat charts on fight pages", "Fight pages"], ["weigh_ins", "weight-miss and fight-night-weight pages", "Weights pages"], ["purses", "money pages: purses, earners", "Money pages"],
  ["earnings", "career earnings", "Fighter pages and Money"], ["event_broadcasts", "viewership", "Money and card pages"], ["title_reigns", "reign tables on the Titles pages", "Titles pages"], ["honours", "hall-of-fame and Olympic marks", "Fighter pages"],
  ["team_stints", "who trains whom", "People and Gyms pages"], ["venues", "venue map and capacity", "Venues pages"], ["people", "trainer, manager, judge and referee pages", "People pages"],
];
const empties = EMPTY.filter(([t]) => one(`SELECT COUNT(*) FROM ${t}`) === 0);
out.push(empties.length ? table(["table", "feeds", "pages that say so instead"], empties.map(([t, f, p]) => [t, f, p])) : "Nothing the pages read is empty.", "");
const issues = all("SELECT severity, code, COUNT(*) AS c FROM ingest_issues GROUP BY severity, code ORDER BY c DESC");
out.push("## What the load itself noted", "", issues.length ? table(["severity", "code", "count"], issues.map((r) => [String(r.severity), String(r.code), n(Number(r.c))])) : "No issues recorded.", "");
const text = out.join("\n") + "\n";
const dest = arg("--out");
if (dest) { fs.writeFileSync(dest, text); console.log(`wrote ${dest}`); } else process.stdout.write(text);
