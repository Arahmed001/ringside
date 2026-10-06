/**
 * Native-speaker review of the Arabic: what is reviewed, what is not, and what a reviewer should look at first.
 *
 * Every Arabic string on the site was written by a machine (Claude). Nothing here makes one "reviewed" except a person
 * saying so: `i18n/ar.review.json` records, per English key, who approved or edited it, when, and a hash of the Arabic
 * they saw. If the Arabic changes afterwards the hash no longer matches and the string goes back to "changed since
 * review", so an approval can never silently cover text the reviewer did not read.
 *
 * The checks below are mechanical: placeholders, plural forms, leftover Latin words, digits, punctuation, spacing, the
 * glossary. They find slips so a reviewer's time goes on what only a native speaker can judge (register, idiom, whether it
 * sounds like a Saudi sports desk). They do not tell you the Arabic is good.
 */
import crypto from "node:crypto";
import type { Dict } from "./t";

export type Value = Dict[string];
export type Status = "machine" | "reviewed" | "changed";

export interface KeyReview { by: string; at: string; hash: string }
export interface ReviewMeta {
  /** One line per import: who, when, how many strings they approved as they were, and how many they edited. */
  reviews: { by: string; at: string; approved: number; edited: number; flagged: number }[];
  keys: Record<string, KeyReview>;
  /** Strings a reviewer flagged for discussion rather than approving, with their note. */
  flagged: Record<string, { by: string; at: string; note: string }>;
}
export const EMPTY_META = (): ReviewMeta => ({ reviews: [], keys: {}, flagged: {} });

export const hashOf = (v: Value): string => crypto.createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 10);

export function statusOf(key: string, dict: Dict, meta: ReviewMeta): Status {
  const r = meta.keys[key];
  if (!r || dict[key] === undefined) return "machine";
  return r.hash === hashOf(dict[key]) ? "reviewed" : "changed";
}

export function summarise(keys: string[], dict: Dict, meta: ReviewMeta) {
  const c = { machine: 0, reviewed: 0, changed: 0 };
  for (const k of keys) c[statusOf(k, dict, meta)]++;
  return { total: keys.length, ...c, flagged: keys.filter((k) => meta.flagged[k]).length };
}

// ---- mechanical checks ----

export type FlagCode = "placeholders" | "plural" | "untranslated" | "latin" | "digits" | "punctuation" | "spacing" | "length" | "glossary" | "numbers" | "gender";
/** "check": something mechanical is probably wrong. "note": worth a native speaker's eye, often fine. */
export interface Flag { code: FlagCode; note: string; severity: "check" | "note" }
const NOTE_CODES = new Set<FlagCode>(["glossary", "numbers", "gender"]);

/** Latin-letter words that are meant to stay Latin in Arabic text (brands, rating names, bodies, formats). */
export const KEEP_LATIN = new Set(["elo", "ko", "kos", "tko", "rtd", "dq", "ud", "md", "sd", "td", "ringside", "boxrec", "wikidata", "wikimedia", "commons", "api", "ai", "url", "cc0", "cc",
  "ppv", "id", "compubox", "csv", "json", "html", "rss", "atom", "wba", "wbc", "ibf", "wbo", "gbc", "wpa", "iba", "by", "sa", "lb", "kg", "cm", "mo", "pts", "olympedia", "hall", "fame", "ibhof", "claude",
  "anthropic", "pca", "xml", "js", "css", "r1", "p4p", "vs", "mg", "ctrl", "ko/tko", "openapi", "https", "lang", "chrome", "macos"]);

const PLURAL_FORMS = ["zero", "one", "two", "few", "many", "other"] as const;
const AR = /[؀-ۿ]/;
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tg = (s: string) => [...s.matchAll(/<\/?(\w+)>/g)].map((m) => m[1]).sort();
const stripSyntax = (s: string) => s.replace(/\{\w+\}/g, " ").replace(/<\/?\w+>/g, " ");
const forms = (v: Value): [string, string][] => (typeof v === "string" ? [["", v]] : Object.entries(v));
const normaliseAr = (s: string) => s.normalize("NFD").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

/** The stem used to look for a glossary rendering inside an inflected Arabic sentence: first word, no "ال", no plural/feminine ending. */
/** Broken plurals drop or move the weak letters (حزام → أحزمة, نزال → نزالات), so the match is on the consonants in order within one word. */
const subsequenceIn = (stem: string, text: string): boolean => {
  const letters = stem.replace(/[اويى]/g, "");
  if (letters.length < 3) return text.includes(stem);
  return text.split(/[^\u0600-\u06ff]+/).some((word) => { let i = 0; for (const ch of word) if (ch === letters[i]) i++; return i === letters.length; });
};
export const stemOf = (arabic: string): string => {
  const first = normaliseAr(arabic).replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] ?? "";
  return first.replace(/^(ال|لل|و)/, "").replace(/(ات|ون|ين|ان|ه)$/, "");
};

const GENDERED = /\b(he|she|his|her|him|hers)\b/i;

export function qaEntry(key: string, value: Value, opts: { plural?: boolean; glossary?: Record<string, string> } = {}): Flag[] {
  const flags: Flag[] = [];
  const add = (code: FlagCode, note: string) => { if (!flags.some((f) => f.code === code && f.note === note)) flags.push({ code, note, severity: NOTE_CODES.has(code) ? "note" : "check" }); };
  const english = opts.plural ? undefined : key;
  const list = forms(value);
  if (typeof value === "object") for (const f of PLURAL_FORMS) if (!value[f]) add("plural", `the "${f}" form is empty`);
  for (const [form, text] of list) {
    const label = form ? ` (${form})` : "";
    if (english !== undefined) {
      const a = ph(english).join(","), b = ph(text).join(",");
      if (a !== b) add("placeholders", `placeholders {${b}} should be {${a}}${label}`);
      if (tg(english).join(",") !== tg(text).join(",")) add("placeholders", `tags <${tg(text).join(",")}> should be <${tg(english).join(",")}>${label}`);
    }
    // the supplier's and the source's names are proper names and stay Latin (blanked, not removed, so the positions of the other words do not move)
    const bare = stripSyntax(text).replace(/Boxing Data API|BoxingScene/g, (m) => " ".repeat(m.length));
    // a Latin word is fine when it is a brand or format, part of a code path (lib/providers, docs/research.md) or an ALL_CAPS abbreviation or setting name (whether abbreviations should be Arabic is one of the reviewer's questions)
    const isKept = (w: string, at: number) => KEEP_LATIN.has(w.toLowerCase().replace(/['’-].*$/, "")) || /^[A-Z][A-Z0-9_]+$/.test(w) || /[/.]/.test(bare.slice(Math.max(0, at - 1), at)) || /[/.]/.test(bare.slice(at + w.length, at + w.length + 1));
    const words = [...bare.matchAll(/[A-Za-z][A-Za-z'’-]{2,}/g)].map((m) => ({ w: m[0], at: m.index! }));
    const latin = words.filter(({ w, at }) => !isKept(w, at)).map(({ w }) => w);
    if (!AR.test(bare) && words.length && english !== undefined && stripSyntax(english).trim().toLowerCase() === bare.trim().toLowerCase() && latin.length) add("untranslated", `identical to the English${label}`);
    if (latin.length && AR.test(bare)) add("latin", `Latin words left: ${[...new Set(latin)].slice(0, 5).join(", ")}${label}`);
    if (/[٠-٩]/.test(text)) add("digits", `Arabic-Indic digits${label}: the site uses 0-9`);
    if (/[؀-ۿ]\s*,|,\s*[؀-ۿ]/.test(text)) add("punctuation", `a Latin comma between Arabic words (،)${label}`);
    if (/[؀-ۿ][^\n]*\?(\s|$)/.test(bare) && AR.test(bare)) add("punctuation", `a Latin question mark (؟)${label}`);
    if (/[؀-ۿ]\s*;/.test(text)) add("punctuation", `a Latin semicolon (؛)${label}`);
    if (/"[؀-ۿ]|[؀-ۿ]"/.test(text)) add("punctuation", `straight quotes around Arabic (« »)${label}`);
    if (/\s[،؛؟.:!]/.test(text) && AR.test(text)) add("spacing", `a space before punctuation${label}`);
    if (/ {2,}/.test(text) || text !== text.trim()) add("spacing", `double, leading or trailing space${label}`);
    if (/ـ(?!\s*[\d{<A-Za-z])/.test(text)) add("spacing", `tatweel (kashida) in the text${label}`); // before a number or Latin word it is the normal way to attach the prefix (بـ4)
    if (english !== undefined) {
      const eLen = stripSyntax(english).trim().length, aLen = bare.trim().length;
      if (eLen >= 25 && (aLen / eLen > 2.2 || aLen / eLen < 0.3)) add("length", `${aLen} characters against ${eLen} in English${label}`);
      const en = (stripSyntax(english).match(/\d+/g) ?? []).join(","), ar = (bare.match(/\d+/g) ?? []).join(",");
      if (en !== ar) add("numbers", `numbers in the text (${ar || "none"}) differ from the English (${en || "none"})${label}`);
    }
  }
  if (GENDERED.test(key) || (opts.plural && GENDERED.test(key))) add("gender", "the English is gendered (he/she); check the Arabic is neutral or has both forms");
  if (opts.glossary) {
    const lower = key.toLowerCase();
    const all = normaliseAr(list.map(([, t]) => t).join(" "));
    for (const [term, ar] of Object.entries(opts.glossary)) {
      if (term.startsWith("_") || typeof ar !== "string") continue;
      if (!new RegExp(`(^|[^a-z])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?($|[^a-z])`).test(lower)) continue;
      const stem = stemOf(ar);
      if (KEEP_LATIN.has(term.toLowerCase())) continue; // terms that stay in Latin letters (Elo, KO) are not looked for in Arabic
      if (stem.length >= 3 && !subsequenceIn(stem, all)) add("glossary", `“${term}” is usually “${ar}” and that is not in this string`);
    }
  }
  return flags;
}

// ---- grouping: what a reviewer sees, in the order they should see it ----

/** The page or feature a string belongs to, from the files that use it; the order here is the order of review (most seen first). */
const GROUPS: [string, RegExp][] = [
  ["Navigation, header and footer", /(layout|SideNav|RailControls|nav|LanguageSwitch|NavLink|CommandPalette|search)\b/],
  ["Home page", /app[\\/]\[locale\][\\/]page\.tsx$/],
  ["Fighter profiles", /boxers[\\/]\[slug\]|Portrait|TitlesCard|Awards|TeamTimeline|TenureTable|Money\.tsx/],
  ["Rankings and fighter search", /rankings|boxers[\\/]page|fighter-search|lib[\\/]ai\.ts/],
  ["Events, bouts and results", /events|bouts|ScoreCards|PunchStats|recap|Poster/],
  ["Fight previews and predictions", /previews|preview|compare|MatchupLab|predict|PreviewArticle|PickEm|model|ProbBar/],
  ["Titles and all-time lists", /titles|all-time|records|lineage|fight-of-the-year|fight-score|RecordRows|RecordsFilter|ReignTimeline/],
  ["Ask the data", /ask|AskResults/],
  ["Upset watch and trainer impact", /upset|trainer|ImpactRange|WatchCard/],
  ["Track record and ledger", /accountability|ledger|Calibration|LiveLedger/],
  ["Matchmaking", /matchmaking|Matchmaking/],
  ["People, gyms and organisations", /people|orgs|officials|team\.ts/],
  ["Money, weights and analytics", /money|weights|analytics|StyleMap|map[\\/]|WeightChart|charts|ChartI18n/],
  ["Data and methods page", /data[\\/]page|coverage|methods|style\.ts|format\.ts/],
];
export const GROUP_ORDER = [...GROUPS.map(([g]) => g), "Other"];
export const groupOf = (files: string[]): string => {
  for (const [name, re] of GROUPS) if (files.some((f) => re.test(f))) return name;
  return "Other";
};

// ---- terminology ----

export interface TermRow { term: string; arabic: string; strings: number; missing: { key: string; ar: string }[] }

/** For each glossary term: how many strings use the English term, and the ones where the agreed Arabic rendering is not found. */
export function glossaryReport(dict: Dict, glossary: Record<string, string>): TermRow[] {
  const rows: TermRow[] = [];
  for (const [term, arabic] of Object.entries(glossary)) {
    if (term.startsWith("_") || typeof arabic !== "string") continue;
    const stem = stemOf(arabic);
    const re = new RegExp(`(^|[^a-z])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?($|[^a-z])`);
    const used = Object.keys(dict).filter((k) => re.test(k.toLowerCase()));
    const missing = used.filter((k) => stem.length >= 3 && !KEEP_LATIN.has(term.toLowerCase()) && !subsequenceIn(stem, normaliseAr(forms(dict[k]).map(([, t]) => t).join(" ")))).map((k) => ({ key: k, ar: forms(dict[k])[0][1] }));
    rows.push({ term, arabic, strings: used.length, missing });
  }
  return rows.sort((a, b) => b.strings - a.strings);
}

// ---- applying a reviewer's changes ----

export interface ReviewEntry { key: string; status: "approved" | "edited" | "flagged"; ar?: Value; note?: string }
export interface ReviewFile {
  format: "ringside-arabic-review/1";
  reviewer: string;
  at: string;
  build?: string;
  entries: ReviewEntry[];
  names?: { en: string; ar: string; status: "approved" | "edited" | "flagged"; note?: string }[];
  glossary?: { term: string; ar: string }[];
}

export interface ImportResult { dict: Dict; meta: ReviewMeta; approved: number; edited: number; flagged: number; rejected: { key: string; reason: string }[]; glossaryChanged: string[] }

/**
 * Validates a reviewer's file and applies it. An entry is rejected (and nothing of it applied) if its key is unknown,
 * its placeholders or tags differ from the English, a plural form is missing, or the text is empty; the rest still go in.
 */
export function applyReview(file: ReviewFile, dict: Dict, meta: ReviewMeta, known: Map<string, { plural?: string }>): ImportResult {
  if (file.format !== "ringside-arabic-review/1") throw new Error(`unknown review file format "${file.format}"`);
  if (!file.reviewer?.trim()) throw new Error("the review file has no reviewer name");
  const out: Dict = { ...dict };
  const m: ReviewMeta = { reviews: [...meta.reviews], keys: { ...meta.keys }, flagged: { ...meta.flagged } };
  const rejected: ImportResult["rejected"] = [];
  let approved = 0, edited = 0, flagged = 0;
  const at = (file.at || new Date().toISOString()).slice(0, 10);
  for (const e of file.entries) {
    const info = known.get(e.key);
    if (!info || dict[e.key] === undefined) { rejected.push({ key: e.key, reason: "not a key on the site" }); continue; }
    if (e.status === "flagged") { m.flagged[e.key] = { by: file.reviewer, at, note: (e.note ?? "").slice(0, 500) }; flagged++; continue; }
    let value: Value = out[e.key]; // not `dict`: an earlier entry for the same key in this file may already have changed it
    if (e.status === "edited") {
      if (e.ar === undefined) { rejected.push({ key: e.key, reason: "edited, but no Arabic given" }); continue; }
      const flags = qaEntry(e.key, e.ar, { plural: info.plural !== undefined }).filter((f) => f.code === "placeholders" || f.code === "plural");
      if (flags.length) { rejected.push({ key: e.key, reason: flags.map((f) => f.note).join("; ") }); continue; }
      if (typeof e.ar === "string" ? !e.ar.trim() : Object.values(e.ar).some((x) => !String(x).trim())) { rejected.push({ key: e.key, reason: "empty text" }); continue; }
      value = typeof e.ar === "string" ? e.ar.trim() : (Object.fromEntries(Object.entries(e.ar).map(([k, v]) => [k, String(v).trim()])) as Value);
      out[e.key] = value; edited++;
    } else approved++;
    m.keys[e.key] = { by: file.reviewer, at, hash: hashOf(value) };
    delete m.flagged[e.key];
  }
  m.reviews.push({ by: file.reviewer, at, approved, edited, flagged });
  return { dict: out, meta: m, approved, edited, flagged, rejected, glossaryChanged: (file.glossary ?? []).map((g) => g.term) };
}
