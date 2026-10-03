import type { World } from "../world";
import type { BoxerFull } from "../types";
import { heuristicParse } from "../ai";
import { normalize } from "../fighter-search";
import type { Names } from "../i18n/t";
import type { Call } from "./types";

interface Entry { b: BoxerFull; n: string[] }
const indexes = new WeakMap<World, WeakMap<Names, Entry[]>>();
function index(w: World, names: Names): Entry[] {
  let per = indexes.get(w);
  if (!per) { per = new WeakMap(); indexes.set(w, per); }
  let idx = per.get(names);
  if (!idx) {
    idx = w.boxers.map((b) => ({ b, n: [normalize(b.name), ...(names[b.name] ? [normalize(names[b.name])] : [])].filter((x) => x.length >= 5) }));
    per.set(names, idx);
  }
  return idx;
}

/** Fighters named in a question, in the order they appear: whole names only (a surname alone is ambiguous), longest first so "Maximilian Hartmann" is not read as "Lukas Hartmann". */
export function namesIn(w: World, names: Names, question: string): BoxerFull[] {
  let q = ` ${normalize(question)} `;
  const hits: { b: BoxerFull; at: number }[] = [];
  // a name stands alone, or in Arabic carries the attached word for "and" (و): "قارن بين راميل أباد وتوماس فيلالبا"
  const form = (n: string) => [` ${n} `, ` و${n} `];
  const cands = index(w, names).flatMap((e) => e.n.map((n) => ({ b: e.b, n }))).filter((c) => form(c.n).some((f) => q.includes(f))).sort((a, c) => c.n.length - a.n.length);
  for (const c of cands) {
    const f = form(c.n).find((x) => q.includes(x));
    if (!f || hits.some((h) => h.b.id === c.b.id)) continue;
    hits.push({ b: c.b, at: q.indexOf(f) });
    q = q.replace(f, ` ${"·".repeat(c.n.length)} `);
  }
  return hits.sort((a, c) => a.at - c.at).map((h) => h.b);
}

const has = (q: string, re: RegExp) => re.test(q);

/** Question -> list id, most specific first. English and Arabic wording; q is already normalised (folded, lower-case). */
const LISTS: [RegExp, string][] = [
  [/fastest (knock ?outs?|kos?|finish|stoppage)|quickest (knock ?out|ko|finish)|اسرع.*(ضربه قاضيه|ايقاف|حسم)/, "fastest-kos"],
  [/most knockdowns|اكثر.*اسقاط/, "knockdowns"],
  [/most defen[cs]es in a (single )?reign|اكثر.*دفاع.*عهد/, "reign-defenses"],
  [/most (title )?defen[cs]es|اكثر.*دفاع/, "defenses"],
  [/longest (title )?reign|اطول.*(عه[دو]|حكم|فتره حمل)/, "longest-reign"],
  [/most title (fight )?wins|اكثر.*فوز.*(لقب|الالقاب)/, "title-wins"],
  [/biggest upsets?|greatest upsets?|biggest shocks?|اكبر.*مفاج/, "upsets"],
  [/(longest|best|biggest) (winning |win )?(streak|run)|consecutive wins|اطول.*(سلسله|انتصارات متتاليه)/, "win-streak"],
  [/(highest|best) (ko|knockout) (rate|percentage)|knockout (rate|percentage)|اعلي نسبه.*قاضيه/, "ko-rate"],
  [/most (knockouts|kos|stoppages)|اكثر.*(ضربات? قاضيه|ك ?او)/, "kos"],
  [/most wins over (top|good|quality)|quality wins/, "quality-wins"],
  [/multi.?division|champions? in (the )?most divisions|in (two|three|four) divisions/, "divisions"],
  [/greatest (fights?|bouts?) (ever|of all time)|best fights? (ever|of all time)|اعظم النزالات/, "fights"],
  [/greatest (boxers?|fighters?)( of all time| ever)?|best (boxers?|fighters?) (of all time|ever)|goat\b|greatest of all time|اعظم (ملاكم|مقاتل)|افضل ملاكم في التاريخ/, "greatest"],
  [/(highest|best|top) (peak )?rating|peak rating|highest rated ever|اعلي تصنيف/, "peak"],
  [/most wins\b|اكثر.*(انتصارات|فوز)/, "wins"],
];

export const ARABIC_FOLDED = /[؀-ۿ]/;

/** The no-key planner: turns a question into tool calls with patterns. It will not understand everything, and an unrecognised question yields no calls. */
export function planByRules(question: string, w: World, names: Names): Call[] {
  const q = normalize(question).replace(/[?؟!.]+$/g, "");
  const countries = [...new Set(w.boxers.map((b) => b.country))];
  const f = heuristicParse(question, countries);
  const year = q.match(/\b(20\d\d)\b/)?.[1];
  const limitMatch = q.match(/\b(?:top|first|best)\s+(\d{1,2})\b/);
  const limit = limitMatch ? Math.min(25, +limitMatch[1]) : undefined;
  const scope = { ...(f.sex ? { sex: f.sex } : {}), ...(f.weightClass ? { division: f.weightClass } : {}) };
  const withLimit = (a: Record<string, unknown>) => (limit ? { ...a, limit } : a);
  const fighters = namesIn(w, names, question);

  if (fighters.length >= 2 && !has(q, /\bmost\b|\bhighest\b/)) return [{ tool: "head_to_head", args: { a: fighters[0].name, b: fighters[1].name } }];

  if (has(q, /fight of the year|best fight of|(afdal|افضل|اعظم) نزال في|نزال العام/)) return [{ tool: "fight_of_the_year", args: withLimit(year ? { year: +year } : {}) }];
  if (has(q, /upcoming.*(upset|underdog)|underdogs?\b|upset watch|(could|might|may) (be )?upset|upsets? (are )?(coming|expected)|مفاجاه محتمله|الاقل ترجيحا/)) return [{ tool: "upset_watch", args: withLimit({}) }];

  for (const [re, list] of LISTS) if (has(q, re)) return [{ tool: "record_list", args: withLimit({ list, ...scope }) }];

  if (has(q, /(highest|biggest|top|largest) (gate|gates)|gate record|اعلي.*(ايرادات? بوابه|بوابه)/)) return [{ tool: "money", args: withLimit({ kind: "gates" }) }];
  if (has(q, /pay.?per.?view|\bppv\b|بي ?بي ?في/)) return [{ tool: "money", args: withLimit({ kind: "ppv" }) }];
  if (has(q, /(biggest|highest|largest) purses?|highest.paid|best.paid|اعلي.*(اجر|مكافاه)/)) return [{ tool: "money", args: withLimit({ kind: "purses" }) }];
  if (has(q, /(highest|top|biggest) earners?|who earns the most|اعلي.*دخل/)) return [{ tool: "money", args: withLimit({ kind: "earners" }) }];

  if (has(q, /champions?\b|title.?holders?|who holds|holds the|belt.?holders?|بطل|ابطال|حامل/) && !fighters.length) return [{ tool: "champions", args: scope }];
  if (has(q, /trainer|coach|مدرب/)) {
    const typed = question.match(/(?:trainer|coach|مدرب)\s+([\p{L}.'\- ]{4,40})/iu)?.[1]?.trim();
    return [{ tool: "trainers", args: withLimit(typed && !has(normalize(typed), /^(impact|effect|the|best)/) ? { name: typed } : {}) }];
  }
  if (has(q, /rankings?\b|ranked\b|top \d+|pound.for.pound|\bp4p\b|تصنيف|ترتيب/)) return [{ tool: "rankings", args: withLimit(scope) }];
  if (has(q, /(upcoming|next|coming up|future) (fights?|events?|cards?|shows?)|fight calendar|schedule|القادمه|القادم|جدول/)) return [{ tool: "events", args: withLimit({ when: "upcoming" }) }];
  if (has(q, /(recent|latest|last) (fights?|events?|cards?|results?)|اخر (نزالات|النزالات|الفعاليات)/)) return [{ tool: "events", args: withLimit({ when: "recent" }) }];

  if (fighters.length === 1) return [{ tool: "fighter", args: { name: fighters[0].name } }];

  const filterKeys = Object.keys(f).filter((k) => k !== "text");
  if (filterKeys.length) return [{ tool: "fighters", args: withLimit(Object.fromEntries(Object.entries(f).filter(([k]) => k !== "text"))) }];
  return [];
}
