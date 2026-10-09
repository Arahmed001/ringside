/**
 * Arabic for the words in fighters' names (see docs/arabic-name-words.md).
 *   npm run i18n:words -- todo [N]                 list the N most useful words that have no reviewed Arabic yet (default 1000), with how many fighters each completes
 *   npm run i18n:words -- suggest file.json        store { "Word": "Arabic" } as machine suggestions (never shown on a page; a reviewed word is never overwritten)
 *   npm run i18n:words -- export [file] [N]        write the offline review sheet (default review/name-words-review.html) for the N top words
 *   npm run i18n:words -- import file.json         read a reviewer's downloaded file: approved and edited words become reviewed
 *   npm run i18n:words -- status                   counts: suggested, reviewed, and how many fighters have a name on a page
 * Set DATABASE_PATH to the database to count against (default data/ringside.db).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { candidates, composeName, readWordsFile, wordsFilePath, writeWordsFile, wordsOf, type WordsFile } from "../lib/i18n/name-words";
import { sheet } from "../lib/i18n/name-words-sheet";
import { readNamesFile } from "../lib/i18n/names-file";

const DB = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db");
const HAS_ARABIC = /[؀-ۿ]/;

function wholeNames(db: DatabaseSync): Record<string, string> {
  const have: Record<string, string> = {};
  for (const [en, e] of Object.entries(readNamesFile())) have[en] = e.ar;
  try { for (const r of db.prepare("SELECT en, text FROM name_translations WHERE locale = 'ar'").all() as { en: string; text: string }[]) have[r.en] = r.text; } catch { /* no table yet */ }
  return have;
}

function main() {
  const [cmd, a, b] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
  const words = readWordsFile();
  if (cmd === "suggest") {
    if (!a) throw new Error("usage: suggest file.json");
    const incoming = JSON.parse(fs.readFileSync(a, "utf8")) as Record<string, string>;
    let added = 0, kept = 0, skipped = 0;
    for (const [w, ar] of Object.entries(incoming)) {
      if (typeof ar !== "string" || !HAS_ARABIC.test(ar) || /[A-Za-z]/.test(ar)) { skipped++; continue; }
      if (words[w]?.reviewed) { kept++; continue; }
      words[w] = { ar: ar.trim(), source: "claude-session", reviewed: false }; added++;
    }
    writeWordsFile(words);
    console.log(`${added} suggestions stored, ${kept} reviewed words left alone, ${skipped} skipped (empty, or Latin letters left in).`);
    return;
  }
  if (cmd === "import") {
    if (!a) throw new Error("usage: import file.json");
    const inc = (JSON.parse(fs.readFileSync(a, "utf8")) as { words?: Record<string, { ar: string; edited?: boolean }> }).words ?? {};
    let ok = 0, edited = 0, bad = 0;
    for (const [w, e] of Object.entries(inc)) {
      const ar = typeof e?.ar === "string" ? e.ar.trim() : "";
      if (!ar || !HAS_ARABIC.test(ar) || /[A-Za-z]/.test(ar)) { bad++; continue; }
      const was = words[w];
      const changed = !was || was.ar !== ar;
      words[w] = { ar, source: changed ? "reviewer" : was.source, reviewed: true };
      if (changed) edited++; else ok++;
    }
    writeWordsFile(words);
    console.log(`${ok} approved, ${edited} edited, ${bad} refused (empty or Latin letters left in). Commit i18n/name-words.ar.json.`);
    return;
  }
  const db = new DatabaseSync(DB, { readOnly: true });
  const have = wholeNames(db);
  if (cmd === "todo") {
    const rows = candidates(db, have, words, Number(a) || 1000);
    for (const r of rows.slice(0, 40)) console.log(`${String(r.fighters).padStart(5)}  ${r.word}${r.suggestion ? "  → " + r.suggestion : ""}`);
    fs.mkdirSync("review", { recursive: true });
    fs.writeFileSync("review/name-words-todo.json", JSON.stringify(Object.fromEntries(rows.map((r) => [r.word, r.suggestion ?? ""])), null, 1));
    console.log(`\n${rows.length} words written to review/name-words-todo.json; reviewing all would complete ${rows.at(-1)?.fully ?? 0} fighters.`);
    return;
  }
  if (cmd === "export") {
    const file = a ?? "review/name-words-review.html";
    const rows = candidates(db, have, words, Number(b) || 1000).filter((r) => r.suggestion);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, sheet(rows));
    console.log(`${rows.length} words with a suggestion written to ${file}.`);
    return;
  }
  if (cmd === "status") {
    const all = Object.values(words);
    const fighters = db.prepare("SELECT name FROM boxers").all() as { name: string }[];
    const whole = fighters.filter((f) => f.name in have).length;
    const composed = fighters.filter((f) => !(f.name in have) && composeName(f.name, words)).length;
    console.log(`${wordsFilePath()}: ${all.length} words, ${all.filter((w) => w.reviewed).length} reviewed, ${all.filter((w) => !w.reviewed).length} suggested only.\nFighters with an Arabic name on a page: ${whole} whole + ${composed} composed = ${whole + composed} of ${fighters.length} (${wordsOf("").length === 0 ? "" : ""}${(((whole + composed) / fighters.length) * 100).toFixed(1)}%).`);
    return;
  }
  console.log(fs.readFileSync(import.meta.filename, "utf8").split("*/")[0]);
}
main();
