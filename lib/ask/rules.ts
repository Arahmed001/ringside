import type { World } from "../world";
import type { BoxerFull } from "../types";
import { heuristicParse } from "../ai";
import { normalize } from "../fighter-search";
import type { Names } from "../i18n/t";
import type { Call } from "./types";

/** Folded text with the punctuation people type next to names taken out ("Villalba's record", "Al-Qahtani: who is better"), applied to the question and the names alike so "H." in a name still matches. */
const plain = (s: string) => normalize(s).replace(/['’]s\b/g, " ").replace(/[:;,!?؟،()"“”.]/g, " ").replace(/\s+/g, " ").trim();

interface Entry { b: BoxerFull; n: string[] }
const indexes = new WeakMap<World, WeakMap<Names, Entry[]>>();
function index(w: World, names: Names): Entry[] {
  let per = indexes.get(w);
  if (!per) { per = new WeakMap(); indexes.set(w, per); }
  let idx = per.get(names);
  if (!idx) {
    idx = w.boxers.map((b) => ({ b, n: [plain(b.name), ...(names[b.name] ? [plain(names[b.name])] : [])].filter((x) => x.length >= 5) }));
    per.set(names, idx);
  }
  return idx;
}

/** Fighters named in a question, in the order they appear: whole names only (a surname alone is ambiguous), longest first so "Maximilian Hartmann" is not read as "Lukas Hartmann". */
export function namesIn(w: World, names: Names, question: string): BoxerFull[] {
  let q = ` ${plain(question)} `;
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

/** A trainer named in full in the question, if any (the trainers tool takes a name). */
const trainerIndex = new WeakMap<World, { name: string; n: string }[]>();
function trainerNamed(w: World, question: string): string | undefined {
  let idx = trainerIndex.get(w);
  if (!idx) { idx = [...w.people.values()].filter((p) => w.roles.get(p.id)?.has("trainer")).map((p) => ({ name: p.name, n: plain(p.name) })).filter((x) => x.n.length >= 5); trainerIndex.set(w, idx); }
  const q = ` ${plain(question)} `;
  return idx.filter((x) => q.includes(` ${x.n} `)).sort((a, b) => b.n.length - a.n.length)[0]?.name;
}

const has = (q: string, re: RegExp) => re.test(q);

/** Question -> list id, most specific first. English and Arabic wording; q is already normalised (folded, lower-case). */
const LISTS: [RegExp, string][] = [
  [/fastest (knock ?outs?|kos?|finish|stoppage)|quickest (knock ?out|ko|finish)|اسرع.*(ضربه قاضيه|ايقاف|حسم)/, "fastest-kos"],
  [/most knockdowns|اكثر.*اسقاط/, "knockdowns"],
  [/most defen[cs]es in a (single )?reign|اكثر.*دفاع.*عهد/, "reign-defenses"],
  [/most (title )?defen[cs]es|defended .*\bthe most\b|اكثر.*دفاع/, "defenses"],
  [/longest (title )?reign|(longest|most).*\b(held|hold|holding)\b.*(title|belt)|held .*(title|belt).*longest|اطول.*(عه[دو]|حكم|فتره حمل)/, "longest-reign"],
  [/most title (fight )?wins|اكثر.*فوز.*(لقب|الالقاب)/, "title-wins"],
  [/biggest upsets?|greatest upsets?|biggest shocks?|اكبر.*مفاج/, "upsets"],
  [/(longest|best|biggest) (winning |win )?(streak|run)|consecutive wins|اطول.*(سلسله|انتصارات متتاليه)/, "win-streak"],
  [/(highest|best) (ko|knockout) (rate|percentage|ratio)|knockout (rate|percentage|ratio)|(punches|hits) the hardest|hardest (puncher|hitter)s?|biggest punchers?|اعلي نسبه.*قاضيه/, "ko-rate"],
  [/most (ko|knockout|stoppage)s?( wins| victories)?\b|(ko|knockout) leaders?|اكثر.*(ضربات? قاضيه|ك ?او)/, "kos"],
  [/most wins over (top|good|quality)|quality wins|(beaten|beat|defeated) the best|best (opposition|opponents)|(top|strongest|toughest) (opposition|opponents)/, "quality-wins"],
  [/multi.?division|champions? in (the )?most divisions|in (two|three|four) divisions|most (weight )?(classes|divisions)/, "divisions"],
  [/greatest (fights?|bouts?) (ever|of all time)|best fights? (ever|of all time)|اعظم النزالات/, "fights"],
  [/greatest (female |male |women.?s |men.?s )?(boxers?|fighters?)( of all time| ever)?|best (boxers?|fighters?) (of all time|ever)|goat\b|greatest of all time|اعظم (ملاكم|مقاتل)|افضل ملاكم في التاريخ/, "greatest"],
  [/(highest|best|top) (peak )?rating|peak rating|highest rated ever|اعلي تصنيف/, "peak"],
  [/most wins\b|(won|win|winning) (the )?most(?! recent)|winningest|اكثر.*(انتصارات|فوز)/, "wins"],
];

export const ARABIC_FOLDED = /[؀-ۿ]/;

/** The no-key planner: turns a question into tool calls with patterns. It will not understand everything, and an unrecognised question yields no calls. */
export function planByRules(question: string, w: World, names: Names): Call[] {
  const q = normalize(question).replace(/[?؟!.]+$/g, "");
  const countries = [...new Set(w.boxers.map((b) => b.country))];
  const f = heuristicParse(question, countries);
  const year = q.match(/\b(20\d\d)\b/)?.[1];
  const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20 };
  const limitMatch = q.match(/\b(?:top|first|best)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\b/);
  const limit = limitMatch ? Math.min(25, WORD_NUMBERS[limitMatch[1]] ?? +limitMatch[1]) : undefined;
  const scope = { ...(f.sex ? { sex: f.sex } : {}), ...(f.weightClass ? { division: f.weightClass } : {}) };
  const withLimit = (a: Record<string, unknown>) => (limit ? { ...a, limit } : a);
  const fighters = namesIn(w, names, question);

  if (fighters.length >= 2 && !has(q, /\bmost\b|\bhighest\b/)) return [{ tool: "head_to_head", args: { a: fighters[0].name, b: fighters[1].name } }];

  const filters = () => ({ tool: "fighters", args: withLimit(Object.fromEntries(Object.entries(f).filter(([k]) => k !== "text"))) });
  const numeric = f.minWins !== undefined || f.minKOs !== undefined || f.minKoRate !== undefined || f.minReach !== undefined || f.undefeated;
  // "fighters with more than 20 wins and a knockout rate over 70%" is a search, even though "knockout rate" is also the name of a list
  if (!fighters.length && numeric && has(q, /\b(fighters?|boxers?) (with|who|that)\b/)) return [filters()];

  if (has(q, /fight of the year|best fight of|(afdal|افضل|اعظم) نزال في|نزال العام/)) return [{ tool: "fight_of_the_year", args: withLimit(year ? { year: +year } : {}) }];
  if (has(q, /upcoming.*(upset|underdog)|underdogs?\b|upset watch|(could|might|may) (be )?upset|upsets? (are )?(coming|expected)|favou?rites? .*(lose|beaten|upset|vulnerable)|(could|might|may|going to) (get |be |getting )?(upset|beaten)|(produce|cause|spring|pull off) an? (shock|upset)|could .*\b(shock|upset)\b|(most )?likely to (lose|be beaten|be upset)|shock results?|danger fights?|مفاجاه محتمله|الاقل ترجيحا/)) return [{ tool: "upset_watch", args: withLimit({}) }];

  // completed fights of a year or the title fights, by how they ended: "knockouts in 2025", "title fights this year", "fastest finishes of 2024"
  const thisYear = Number(w.today.slice(0, 4));
  const boutYear = year ? +year : has(q, /\bthis year\b/) ? thisYear : has(q, /\blast year\b/) ? thisYear - 1 : undefined;
  const recently = has(q, /\b(recent|latest|newest)\b/) && has(q, /\b(knockouts?|kos?|stoppages?|decisions?)\b/);
  if ((boutYear || recently || has(q, /title fights?/)) && has(q, /\b(fights?|bouts?|knockouts?|kos?|stoppages?|finishes|decisions?|draws?)\b/) && !has(q, /\b(most|highest|longest|biggest|greatest|upcoming|next|coming)\b|fight of the year|best fights?/)) {
    return [{ tool: "bouts", args: withLimit({
      ...(boutYear ? { year: boutYear } : {}), ...(scope.division ? { division: scope.division } : {}),
      ...(has(q, /title fights?/) ? { title: true } : {}),
      ...(has(q, /knockouts?|\bkos?\b|stoppages?|finishes/) ? { method: "stoppage" } : has(q, /decisions?/) ? { method: "decision" } : has(q, /draws?/) ? { method: "DRAW" } : {}),
      ...(has(q, /fastest|quickest/) ? { sort: "fastest" } : has(q, /knockdowns?/) ? { sort: "knockdowns" } : {}),
    }) }];
  }

  // a division plus "of all time" is that division's greatest list; a division plus "right now" is its ranking
  if (scope.division && has(q, /\b(best|greatest|goat)\b/) && has(q, /of all time|\bever\b|in history|all.time/)) return [{ tool: "record_list", args: withLimit({ list: "greatest", ...scope }) }];
  if (scope.division && has(q, /\b(best|top|number one|champion)\b/) && has(q, /right now|currently|today|at the moment|\balive\b|these days/)) return [{ tool: "rankings", args: withLimit(scope) }];

  for (const [re, list] of LISTS) {
    if (!has(q, re)) continue;
    if (boutYear && list === "fastest-kos") return [{ tool: "bouts", args: withLimit({ year: boutYear, sort: "fastest" }) }];
    if (boutYear && list === "knockdowns" && !has(q, /\b(boxers?|fighters?)\b/)) return [{ tool: "bouts", args: withLimit({ year: boutYear, sort: "knockdowns" }) }];
    // the all-time lists have no year: "most knockouts in 2024" answered with the all-time list would be a wrong answer that looks right, so it is no answer
    if (boutYear) return [];
    return [{ tool: "record_list", args: withLimit({ list, ...scope }) }];
  }

  if (has(q, /(highest|biggest|top|largest) (gate|gates)|gate record|(most expensive|priciest) tickets?|ticket (sales|revenue)|gate (receipts?|takings?|revenue)|اعلي.*(ايرادات? بوابه|بوابه)/)) return [{ tool: "money", args: withLimit({ kind: "gates" }) }];
  if (has(q, /pay.?per.?view|\bppv\b|بي ?بي ?في/)) return [{ tool: "money", args: withLimit({ kind: "ppv" }) }];
  if (has(q, /(biggest|highest|largest) purses?|highest.paid|best.paid|paydays?|paychecks?|اعلي.*(اجر|مكافاه)/)) return [{ tool: "money", args: withLimit({ kind: "purses" }) }];
  if (has(q, /(highest|top|biggest) earners?|who earns the most|earns? the most|how much (do|does|did) (boxers?|fighters?) (make|earn)|اعلي.*دخل|(رواتب|اجور|مكافات|دخل).*(اعلي|الاعلي|اكبر)/)) return [{ tool: "money", args: withLimit({ kind: "earners" }) }];

  if (has(q, /champs?\b|champions?\b|title.?holders?|who holds|holds the|belt.?holders?|بطل|ابطال|حامل/) && !fighters.length) return [{ tool: "champions", args: scope }];
  if (has(q, /trainer|coach|مدرب/) && (!fighters.length || trainerNamed(w, question))) {
    const typed = question.match(/(?:trainer|coach|مدرب)\s+([\p{L}.'\- ]{4,40})/iu)?.[1]?.trim();
    const name = trainerNamed(w, question) ?? (typed && !has(normalize(typed), /^(impact|effect|the|best)/) ? typed : undefined);
    return [{ tool: "trainers", args: withLimit(name ? { name } : {}) }];
  }
  if (!fighters.length && trainerNamed(w, question)) return [{ tool: "trainers", args: withLimit({ name: trainerNamed(w, question) }) }];
  // one fighter named: what is asked about him is on his page, whatever else the sentence mentions ("what was X's last fight")
  if (fighters.length === 1) return [{ tool: "fighter", args: { name: fighters[0].name } }];

  if (f.archetype && !has(q, /rank|pound.for.pound|p4p/)) return [filters()];
  if (has(q, /new to boxing|who should i (know|watch|follow)|where (do|should) i (start|begin)/)) return [{ tool: "rankings", args: withLimit({}) }];
  if (has(q, /rankings?\b|ranked\b|top \d+|pound.for.pound|\bp4p\b|تصنيف|ترتيب/)) return [{ tool: "rankings", args: withLimit(scope) }];
  if (has(q, /(upcoming|next|coming up|future) (fights?|events?|cards?|shows?)|fight calendar|schedule|(what|which) (fights?|cards?|boxing|events?|bouts?) (is |are )?(on|coming|scheduled|happening|next)|who.?s (fighting|boxing)( next| tonight| this)?|next (big |major |title )?(fight|bout|card)|coming up|boxing is on|on this (week|month|weekend)|this weekend|tonight|next (week|month)|القادمه|القادم|جدول/)) return [{ tool: "events", args: withLimit({ when: "upcoming" }) }];
  if (has(q, /(recent|latest|last|most recent) (boxing |fight )?(fights?|events?|cards?|results?)|results? of the (most )?(recent|latest|last)|last (night|weekend)|yesterday|who won the most recent|اخر (نزالات|النزالات|الفعاليات)|(النزالات|الفعاليات|النتائج) الاخيره/)) return [{ tool: "events", args: withLimit({ when: "recent" }) }];

  const filterKeys = Object.keys(f).filter((k) => k !== "text");
  // a lone sort ("best") is only a search when the question is about fighters at all
  if (filterKeys.some((k) => k !== "sort") || (f.sort && f.sort !== "rating") || (filterKeys.length && has(q, /\b(fighters?|boxers?|champs?|champions?|prospects?)\b|ملاكم/))) return [{ tool: "fighters", args: withLimit(Object.fromEntries(Object.entries(f).filter(([k]) => k !== "text"))) }];
  return [];
}

/**
 * Why a question the planner could not answer got no answer, when there is a particular reason worth telling the person (otherwise the generic
 * "I could not match that question"). Only one so far: a year was asked about a list that has no year, which is better refused than answered for all time.
 */
export function refusalReason(question: string): "year" | null {
  const q = normalize(question).replace(/[?؟!.]+$/g, "");
  const yearly = /\b20\d\d\b/.test(q) || has(q, /\bthis year\b|\blast year\b/);
  return yearly && LISTS.some(([re]) => has(q, re)) ? "year" : null;
}
