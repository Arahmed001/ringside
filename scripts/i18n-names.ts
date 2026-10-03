/**
 * Proper names in Arabic (see docs/i18n.md, "Names").
 *   npm run i18n:names -- export [file]       write the English names that have no Arabic yet as { "English": "" }
 *   npm run i18n:names -- import file [source] [--reviewed]   store { "English": "Arabic" } (source defaults to "claude-session")
 *   npm run i18n:names -- auto                transliterate every missing name with Claude (needs ANTHROPIC_API_KEY)
 *   npm run i18n:names -- review              list machine-written names a person has not reviewed yet
 */
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ask, parseJson } from "../lib/i18n/translate";

const DB = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db");
const db = new DatabaseSync(DB);
db.exec("CREATE TABLE IF NOT EXISTS name_translations (en TEXT NOT NULL, locale TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'claude', reviewed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (en, locale))");

/** Every distinct proper name the site can show, with what kind of thing it is (the kind steers the translation). */
function collect(): Map<string, string> {
  const out = new Map<string, string>();
  const add = (s: unknown, kind: string) => { if (typeof s === "string" && s.trim() && !out.has(s)) out.set(s, kind); };
  const col = (sql: string, kind: string) => { for (const r of db.prepare(sql).all() as Record<string, unknown>[]) add(Object.values(r)[0], kind); };
  col("SELECT name FROM boxers", "person name");
  col("SELECT name FROM people", "person name");
  col("SELECT nickname FROM boxers WHERE nickname IS NOT NULL", "boxer nickname (translate the meaning)");
  for (const r of db.prepare("SELECT aliases FROM boxers WHERE aliases IS NOT NULL").all() as { aliases: string }[]) for (const a of JSON.parse(r.aliases) as string[]) add(a, "person name");
  col("SELECT name FROM orgs", "boxing organisation, gym or promotion name");
  col("SELECT city FROM orgs WHERE city IS NOT NULL", "city");
  col("SELECT name FROM events", "boxing event name");
  col("SELECT venue FROM events", "venue or arena name");
  col("SELECT city FROM events", "city");
  col("SELECT birth_place FROM boxers WHERE birth_place IS NOT NULL", "place of birth, 'city, country'");
  col("SELECT residence FROM boxers WHERE residence IS NOT NULL", "place of residence, 'city, country'");
  col("SELECT DISTINCT title FROM bouts WHERE title IS NOT NULL", "championship title name");
  col("SELECT DISTINCT broadcaster FROM events WHERE broadcaster IS NOT NULL", "TV broadcaster or streaming service");
  col("SELECT DISTINCT broadcaster FROM event_broadcasts", "TV broadcaster or streaming service");
  col("SELECT DISTINCT region FROM event_broadcasts WHERE region != '' AND region NOT IN (SELECT country FROM events)", "broadcast region or territory");
  return out;
}
const have = () => new Set((db.prepare("SELECT en FROM name_translations WHERE locale = 'ar'").all() as { en: string }[]).map((r) => r.en));
const missing = () => { const h = have(); return [...collect()].filter(([en]) => !h.has(en)); };

const put = db.prepare("INSERT INTO name_translations (en, locale, text, source, reviewed) VALUES (?, 'ar', ?, ?, ?) ON CONFLICT(en, locale) DO UPDATE SET text = excluded.text, source = excluded.source, reviewed = excluded.reviewed");

const SYSTEM = `You write the Arabic forms of proper names for a Saudi/Gulf boxing statistics site.
- Person names: transliterate into Arabic script the way Arabic sports media write them (e.g. "Marcus Brightwell" -> "ماركوس برايتويل"). Keep a middle initial as the Arabic letter that matches its sound, followed by nothing else.
- Nicknames: translate the meaning into short punchy Arabic (e.g. "The Hammer" -> "المطرقة"); if it is a name, transliterate.
- Cities, countries inside "city, country" strings, and well-known venues: use the standard Arabic name where one exists (Las Vegas -> لاس فيغاس, Riyadh -> الرياض); otherwise transliterate.
- Organisations, gyms, promotions, events, broadcasters, titles: translate descriptive words, transliterate invented brand words; keep acronyms (WBA, WBC, IBF, WBO) in Latin letters.
- Use Western digits (0-9). Return ONLY a JSON object mapping each English string to its Arabic string, no commentary.`;

async function main() {
  const [cmd, a, b] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
  if (cmd === "export") {
    const m = missing();
    const file = a ?? "names-missing.json";
    // the value is a hint about what the name is; a translator replaces it with the Arabic
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(m.map(([en, kind]) => [en, `(${kind})`])), null, 1));
    console.log(`${m.length} names without Arabic written to ${file}`);
    const kinds = new Map<string, number>(); for (const [, k] of m) kinds.set(k, (kinds.get(k) ?? 0) + 1);
    console.log([...kinds].map(([k, n]) => `${n} ${k}`).join("; "));
  } else if (cmd === "import") {
    const data = JSON.parse(fs.readFileSync(a, "utf8")) as Record<string, string>;
    const reviewed = process.argv.includes("--reviewed") ? 1 : 0;
    let n = 0;
    db.exec("BEGIN");
    let skipped = 0;
    for (const [en, ar] of Object.entries(data)) {
      if (ar && /[\u0600-\u06FF]/.test(ar)) { put.run(en, ar.trim(), b ?? "claude-session", reviewed); n++; } else skipped++; // no Arabic letters: an untouched hint, not a translation
    }
    db.exec("COMMIT");
    console.log(`stored ${n} Arabic names (${reviewed ? "reviewed" : "unreviewed"}), skipped ${skipped} without Arabic letters`);
  } else if (cmd === "auto") {
    const m = missing();
    console.log(`${m.length} names to write`);
    for (let i = 0; i < m.length; i += 60) {
      const chunk = m.slice(i, i + 60);
      const prompt = JSON.stringify(Object.fromEntries(chunk.map(([en, kind]) => [en, kind])), null, 1);
      try {
        const got = parseJson<Record<string, string>>(await ask(SYSTEM + "\nThe input maps each English string to what kind of thing it is.", prompt, 6000));
        db.exec("BEGIN");
        let n = 0; for (const [en] of chunk) if (got[en]?.trim()) { put.run(en, got[en].trim(), "claude", 0); n++; }
        db.exec("COMMIT");
        console.log(`${Math.min(i + 60, m.length)}/${m.length}: ${n} stored`);
      } catch (e) { console.error(`chunk at ${i}: ${(e as Error).message}`); }
    }
  } else if (cmd === "review") {
    const rows = db.prepare("SELECT en, text, source FROM name_translations WHERE locale = 'ar' AND reviewed = 0 ORDER BY en").all() as { en: string; text: string; source: string }[];
    console.log(`${rows.length} unreviewed`);
    for (const r of rows.slice(0, 40)) console.log(`  ${r.en}  ->  ${r.text}  (${r.source})`);
  } else { console.error("usage: export [file] | import file [source] [--reviewed] | auto | review"); process.exit(2); }
}
main().catch((e) => { console.error(e); process.exit(1); });
