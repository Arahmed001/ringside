import type { World } from "../world";
import type { BoxerFull } from "../types";
import { heuristicParse } from "../ai";
import { normalize } from "../fighter-search";
import { allowedSlips, editDistance, wordsOf } from "../fuzzy";
import type { Names } from "../i18n/t";
import type { Call } from "./types";

/** Folded text with the punctuation people type next to names taken out ("Villalba's record", "Al-Qahtani: who is better"), applied to the question and the names alike so "H." in a name still matches. */
const plain = (s: string) => normalize(s).replace(/['’]s\b/g, " ").replace(/[:;,!?؟،()"“”.]/g, " ").replace(/\s+/g, " ").trim();

/** Words that join a surname to what comes before it (van der Berg, De La Fuente, dos Santos, bin Hassan) and a name's suffix (Jr., III): fans leave them off or run them together. */
const PARTICLES = new Set(["van", "der", "den", "de", "la", "le", "del", "della", "di", "da", "dos", "das", "do", "du", "von", "bin", "ibn", "al", "el"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/**
 * The other ways a name is typed, from its folded form: without the suffix ("Roy Jones" for Roy Jones Jr.), with the middle names left out ("Maria Garcia" for
 * Maria Elena Garcia), without the particles ("Sven Berg"), with the particles run onto the surname ("Sven vanderberg"), and any of these without the
 * apostrophe ("Conor OBrien"). Each has at least two words; the full name itself is not one of them.
 */
export function nameVariants(name: string): string[] {
  const out = new Set<string>();
  const words = name.split(" ");
  const bare = SUFFIXES.has(words[words.length - 1]) && words.length > 2 ? words.slice(0, -1) : words;
  const add = (ws: string[]) => { if (ws.length >= 2) { out.add(ws.join(" ")); out.add(ws.join(" ").replace(/['’]/g, "")); } };
  add(bare);
  if (bare.length >= 3) add([bare[0], bare[bare.length - 1]]);
  add(bare.filter((x, i) => i === 0 || !PARTICLES.has(x)));
  const joined: string[] = [];
  let carry = "";
  for (const x of bare) { if (joined.length && PARTICLES.has(x)) carry += x; else { joined.push(carry + x); carry = ""; } }
  add(joined);
  out.delete(name);
  return [...out];
}

/** Each fighter's variants that point to that fighter alone: a variant two fighters share, or one that is another fighter's full name, is dropped. */
const variantCache = new WeakMap<World, Map<number, string[]>>();
function variantsOf(w: World): Map<number, string[]> {
  let m = variantCache.get(w);
  if (!m) {
    const full = new Set(w.boxers.map((b) => plain(b.name)));
    const owners = new Map<string, number[]>();
    const all = w.boxers.map((b) => ({ b, vs: nameVariants(plain(b.name)).filter((v) => v.length >= 5 && !full.has(v)) }));
    for (const { b, vs } of all) for (const v of vs) { const l = owners.get(v); if (l) l.push(b.id); else owners.set(v, [b.id]); }
    m = new Map(all.map(({ b, vs }) => [b.id, vs.filter((v) => owners.get(v)!.length === 1)]));
    variantCache.set(w, m);
  }
  return m;
}

interface Entry { b: BoxerFull; n: string[] }
const indexes = new WeakMap<World, WeakMap<Names, Entry[]>>();
function index(w: World, names: Names): Entry[] {
  let per = indexes.get(w);
  if (!per) { per = new WeakMap(); indexes.set(w, per); }
  let idx = per.get(names);
  if (!idx) {
    const variants = variantsOf(w);
    idx = w.boxers.map((b) => ({ b, n: [plain(b.name), ...(names[b.name] ? [plain(names[b.name])] : []), ...(variants.get(b.id) ?? [])].filter((x) => x.length >= 5) }));
    per.set(names, idx);
  }
  return idx;
}

/** The words of a name, for the near-spelling match: a full name has at least two, and the words of one person are all there is to go on. */
interface Near<T> { owner: T; words: string[] }
interface NearIndex<T> { all: Near<T>[]; /** each distinct word with the names that have it and where in the name */ vocab: Map<string, [number, number][]>; byLength: Map<number, string[]>; /** words of questions already looked up: the same few come in every question */ closeTo: Map<string, string[]> }

/** The words of a name or question for the near match: split at punctuation and hyphens, or, run together, with the hyphens taken out of a word ("Al-Otaibi" is "al-otaibi" in one word) as people often type them. */
const HYPHEN = /-/;
const nearWords = (s: string, joined: boolean) => (joined ? s.split(/[\s.,;:!?؟،()"“”'’]+/).filter(Boolean).map((x) => x.replace(/-/g, "")) : wordsOf(s));

function buildNear<T>(people: { owner: T; names: string[] }[], joined = false): NearIndex<T> {
  const all: Near<T>[] = [], vocab = new Map<string, [number, number][]>(), byLength = new Map<number, string[]>();
  for (const p of people) for (const n of p.names) {
    if (joined && !HYPHEN.test(n)) continue; // the same words as the other index
    const words = nearWords(n, joined);
    if (words.length < 2) continue;
    const at = all.push({ owner: p.owner, words }) - 1;
    words.forEach((word, j) => {
      let l = vocab.get(word);
      if (!l) { vocab.set(word, (l = [])); const b = byLength.get(word.length); if (b) b.push(word); else byLength.set(word.length, [word]); }
      l.push([at, j]);
    });
  }
  return { all, vocab, byLength, closeTo: new Map() };
}

/**
 * Slips between a word typed and a word of a name: none if equal, otherwise as many letters wrong, missing, added or swapped as the longer word allows
 * (lib/fuzzy.ts: none up to three letters, so initials and short words are exact; one up to six; two beyond), or Infinity.
 */
function slipsBetween(typed: string, word: string): number {
  if (typed === word) return 0;
  if (typed.length <= 3 || word.length <= 3) return Infinity;
  const max = allowedSlips(Math.max(typed.length, word.length));
  const d = editDistance(typed, word, max);
  return d <= max ? d : Infinity;
}

/** Most slips forgiven in a whole name: one letter in each of two words, or two in one. Beyond that two different people are too easily taken for each other. */
const MAX_NAME_SLIPS = 2;

interface NearHit<T> { owner: T; first: number; count: number; slips: number }

/**
 * The people named in `q` (already folded and with the exactly-matched names blotted out) with a slip or two in the spelling. A name is found when each of
 * its words (at least two) is a word of the question or within the slips allowed, in order, side by side. Of the readings of one stretch of the question
 * the fewest slips wins; when two different people tie there is no way to know which was meant, so neither is returned.
 */
function nearNamed<T>(idxs: { split: NearIndex<T>; joined: NearIndex<T> }, q: string): { owner: T; at: number }[] {
  const found = nearNamedIn(idxs.split, q, false);
  for (const h of nearNamedIn(idxs.joined, q, true)) if (!found.some((f) => f.owner === h.owner)) found.push(h);
  return found;
}

interface Tok { t: string; at: number }

/** A name with a space typed inside a word ("Ell ery"): two neighbouring words of the question, run together, read as one, when the result is long enough to be a name's word. */
const MIN_MERGED = 5;

function nearNamedIn<T>(idx: NearIndex<T>, q: string, joined: boolean): { owner: T; at: number }[] {
  if (!idx.all.length) return [];
  const toks: Tok[] = [...q.matchAll(joined ? /[^\s.,;:!?؟،()"“”'’]+/g : /[^\s\-.,;:!?؟،()"“”'’]+/g)].map((m) => ({ t: joined ? m[0].replace(/-/g, "") : m[0], at: m.index ?? 0 })).filter((x) => x.t);
  const found = align(idx, toks);
  for (let i = 0; i + 1 < toks.length; i++) {
    if (toks[i].t.length + toks[i + 1].t.length < MIN_MERGED) continue;
    const merged = [...toks.slice(0, i), { t: toks[i].t + toks[i + 1].t, at: toks[i].at }, ...toks.slice(i + 2)];
    for (const h of align(idx, merged, [i])) if (!found.some((f) => f.owner === h.owner)) found.push(h);
  }
  return found;
}

/** The words of the names that `typed` is, or is a slip or two from (see slipsBetween). */
const REMEMBERED = 4000;
function wordsCloseTo<T>(idx: NearIndex<T>, typed: string): string[] {
  let close = idx.closeTo.get(typed);
  if (close) return close;
  close = [];
  if (idx.vocab.has(typed)) close.push(typed);
  if (typed.length > 3) { const reach = allowedSlips(typed.length + 2); for (let len = typed.length - reach; len <= typed.length + reach; len++) for (const v of idx.byLength.get(len) ?? []) if (v !== typed && slipsBetween(typed, v) !== Infinity) close.push(v); }
  if (idx.closeTo.size >= REMEMBERED) idx.closeTo.clear();
  idx.closeTo.set(typed, close);
  return close;
}

/** The names found in a list of tokens, anchored on every token or only on the `anchors`. */
function align<T>(idx: NearIndex<T>, toks: Tok[], anchors?: number[]): { owner: T; at: number }[] {
  const seen = new Set<number>(), hits: NearHit<T>[] = [];
  for (const i of anchors ?? toks.keys()) {
    const t = toks[i].t, close = wordsCloseTo(idx, t);
    for (const v of close) for (const [at, j] of idx.vocab.get(v)!) {
      const first = i - j, words = idx.all[at].words;
      if (first < 0 || first + words.length > toks.length) continue;
      const key = at * 1e5 + first;
      if (seen.has(key)) continue;
      seen.add(key);
      let slips = 0;
      for (let m = 0; m < words.length && slips <= MAX_NAME_SLIPS; m++) slips += slipsBetween(toks[first + m].t, words[m]);
      if (slips <= MAX_NAME_SLIPS) hits.push({ owner: idx.all[at].owner, first, count: words.length, slips });
    }
  }
  hits.sort((a, c) => a.slips - c.slips || c.count - a.count || a.first - c.first);
  const taken: boolean[] = [], out: { owner: T; at: number }[] = [];
  for (const h of hits) {
    const span = Array.from({ length: h.count }, (_, k) => h.first + k);
    if (span.some((k) => taken[k])) continue;
    const rivals = hits.filter((x) => x.owner !== h.owner && x.slips === h.slips && x.count === h.count && x.first < h.first + h.count && h.first < x.first + x.count);
    span.forEach((k) => { taken[k] = true; });
    if (!rivals.length) out.push({ owner: h.owner, at: toks[h.first].at });
  }
  return out;
}

const both = <T>(people: { owner: T; names: string[] }[]) => ({ split: buildNear(people), joined: buildNear(people, true) });
type NearBoth<T> = ReturnType<typeof both<T>>;
const nearIndexes = new WeakMap<World, WeakMap<Names, NearBoth<BoxerFull>>>();
function nearFighters(w: World, names: Names): NearBoth<BoxerFull> {
  let per = nearIndexes.get(w);
  if (!per) { per = new WeakMap(); nearIndexes.set(w, per); }
  let idx = per.get(names);
  if (!idx) { const variants = variantsOf(w); idx = both(w.boxers.map((b) => ({ owner: b, names: [plain(b.name), ...(names[b.name] ? [plain(names[b.name])] : []), ...(variants.get(b.id) ?? [])] }))); per.set(names, idx); }
  return idx;
}

/** Head trainers by name, for the exact match: a name written in full is a trainer's even where a fighter's name is a slip away from it. */
const trainerIndex = new WeakMap<World, { name: string; n: string }[]>();
const trainersOf = (w: World) => {
  let idx = trainerIndex.get(w);
  if (!idx) { idx = [...w.people.values()].filter((p) => w.roles.get(p.id)?.has("trainer")).map((p) => ({ name: p.name, n: plain(p.name) })).filter((x) => x.n.length >= 5); trainerIndex.set(w, idx); }
  return idx;
};

interface Claimed { fighters: BoxerFull[]; /** the question with the fighters named exactly blotted out: what a trainer's name can still be found in */ rest: string }

/**
 * Fighters named in a question, in the order they appear. Names written in full claim their words first (a surname alone is ambiguous; longest first so
 * "Maximilian Hartmann" is not read as "Lukas Hartmann"; a trainer's full name is not taken for a fighter a slip away from it); then, in the words left, names with
 * a slip or two ("Lukas Hartmnan").
 */
function claim(w: World, names: Names, question: string): Claimed {
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
  const rest = q;
  for (const t of trainersOf(w)) if (q.includes(` ${t.n} `)) q = q.replace(` ${t.n} `, ` ${"·".repeat(t.n.length)} `);
  for (const n of nearNamed(nearFighters(w, names), q)) if (!hits.some((h) => h.b.id === n.owner.id)) hits.push({ b: n.owner, at: n.at });
  return { fighters: hits.sort((a, c) => a.at - c.at).map((h) => h.b), rest };
}

export const namesIn = (w: World, names: Names, question: string): BoxerFull[] => claim(w, names, question).fighters;

/** A trainer named in the question, if any (the trainers tool takes a name): in full, or with a slip or two in the spelling, in the words no fighter's full name has claimed. */
const trainerNear = new WeakMap<World, NearBoth<string>>();
function trainerNamed(w: World, question: string, rest: string): string | undefined {
  const idx = trainersOf(w);
  const q = ` ${plain(question)} `;
  const exact = idx.filter((x) => q.includes(` ${x.n} `)).sort((a, b) => b.n.length - a.n.length)[0]?.name;
  if (exact) return exact;
  let near = trainerNear.get(w);
  if (!near) { near = both(idx.map((x) => ({ owner: x.name, names: [x.n] }))); trainerNear.set(w, near); }
  return nearNamed(near, rest)[0]?.owner;
}

const has = (q: string, re: RegExp) => re.test(q);

/** Question -> list id, most specific first. English and Arabic wording; q is already normalised (folded, lower-case). */
const LISTS: [RegExp, string][] = [
  [/(fastest|quickest) (ever )?(knock ?outs?|kos?|finish(es)?|stoppages?)|اسرع.*(ضربه قاضيه|ايقاف|حسم)/, "fastest-kos"],
  [/most knockdowns|اكثر.*اسقاط/, "knockdowns"],
  [/most defen[cs]es in a (single )?reign|most dominant (title )?reigns?|اكثر.*(دفاع|دافع).*عهد/, "reign-defenses"],
  [/most (successful |title )?defen[cs]es|defended .*\bthe most\b|اكثر.*(دفاع|دافع)/, "defenses"],
  [/longest (title )?reign|(longest|most).*\b(held|hold|holding)\b.*(title|belt)|held .*(title|belt).*longest|اطول.*(عه[دو]|حكم|فتره حمل)/, "longest-reign"],
  [/most (world |major )?title (fight |bout )?wins|(won|win|winning) the most (world |major )?title (fights?|bouts?)|اكثر.*فوز.*(لقب|الالقاب)/, "title-wins"],
  [/biggest upsets?|greatest upsets?|biggest shocks?|most (one.sided |shocking |stunning |surprising )?(upsets?|shocks?)\b|most (surprising|shocking|stunning|unexpected) (results?|outcomes?|wins?|fights?)|اكبر.*مفاج/, "upsets"],
  [/(longest|best|biggest) (winning |win |unbeaten |undefeated )?(streak|run)|consecutive wins|اطول.*(سلسله|انتصارات متتاليه)/, "win-streak"],
  [/(highest|best) (ko|knockout) (rate|percentage|ratio)|knockout (rate|percentage|ratio)|(punches|hits) the hardest|hardest (puncher|hitter)s?|biggest punchers?|اعلي نسبه.*قاضيه/, "ko-rate"],
  [/most (technical )?(ko|knockout|stoppage)s?( wins| victories)?\b|(ko|knockout) leaders?|اكثر.*(ضربات? قاضيه|ك ?او)/, "kos"],
  [/most wins over (top|good|quality)|quality wins|(beaten|beat|defeated) the most (top|best|highly|quality|good)|(top|highly)[ -]rated (opponents|opposition)|(beaten|beat|defeated) the (best|highest|top)( rated)?|best (opposition|opponents)|(top|strongest|toughest) (opposition|opponents)/, "quality-wins"],
  [/multi.?division|champions? in (the )?most divisions|in (two|three|four) divisions|most (weight )?(classes|divisions)/, "divisions"],
  [/greatest (fights?|bouts?) (ever|of all time)|best fights? (ever|of all time)|اعظم النزالات/, "fights"],
  [/greatest (female |male |women.?s |men.?s )?(boxers?|fighters?)( of all time| ever)?|best (boxers?|fighters?) (of all time|ever)|goat\b|greatest of all time|اعظم (ملاكم|مقاتل)|افضل ملاكم في التاريخ/, "greatest"],
  [/(highest|best|top) (peak )?rating|(highest|best)[ -]rated (boxers?|fighters?) (ever|of all time|in history)|peak rating|highest rated ever|اعلي تصنيف/, "peak"],
  [/most wins\b|(won|win|winning) (the )?most(?! recent)|winningest|اكثر.*(انتصارات|فوز)/, "wins"],
];

/** Words that put a question outside boxing unless it also says something boxing-like. */
const OTHER_SPORTS = /\b(games?|football|soccer|basketball|baseball|tennis|golf|cricket|hockey|rugby|nba|nfl|formula ?1)\b/;

/** A stretch of time rather than one year: "since 2018", "in the 2010s", "this decade", "the last five years", "recently". The all-time lists have no way to cut one. */
const SPAN = /\b(since|after|before|until)\s+(19|20)\d\d\b|\b(19|20)\d0'?s\b|\b(the )?\d0s\b|\bthe (twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties|noughties|aughts)\b|\b(this|last|past|previous)\s+(decade|century)\b|\b(recent|last|past|previous)\s+(\w+\s+)?years\b|\brecently\b|\bnowadays\b/;
/** Places that are not countries: fighters are searched by country, not by region. */
const REGIONS = /\b(europe|european|europeans|asia|asian|asians|africa|african|africans|latin america|latino|latinos|south america|north america|oceania|scandinavia|scandinavian|middle east|arab|arabs|caribbean|balkans)\b/;
/** What a fighter search can be narrowed by that the record lists cannot (they take only a sex and a division). */
const GROUP_KEYS = ["stance", "country", "active", "undefeated", "minAge", "maxAge"];
/** The lists a fighter search can stand in for when the question narrows them to a group: sorted by the same thing. */
const LIST_AS_SORT: Record<string, string> = { wins: "wins", kos: "kos", "ko-rate": "koRate" };

/** Fighter words, to tell "knockouts since 2020" (a question about fights) from "fighters who debuted since 2020". */
const ABOUT_FIGHTERS = /\b(fighters?|boxers?|debut\w*|champions?|prospects?)\b/;
const ABOUT_FIGHTS = /\b(knockouts?|kos?|stoppages?|fights?|bouts?|decisions?|draws?|finishes)\b/;

export const ARABIC_FOLDED = /[؀-ۿ]/;

/** The no-key planner: turns a question into tool calls with patterns. It will not understand everything, and an unrecognised question yields no calls. */
export function planByRules(question: string, w: World, names: Names): Call[] {
  const q = normalize(question).replace(/[?؟!.]+$/g, "");
  // another sport, or a game: "who won the game last night" is not a question for the recent-events list
  if (has(q, OTHER_SPORTS) && !has(q, /box|fight|bout|ملاكم|نزال/)) return [];
  const countries = [...new Set(w.boxers.map((b) => b.country))];
  const f = heuristicParse(question, countries);
  const year = q.match(/\b(20\d\d)\b/)?.[1];
  const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20 };
  const limitMatch = q.match(/\b(?:top|first|best)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\b/);
  // "أفضل ثلاثة ملاكمين": the number of the best, in digits or in words (folded: ة is ه)
  const AR_NUMBERS: Record<string, number> = { اثنين: 2, ثلاثه: 3, اربعه: 4, خمسه: 5, سته: 6, سبعه: 7, ثمانيه: 8, تسعه: 9, عشره: 10 };
  const arLimit = q.match(/(?:افضل|اقوي|اعلي)\s+(\d{1,2}|اثنين|ثلاثه|اربعه|خمسه|سته|سبعه|ثمانيه|تسعه|عشره)\s/)?.[1];
  const limit = limitMatch ? Math.min(25, WORD_NUMBERS[limitMatch[1]] ?? +limitMatch[1]) : arLimit ? Math.min(25, AR_NUMBERS[arLimit] ?? +arLimit) : undefined;
  const scope = { ...(f.sex ? { sex: f.sex } : {}), ...(f.weightClass ? { division: f.weightClass } : {}) };
  const withLimit = (a: Record<string, unknown>) => (limit ? { ...a, limit } : a);
  const { fighters, rest } = claim(w, names, question);
  // a region is not a country the data has: "the best welterweight from South America" answered with every welterweight would look right and be wrong
  if (!fighters.length && has(q, REGIONS)) return [];
  let trainerFound: { name: string | undefined } | undefined;
  const trainer = () => (trainerFound ??= { name: trainerNamed(w, question, rest) }).name;

  if (fighters.length >= 2 && !has(q, /\bmost\b|\bhighest\b/)) return [{ tool: "head_to_head", args: { a: fighters[0].name, b: fighters[1].name } }];

  const filters = () => ({ tool: "fighters", args: withLimit(Object.fromEntries(Object.entries(f).filter(([k]) => k !== "text"))) });
  const numeric = f.minWins !== undefined || f.minKOs !== undefined || f.minKoRate !== undefined || f.minReach !== undefined || f.undefeated;
  // "fighters with more than 20 wins and a knockout rate over 70%" is a search, even though "knockout rate" is also the name of a list
  if (!fighters.length && numeric && has(q, /\b(fighters?|boxers?) (with|who|that)\b/)) return [filters()];

  if (has(q, /fight of the year|(best|greatest) (fight|bout) of|(afdal|افضل|اعظم) نزال في|نزال العام/)) return [{ tool: "fight_of_the_year", args: withLimit(year ? { year: +year } : {}) }];
  if (has(q, /upcoming.*(upset|underdog)|underdogs?\b|upset watch|(could|might|may) (be )?upset|upsets? (are )?(coming|expected)|favou?rites? .*(lose|beaten|upset|vulnerable|shaky|wobbl\w*|at risk|in (danger|trouble))|(look|looks|looking) (shaky|vulnerable)|\bin (danger|trouble)\b|at risk of (losing|being)|مفاج\S*\s+(ال)?(محتمل|متوقع)\S*|(ال)?(محتمل|متوقع)\S*\s+(ال)?مفاج|(could|might|may|going to) (get |be |getting )?(upset|beaten)|(produce|cause|spring|pull off) an? (shock|upset)|could .*\b(shock|upset)\b|(most )?likely to (lose|be beaten|be upset)|shock results?|danger fights?|مفاجاه محتمله|الاقل ترجيحا/)) return [{ tool: "upset_watch", args: withLimit({}) }];

  // completed fights of a year or the title fights, by how they ended: "knockouts in 2025", "title fights this year", "fastest finishes of 2024"
  const thisYear = Number(w.today.slice(0, 4));
  // "since 2018" or "in the 2010s" is a stretch of years: it is not the year it mentions, and nothing here can cut a stretch
  const span = has(q, SPAN);
  const boutYear = span ? undefined : year ? +year : has(q, /\bthis year\b/) ? thisYear : has(q, /\blast year\b/) ? thisYear - 1 : undefined;
  if (span && has(q, ABOUT_FIGHTS) && !has(q, ABOUT_FIGHTERS)) return [];
  const recently = has(q, /\b(recent|latest|newest)\b/) && has(q, /\b(knockouts?|kos?|stoppages?|decisions?)\b/);
  if ((boutYear || recently || has(q, /title fights?/)) && has(q, /\b(fights?|bouts?|knockouts?|kos?|stoppages?|finishes|decisions?|draws?)\b|ضربات? (ال)?قاضيه|نزالات|تعادل/) && !has(q, /\b(most|highest|longest|biggest|greatest|upcoming|next|coming)\b|fight of the year|best fights?|اكثر|اعلي|اطول|اكبر|اعظم|اسرع|افضل|القادم/)) {
    return [{ tool: "bouts", args: withLimit({
      ...(boutYear ? { year: boutYear } : {}), ...(scope.division ? { division: scope.division } : {}),
      ...(has(q, /title fights?/) ? { title: true } : {}),
      ...(has(q, /knockouts?|\bkos?\b|stoppages?|finishes|ضربات? (ال)?قاضيه/) ? { method: "stoppage" } : has(q, /decisions?/) ? { method: "decision" } : has(q, /draws?|تعادل/) ? { method: "DRAW" } : {}),
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
    if (boutYear || span) return [];
    // nor can they be cut to a group they do not know ("among southpaws", "in Japan", "among active fighters"): answered as asked they would be the list for everybody. A fighter
    // search can honour the group for the three lists it can sort by; for the rest there is no answer
    // ("unbeaten" in "longest unbeaten run" is the list, not a group of unbeaten fighters)
    const group = GROUP_KEYS.some((k) => k in f && !(k === "undefeated" && list === "win-streak"));
    if (group) return LIST_AS_SORT[list] ? [{ tool: "fighters", args: withLimit({ ...Object.fromEntries(Object.entries(f).filter(([k]) => k !== "text")), sort: LIST_AS_SORT[list], ...(list === "ko-rate" && f.minWins === undefined ? { minWins: 15 } : {}) }) }] : [];
    return [{ tool: "record_list", args: withLimit({ list, ...scope }) }];
  }

  if (has(q, /(highest|biggest|top|largest) (live )?(gate|gates)|gate record|(most expensive|priciest) tickets?|ticket (sales|revenue)|gate (receipts?|takings?|revenue)|اعلي.*(ايرادات? بوابه|بوابه)/)) return [{ tool: "money", args: withLimit({ kind: "gates" }) }];
  if (has(q, /pay.?per.?view|\bppv\b|بي ?بي ?في/)) return [{ tool: "money", args: withLimit({ kind: "ppv" }) }];
  if (has(q, /(biggest|highest|largest) purses?|highest.paid|best.paid|paydays?|paychecks?|اعلي.*(اجر|مكافاه)/)) return [{ tool: "money", args: withLimit({ kind: "purses" }) }];
  if (has(q, /(highest|top|biggest) earners?|top.paid|who earns the most|earns? the most|how much (do|does|did) (boxers?|fighters?) (make|earn)|اعلي.*(دخل|رواتب|اجور|مكافات)|(رواتب|اجور|مكافات|دخل).*(اعلي|الاعلي|اكبر)/)) return [{ tool: "money", args: withLimit({ kind: "earners" }) }];

  if (has(q, /champs?\b|champions?\b|title.?holders?|who holds|holds the|belt.?holders?|بطل|ابطال|حامل|يحمل|حزام|احزمه/) && !fighters.length) return [{ tool: "champions", args: scope }];
  if (has(q, /trainer|coach|مدرب/) && (!fighters.length || trainer())) {
    const typed = question.match(/(?:trainer|coach|مدرب)\s+([\p{L}.'\- ]{4,40})/iu)?.[1]?.trim();
    const name = trainer() ?? (typed && !has(normalize(typed), /^(impact|effect|the|best)/) ? typed : undefined);
    return [{ tool: "trainers", args: withLimit(name ? { name } : {}) }];
  }
  if (!fighters.length && trainer()) return [{ tool: "trainers", args: withLimit({ name: trainer() }) }];
  // one fighter named: what is asked about him is on his page, whatever else the sentence mentions ("what was X's last fight")
  if (fighters.length === 1) return [{ tool: "fighter", args: { name: fighters[0].name } }];

  // "the best three middleweights", in Arabic: the ranking of the division
  if (scope.division && has(q, /(افضل|اقوي)\s*(\d+|\S+)?\s*(ملاكم|ملاكمين|ملاكمون|ملاكمات)/)) return [{ tool: "rankings", args: withLimit(scope) }];
  if (f.archetype && !has(q, /rank|pound.for.pound|p4p/)) return [filters()];
  if (has(q, /new to boxing|who should i (know|watch|follow)|where (do|should) i (start|begin)/)) return [{ tool: "rankings", args: withLimit({}) }];
  // "top 5 southpaws": a ranking is by division; a group of fighters from anywhere is a search
  if (GROUP_KEYS.some((k) => k in f) && has(q, /\btop \d+\b|\bbest\b|\bhighest rated\b/) && !has(q, /pound.for.pound|\bp4p\b/)) return [filters()];
  if (has(q, /rankings?\b|ranked\b|top \d+|pound.for.pound|\bp4p\b|تصنيف|ترتيب/)) return [{ tool: "rankings", args: withLimit(scope) }];
  if (has(q, /(upcoming|next|coming up|future) (fights?|events?|cards?|shows?)|fight calendar|schedule|(what|which) (fights?|cards?|boxing|events?|bouts?) (is |are )?(on|coming|scheduled|happening|next)|who.?s (fighting|boxing)( next| tonight| this)?|who headlines|headliners?|next (big |major |title )?(fight|bout|card)|coming up|boxing is on|on this (week|month|weekend)|this weekend|tonight|next (week|month)|القادمه|القادم|جدول/)) return [{ tool: "events", args: withLimit({ when: "upcoming" }) }];
  if (has(q, /(recent|latest|last|most recent) (boxing |fight )?(fights?|events?|cards?|results?)|results? of the (most )?(recent|latest|last)|last (night|weekend)|yesterday|who won the most recent|اخر (نزالات|النزالات|الفعاليات|فعاليه|فعاليات|نتايج|نتيجه)|نتايج (اخر|الفعاليات)|(النزالات|الفعاليات|النتايج) الاخيره/)) return [{ tool: "events", args: withLimit({ when: "recent" }) }];

  const filterKeys = Object.keys(f).filter((k) => k !== "text");
  // a lone sort ("best") is only a search when the question is about fighters at all
  // a country alone is not a question about boxers ("how many people live in Mexico"): a search needs a word about boxing, or another filter
  const bareCountry = filterKeys.length === 1 && filterKeys[0] === "country" && !has(q, /box|fight|champ|prospect|ملاكم|مقاتل|نزال|بطل/);
  if (bareCountry) return [];
  if (filterKeys.some((k) => k !== "sort") || (f.sort && f.sort !== "rating") || (filterKeys.length && has(q, /\b(fighters?|boxers?|champs?|champions?|prospects?)\b|ملاكم/))) return [{ tool: "fighters", args: withLimit(Object.fromEntries(Object.entries(f).filter(([k]) => k !== "text"))) }];
  return [];
}

/**
 * Why a question the planner could not answer got no answer, when there is a particular reason worth telling the person (otherwise the generic
 * "I could not match that question"): a year, or a stretch of years, asked of a list that has no time in it; or a group of fighters (southpaws, a country, the
 * retired) asked of a list that cannot be cut to one. Each is better refused than answered for everybody and all of history.
 */
export function refusalReason(question: string): "year" | "span" | "group" | null {
  const q = normalize(question).replace(/[?؟!.]+$/g, "");
  const list = LISTS.some(([re]) => has(q, re));
  const span = has(q, SPAN);
  if (span && ABOUT_FIGHTS.test(q) && !ABOUT_FIGHTERS.test(q)) return "span";
  const yearly = !span && (/\b20\d\d\b/.test(q) || has(q, /\bthis year\b|\blast year\b/));
  if (yearly && list) return "year";
  if (list && span) return "span";
  const listId = LISTS.find(([re]) => has(q, re))?.[1];
  if (list && (has(q, REGIONS) || GROUP_KEYS.some((k) => k in heuristicParse(question, []) && !(k === "undefeated" && listId === "win-streak")))) return "group";
  return null;
}
