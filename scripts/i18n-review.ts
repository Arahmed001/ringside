/**
 * Native-speaker review of the Arabic (see docs/arabic-review.md).
 *   npm run i18n:review -- qa [--json]      mechanical checks over every string, grouped by what they found
 *   npm run i18n:review -- status           how much is reviewed, by group, and the names
 *   npm run i18n:review -- export [file]    build the offline review sheet (default review/arabic-review.html) to send to a reviewer
 *   npm run i18n:review -- import file.json apply the file a reviewer downloaded from the sheet (validated; nothing is applied blindly)
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { extractKeys } from "../lib/i18n/extract";
import { EMPTY_META, GROUP_ORDER, applyReview, glossaryReport, groupOf, hashOf, qaEntry, statusOf, summarise, type ReviewFile, type ReviewMeta } from "../lib/i18n/review";
import { buildSheet } from "../lib/i18n/review-sheet";
import type { Dict } from "../lib/i18n/t";

const DIR = process.env.I18N_DIR ?? path.join(process.cwd(), "i18n"); // the env override is for tests, which run the real commands on a copy
const OUT = process.env.REVIEW_OUT ?? "review"; // where sheets and answers go (also overridden by tests)
const AR = path.join(DIR, "ar.json"), META = path.join(DIR, "ar.review.json"), GLOSSARY = path.join(DIR, "glossary.json");
const loadDict = (): Dict => JSON.parse(fs.readFileSync(AR, "utf8"));
const saveDict = (d: Dict) => fs.writeFileSync(AR, JSON.stringify(Object.fromEntries(Object.keys(d).sort().map((k) => [k, d[k]])), null, 1) + "\n");
export const loadMeta = (): ReviewMeta => (fs.existsSync(META) ? { ...EMPTY_META(), ...JSON.parse(fs.readFileSync(META, "utf8")) } : EMPTY_META());
const saveMeta = (m: ReviewMeta) => fs.writeFileSync(META, JSON.stringify({ reviews: m.reviews, keys: Object.fromEntries(Object.keys(m.keys).sort().map((k) => [k, m.keys[k]])), flagged: Object.fromEntries(Object.keys(m.flagged).sort().map((k) => [k, m.flagged[k]])) }, null, 1) + "\n");
const loadGlossary = (): Record<string, string> => JSON.parse(fs.readFileSync(GLOSSARY, "utf8"));

/** The decisions made for the reader that a native speaker should confirm or overrule. */
export const QUESTIONS = [
  { title: "Latin abbreviations", body: "Elo, KO, TKO, the division codes (FLY, BAN, LHW ...) and sanctioning bodies (WBC, WBA, IBF, WBO) are kept in Latin letters, as most Arabic boxing coverage does. Should any be Arabic (ك.ق., or a spelled-out form)? Division codes are the likeliest candidates." },
  { title: "Register", body: "The aim is clear modern standard Arabic in the voice of a Saudi sports desk. Is it too formal anywhere? Too colloquial? Does any sentence sound like a translation rather than something an Arabic writer would say?" },
  { title: "Gender", body: "Fighter names can be men or women. Where the English says he or she, the Arabic uses either wording that works for both (a noun, the name) or has two forms. Are the neutral phrasings natural, or would you rather always have two forms?" },
  { title: "Numbers and dates", body: "The site prints Western digits (0-9) and the Gregorian calendar, as Saudi and Gulf sports media do, and puts the number before a plural noun using the six plural forms. Is that what readers expect? Are the counted nouns (1, 2, 3-10, 11-99) right?" },
  { title: "Boxing terms", body: "See the Terminology tab. In particular: ساوثباو (يسرى) and ستاندرد (يمنى) for southpaw and orthodox, «أفضل ملاكم بغض النظر عن الوزن» for pound-for-pound, «تجاوز الوزن» for missed weight, «توقف فني» for TKO. Which would a boxing fan in the Gulf actually say?" },
  { title: "Names", body: "Fighter and trainer names are transliterated from Latin spellings (Spanish, Japanese, Ukrainian, Nigerian, Filipino and more). Is there a house convention you prefer (for example ج or غ for Spanish g, or how Japanese names are written)? Nicknames are translated by meaning, not transliterated: is that right?" },
  { title: "Sentences about the model", body: "Pages like the track record and trainer impact explain statistics (a 95% range, log-loss, calibration). Are the Arabic terms for these ones a reader would understand?" },
];

function dbHandle(): DatabaseSync | null {
  const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db");
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE IF NOT EXISTS name_translations (en TEXT NOT NULL, locale TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'claude', reviewed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (en, locale))");
  return db;
}

async function main() {
  const [cmd, arg, flag] = process.argv.slice(2);
  const dict = loadDict(), meta = loadMeta(), glossary = loadGlossary();
  const { found } = extractKeys();
  const keys = [...found.keys()].sort();

  if (cmd === "qa") {
    const byCode: Record<string, { key: string; note: string; severity: string }[]> = {};
    let withChecks = 0, withNotes = 0;
    for (const k of keys) {
      const fl = qaEntry(k, dict[k], { plural: found.get(k)!.plural !== undefined, glossary });
      if (fl.some((f) => f.severity === "check")) withChecks++;
      if (fl.some((f) => f.severity === "note")) withNotes++;
      for (const f of fl) (byCode[f.code] ??= []).push({ key: k, note: f.note, severity: f.severity });
    }
    console.log(`${keys.length} strings: ${withChecks} with a check to look at, ${withNotes} with a note`);
    for (const [code, list] of Object.entries(byCode)) { console.log(`\n${code} (${list[0].severity}): ${list.length}`); for (const x of list.slice(0, 5)) console.log(`   ${JSON.stringify(x.key.slice(0, 70))}: ${x.note}`); }
    if (flag === "--json" || arg === "--json") { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, "qa.json"), JSON.stringify(byCode, null, 1)); console.log(`\nwrote ${OUT}/qa.json`); }
    process.exit(Object.entries(byCode).some(([, l]) => l.some((x) => x.severity === "check" && /placeholders|plural/.test(x.note))) ? 1 : 0);
  } else if (cmd === "status") {
    const s = summarise(keys, dict, meta);
    console.log(`Arabic strings: ${s.total}; reviewed by a person ${s.reviewed}, changed since review ${s.changed}, machine-written ${s.machine}; flagged for discussion ${s.flagged}`);
    const by: Record<string, string[]> = {};
    for (const k of keys) (by[groupOf(found.get(k)!.files)] ??= []).push(k);
    for (const g of GROUP_ORDER) if (by[g]) { const x = summarise(by[g], dict, meta); console.log(`  ${g.padEnd(38)} ${String(x.total).padStart(4)} strings, ${x.reviewed} reviewed`); }
    for (const r of meta.reviews) console.log(`  review by ${r.by} on ${r.at}: ${r.approved} approved, ${r.edited} edited, ${r.flagged} flagged`);
    const db = dbHandle();
    if (db) { const n = db.prepare("SELECT COUNT(*) c, SUM(reviewed) r FROM name_translations WHERE locale = 'ar'").get() as { c: number; r: number | null }; console.log(`Names: ${n.c}, reviewed by a person ${n.r ?? 0}`); }
  } else if (cmd === "export") {
    const out = arg ?? path.join(OUT, "arabic-review.html");
    const db = dbHandle();
    const names = db ? (db.prepare("SELECT en, text, source, reviewed FROM name_translations WHERE locale = 'ar' ORDER BY en").all() as { en: string; text: string; source: string; reviewed: number }[]).map((r) => ({ en: r.en, ar: r.text, source: r.source, reviewed: !!r.reviewed })) : [];
    const order = (k: string) => GROUP_ORDER.indexOf(groupOf(found.get(k)!.files));
    const entries = [...keys].sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map((k) => {
      const f = found.get(k)!;
      return { key: k, group: groupOf(f.files), files: f.files.slice(0, 3), plural: f.plural ?? null, ar: dict[k], status: statusOf(k, dict, meta), flags: qaEntry(k, dict[k], { plural: f.plural !== undefined, glossary }) };
    });
    const build = hashOf(dict as never);
    const html = buildSheet({ build, generatedAt: new Date().toISOString(), entries, groups: GROUP_ORDER, glossary: glossaryReport(dict, glossary).map((r) => ({ term: r.term, ar: r.arabic, strings: r.strings, missing: r.missing })), names, questions: QUESTIONS });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
    console.log(`wrote ${out}: ${entries.length} strings, ${names.length} names, ${(html.length / 1024).toFixed(0)} KB, build ${build}. Open it in a browser (no server needed) or send it to the reviewer.`);
  } else if (cmd === "import") {
    if (!arg) { console.error("usage: i18n-review import <file.json>"); process.exit(2); }
    const file = JSON.parse(fs.readFileSync(arg, "utf8")) as ReviewFile;
    const r = applyReview(file, dict, meta, found);
    saveDict(r.dict); saveMeta(r.meta);
    console.log(`${file.reviewer}: ${r.approved} approved as they were, ${r.edited} edited, ${r.flagged} flagged for discussion, ${r.rejected.length} rejected`);
    for (const x of r.rejected.slice(0, 20)) console.log(`  rejected ${JSON.stringify(x.key.slice(0, 60))}: ${x.reason}`);
    if (file.glossary?.length) {
      const g = loadGlossary(); const touched: string[] = [];
      for (const x of file.glossary) { if (g[x.term] !== undefined && g[x.term] !== x.ar) { touched.push(`${x.term}: ${g[x.term]} -> ${x.ar}`); g[x.term] = x.ar; } }
      if (touched.length) { fs.writeFileSync(GLOSSARY, JSON.stringify(g, null, 2) + "\n"); console.log(`  glossary updated (${touched.length}); strings still using the old wording need a second look:`); for (const t of touched) console.log(`    ${t}`); }
    }
    if (file.names?.length) {
      const db = dbHandle();
      if (!db) console.log("  names: no database here, so the reviewed names were not stored");
      else {
        let n = 0;
        for (const x of file.names) {
          if (x.status === "flagged") continue;
          if (x.status === "edited" && x.ar.trim()) db.prepare("INSERT INTO name_translations (en, locale, text, source, reviewed) VALUES (?, 'ar', ?, 'editor', 1) ON CONFLICT(en, locale) DO UPDATE SET text = excluded.text, source = 'editor', reviewed = 1").run(x.en, x.ar.trim());
          else db.prepare("UPDATE name_translations SET reviewed = 1 WHERE en = ? AND locale = 'ar'").run(x.en);
          n++;
        }
        console.log(`  names: ${n} stored as reviewed`);
      }
    }
    if ((file as unknown as { answers?: Record<string, string> }).answers && Object.keys((file as unknown as { answers: Record<string, string> }).answers).length) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, `answers-${file.at.slice(0, 10)}-${file.reviewer.replace(/\W+/g, "-")}.json`), JSON.stringify((file as unknown as { answers: unknown }).answers, null, 1));
      console.log(`  the reviewer's answers to the questions were saved under ${OUT}/`);
    }
  } else {
    console.error("usage: tsx scripts/i18n-review.ts qa | status | export [file] | import <file>");
    process.exit(2);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
