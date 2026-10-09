import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * Arabic spellings of the words that person names are made of (`i18n/name-words.ar.json`), so a fighter nobody has
 * written a whole Arabic name for can still be shown in Arabic. A name is composed word by word, and only from words a
 * person has reviewed: a machine's guess at a word is kept in the file for the reviewer to see, never shown on a page.
 * A whole-name entry (`i18n/names.ar.json`) always wins over a composed one.
 */
export interface WordEntry { ar: string; source: string; reviewed: boolean }
export type WordsFile = Record<string, WordEntry>;

export const wordsFilePath = () => path.join(process.env.I18N_DIR ?? path.join(process.cwd(), "i18n"), "name-words.ar.json");

const HAS_ARABIC = /[؀-ۿ]/;

export function readWordsFile(file = wordsFilePath()): WordsFile {
  if (!fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Partial<WordEntry>>;
  const out: WordsFile = {};
  for (const [w, e] of Object.entries(raw)) if (e && typeof e.ar === "string" && e.ar.trim() && HAS_ARABIC.test(e.ar)) out[w] = { ar: e.ar.trim(), source: typeof e.source === "string" && e.source ? e.source : "claude-session", reviewed: e.reviewed === true };
  return out;
}

/** Sorted, one word per line, so a diff shows exactly the words that changed. */
export function writeWordsFile(words: WordsFile, file = wordsFilePath()): void {
  const lines = Object.keys(words).sort().map((k) => `${JSON.stringify(k)}: ${JSON.stringify({ ar: words[k].ar, source: words[k].source, reviewed: words[k].reviewed })}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `{\n${lines.map((l) => ` ${l}`).join(",\n")}\n}\n`);
}

/** The words of a name as the file spells them: split on spaces only, so "O'Neil", "De La Hoya" and "Jr." keep their marks. */
export const wordsOf = (name: string): string[] => name.trim().split(/\s+/).filter(Boolean);

/** The Arabic form of a whole name made from reviewed words, or null when any word has no reviewed spelling. */
export function composeName(name: string, words: WordsFile): string | null {
  const parts = wordsOf(name);
  if (parts.length < 2) return null; // a single word is a name on its own: it is reviewed as a whole name, not composed
  const out: string[] = [];
  for (const p of parts) {
    const e = words[p];
    if (!e || !e.reviewed) return null;
    out.push(e.ar);
  }
  return out.join(" ");
}

let memo: { file: string; mtime: number; words: WordsFile } | undefined;
/** The committed words, read again only when the file changes. */
export function loadWords(file = wordsFilePath()): WordsFile {
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return {}; }
  if (memo && memo.file === file && memo.mtime === mtime) return memo.words;
  memo = { file, mtime, words: readWordsFile(file) };
  return memo.words;
}

/** Composed Arabic names for every fighter and person whose whole name has none, for the names table of one language. */
export function composedNames(db: DatabaseSync, have: Record<string, string>, words = loadWords()): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Object.values(words).some((w) => w.reviewed)) return out;
  for (const sql of ["SELECT name FROM boxers", "SELECT name FROM people"]) {
    let rows: { name: string }[] = [];
    try { rows = db.prepare(sql).all() as { name: string }[]; } catch { continue; }
    for (const { name } of rows) {
      if (typeof name !== "string" || name in have || name in out) continue;
      const c = composeName(name, words);
      if (c) out[name] = c;
    }
  }
  return out;
}

export interface Candidate { word: string; fighters: number; fully: number; suggestion?: string; reviewed?: boolean }

/**
 * The words still to be reviewed, most useful first. `fighters` is how many fighters without an Arabic name carry the word;
 * `fully` is how many of them would be complete once this word and every word above it are reviewed.
 */
export function candidates(db: DatabaseSync, have: Record<string, string>, words: WordsFile, limit = 1000): Candidate[] {
  const count = new Map<string, number>();
  const names: string[][] = [];
  for (const { name } of db.prepare("SELECT name FROM boxers").all() as { name: string }[]) {
    if (name in have) continue;
    const parts = wordsOf(name);
    if (parts.length < 2) continue;
    names.push(parts);
    for (const p of new Set(parts)) count.set(p, (count.get(p) ?? 0) + 1);
  }
  const ranked = [...count].filter(([w]) => !words[w]?.reviewed).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit);
  // how many names each word completes, counted in rank order: a name is complete when its last open word arrives
  const rank = new Map(ranked.map(([w], i) => [w, i] as const));
  const finishes = new Array<number>(ranked.length).fill(0);
  for (const parts of names) {
    let last = -1, ok = true;
    for (const p of parts) {
      if (words[p]?.reviewed) continue;
      const r = rank.get(p);
      if (r === undefined) { ok = false; break; }
      if (r > last) last = r;
    }
    if (ok && last >= 0) finishes[last]++;
  }
  let run = 0;
  return ranked.map(([word, fighters], i) => { run += finishes[i]; return { word, fighters, fully: run, suggestion: words[word]?.ar, reviewed: false }; });
}
