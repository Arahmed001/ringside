import type { World } from "../world";
import type { BoxerFull } from "../types";
import { heuristicParse, type Filters } from "../ai";
import { westernize } from "../search-quantities-ar";
import { normalize } from "../fighter-search";
import { allowedSlips, editDistance, wordsOf } from "../fuzzy";
import type { Names } from "../i18n/t";
import type { Call } from "./types";
import { FIGHTER_FACTS, type FighterFact } from "./tools";

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
  [/most knockdowns|اكثر(?! من \d).*اسقاط/, "knockdowns"],
  [/most defen[cs]es in a (single )?reign|most dominant (title )?reigns?|اكثر(?! من \d).*(دفاع|دافع).*عهد/, "reign-defenses"],
  [/most (successful |title )?defen[cs]es|defended .*\bthe most\b|اكثر(?! من \d).*(دفاع|دافع)/, "defenses"],
  [/longest (title )?reign|(longest|most).*\b(held|hold|holding)\b.*(title|belt)|held .*(title|belt).*longest|اطول.*(عه[دو]|حكم|فتره حمل)/, "longest-reign"],
  [/most (world |major )?title (fight |bout )?wins|most title (fights?|bouts?) won|(won|win|winning) the most (world |major )?title (fights?|bouts?)|اكثر(?! من \d).*فوز.*(لقب|الالقاب)/, "title-wins"],
  [/biggest upsets?|greatest upsets?|biggest shocks?|most (one.sided |shocking |stunning |surprising )?(upsets?|shocks?)\b|most (surprising|shocking|stunning|unexpected) (results?|outcomes?|wins?|fights?)|اكبر.*مفاج/, "upsets"],
  [/(longest|best|biggest) (winning |win |unbeaten |undefeated )?(streak|run)|consecutive wins|اطول.*(سلسله|انتصارات متتاليه)/, "win-streak"],
  [/(highest|best) (ko|knockout) (rate|percentage|ratio)|knockout (rate|percentage|ratio)|(punches|hits) the hardest|hardest (puncher|hitter)s?|biggest punchers?|اعلي نسبه.*قاضيه/, "ko-rate"],
  [/most (technical )?(ko|knockout|stoppage)s?( wins| victories)?\b|(ko|knockout) leaders?|اكثر(?! من \d).*(ضربات? قاضيه|ك ?او)/, "kos"],
  [/most wins over (top|good|quality)|quality wins|(beaten|beat|defeated) the most (top|best|highly|quality|good)|(top|highly)[ -]rated (opponents|opposition)|(beaten|beat|defeated) the (best|highest|top)( rated)?|best (opposition|opponents)|(top|strongest|toughest) (opposition|opponents)/, "quality-wins"],
  [/multi.?division|champions? in (the )?most divisions|in (two|three|four) divisions|most (weight )?(classes|divisions)/, "divisions"],
  [/greatest (fights?|bouts?) (ever|of all time)|best fights? (ever|of all time)|اعظم النزالات/, "fights"],
  [/greatest (female |male |women.?s |men.?s )?(boxers?|fighters?)( of all time| ever)?|best (boxers?|fighters?) (of all time|ever)|goat\b|greatest of all time|اعظم (ملاكم|مقاتل)|افضل ملاكم في التاريخ/, "greatest"],
  [/(highest|best|top) (peak )?rating|(highest|best)[ -]rated (boxers?|fighters?) (ever|of all time|in history)|peak rating|highest rated ever|اعلي تصنيف/, "peak"],
  [/most wins\b|(won|win|winning) (the )?most(?! recent)|winningest|اكثر(?! من \d).*(انتصارات|فوز)/, "wins"],
];

/** Words that put a question outside boxing unless it also says something boxing-like. */
const OTHER_SPORTS = /\b(games?|football|soccer|basketball|baseball|tennis|golf|cricket|hockey|rugby|nba|nfl|formula ?1)\b/;

/** A stretch of time rather than one year: "since 2018", "in the 2010s", "this decade", "the last five years", "recently". The all-time lists have no way to cut one. */
const SPAN = /\b(since|after|before|until)\s+(19|20)\d\d\b|\b(19|20)\d0'?s\b|\b(the )?\d0s\b|\bthe (twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties|noughties|aughts)\b|\b(this|last|past|previous)\s+(decade|century)\b|\b(recent|last|past|previous)\s+(\w+\s+)?years\b|\brecently\b|\bnowadays\b/;
/** Places that are not countries: fighters are searched by country, not by region. */
const REGIONS = /\b(europe|european|europeans|asia|asian|asians|africa|african|africans|latin america|latino|latinos|south america|north america|oceania|scandinavia|scandinavian|middle east|arab|arabs|caribbean|balkans)\b/;
/** What a fighter search can be narrowed by that the record lists cannot (they take only a sex and a division). */
const GROUP_KEYS = ["stance", "country", "active", "undefeated", "minAge", "maxAge", "maxWins", "maxKOs", "minLosses", "maxLosses", "minBouts", "maxBouts", "minStopped", "maxStopped", "minDraws", "maxDraws", "minWinStreak", "minLossStreak", "unbeatenIn", "lastFightAfter", "lastFightBefore", "record", "champion", "minReach", "maxReach", "minHeight", "maxHeight"];
/** The facts about a fighter's record and form the fighter search can cut by (round 53). */
const RECORD_KEYS = ["minStopped", "maxStopped", "minDraws", "maxDraws", "minWinStreak", "minLossStreak", "unbeatenIn", "lastFightAfter", "lastFightBefore"];
/** The lists that are about champions already: "champion" in the question names them, it does not narrow them ("who has the most defences" is not "among champions"). */
const CHAMPION_LISTS = ["reign-defenses", "defenses", "longest-reign", "title-wins"];
/** Whether the question narrows a record list to a group the list cannot be cut to. */
const narrowsList = (f: Filters, list: string | undefined) =>
  GROUP_KEYS.some((k) => k in f && !(k === "undefeated" && list === "win-streak") && !(k === "champion" && f.champion === "current" && !!list && CHAMPION_LISTS.includes(list)));
/** The lists a fighter search can stand in for when the question narrows them to a group: sorted by the same thing. */
const LIST_AS_SORT: Record<string, string> = { wins: "wins", kos: "kos", "ko-rate": "koRate" };

/** Fighter words, to tell "knockouts since 2020" (a question about fights) from "fighters who debuted since 2020". */
const ABOUT_FIGHTERS = /\b(fighters?|boxers?|debut\w*|champions?|prospects?)\b/;
const ABOUT_FIGHTS = /\b(knockouts?|kos?|stoppages?|fights?|bouts?|decisions?|draws?|finishes)\b/;

/**
 * The one fact a question about one fighter asks for, if it asks for one: "how tall is X", "who trains X", "when does X fight next", "what is X's knockout rate".
 * The most specific wording first ("how many knockouts" is knockouts, not the record). Folded text, English and Arabic.
 */
const FACT_ASKED: [RegExp, FighterFact][] = [
  [/\bnext (fight|bout|opponent)\b|\bfights?\b.*\bnext\b|\bwhen (does|is|will)\b.*\bfight\b|\bupcoming (fight|bout)\b|\bfight(ing)? (again|soon)\b|\bfight soon\b|نزاله القادم|نزال القادم|نزال\S*\s+(?:\S+\s+){0,3}القادم|متي (?:ينزل|يقاتل|سيقاتل|يلعب)/, "next_fight"],
  [/\blast (fight|bout|opponent)\b|\bmost recent (fight|bout)\b|\bwhen did\b.*\b(last )?(fight|box)\b|\b(fought|fight|box|boxed) last\b|\blast (fought|boxed)\b|اخر نزال|قاتل\S*\s+(?:\S+\s+){0,3}اخر مره|اخر مره\s+(?:قاتل|لعب|نزل)/, "last_fight"],
  [/سلسله|اطول فتره انتصارات/, "streak"],
  [/\bwhen did\b.*\b(turn|go|went) pro\b|\b(turned|went) pro\b|\bpro(fessional)? debut\b|\bdebut(ed)?\b|\bfirst pro(fessional)? fight\b|\bhow long\b.*\bpro\b|احترف|متي بدا|سنه الاحتراف|اول نزال احترافي/, "debut"],
  [/\bnicknames?\b|\bnicknamed\b|\bknown as\b|\bgoes by\b|\bcalled\b|اسم الشهره|ما لقب|لقبه|يلقب|ملقب/, "nickname"],
  [/\b(fighting |boxing )?style\b|\bwhat kind of (fighter|boxer)\b|\barchetype\b|اسلوب|نمط قتال/, "style"],
  [/\bpromoter\b|\bpromoted by\b|\bwho promotes\b|\bpromotion (company|firm)\b|مروج|شركه ترويج/, "promoter"],
  [/\bstreaks?\b|\bwinning run\b|\bwin run\b|\bon a roll\b|\bhow many (in a row|straight)\b/, "streak"],
  [/\bdecisions?\b|\bgone the distance\b|\bgo the distance\b|\bon (the )?scorecards?\b|بالنقاط|بالقرار|قرار الحكام/, "decisions"],
  [/\bhow tall\b|\bheight\b|\btall is\b|\b(taller|shorter)\b|طول/, "height"],
  [/\breach\b|\barms?( span| length)?\b|امتداد|مدي الذراع/, "reach"],
  [/\bhow old\b|\b(older|younger)\b|\bages?\b|\bborn\b|\bbirth(day| year| date)?\b|كم عمر|عمر|اكبر سنا|اصغر سنا/, "age"],
  [/\bsouthpaw\b|\borthodox\b|\bstance\b|\bleft.?handed\b|\bright.?handed\b|\blefty\b|اعسر|وقفه/, "stance"],
  [/\bwhere (is|was)\b.*\bfrom\b|\bnationality\b|\bwhich country\b|\bcountry\b|جنسيه|من اي بلد/, "country"],
  [/\bgym\b|\bwhere does\b.*\btrain\b|\btrains? at\b|صاله/, "gym"],
  [/\btrainer\b|\bcoach(es|ed)?\b|\bwho trains\b|\btrained by\b|مدرب|يدرب|دربه/, "trainer"],
  [/\btitle (fights?|bouts?)\b|\btitle (record|wins)\b|\bfor a (world )?title\b|\bwon (a|the) (world )?title\b/, "title_fights"],
  [/\bmanager\b|\bagent\b|\bwho manages\b|\bmanaged by\b/, "manager"],
  [/\bbelts?\b|\btitles?\b(?! (fights?|bouts?|wins?))|\bchampion\b|\bchamp\b|\bholds?\b|حزام|لقب/, "belts"],
  [/\bknocked out\b|\bko'?d\b|\bstopped\b|\blost by (a )?(ko|knockout|stoppage)\b|\bever been (ko|knocked)/, "stopped"],
  [/\bknockouts?\b|\bkos?\b|\bko (rate|percentage)\b|ضربات (ال)?قاضيه/, "knockouts"],
  [/\brating\b|\brated\b|\belo\b|\brank(ed|ing)?\b|\bhow good\b|تصنيف|ترتيب/, "rating"],
  [/\bdivision\b|\bweight class\b|\bwhat weight\b|\bwhich weight\b|وزن/, "division"],
  [/\bretired\b|\bstill (fighting|boxing|active)\b|\bactive\b|\bundefeated\b|\bunbeaten\b|\bever lost\b|\bever been beaten\b|\bany losses\b|\bperfect\b|\blost a (fight|bout)\b|\bever (been )?defeated\b|معتزل|ما زال نشط|لا يزال نشط/, "status"],
  [/\brecord\b|\bhow many (fights?|bouts?|wins?|losses|times)\b|\b(more|fewer) (wins|losses|fights|bouts)\b|\b(fought|won|lost) more\b|\bexperience[d]?\b|سجل|كم نزال|كم فوز/, "record"],
];
/** The facts two fighters can be asked about together (every one but the next and last fight), and the wording that makes a question about how they met (a head to head) and not about the facts. */
const COMPARABLE = new Set<FighterFact>(FIGHTER_FACTS.filter((f) => f !== "next_fight" && f !== "last_fight")); // (two names and "when does A fight B" is about a bout between them)
const MEETING = /\bagainst\b|\bbeat(en|s)?\b|\bmet\b|\bwould win\b|\bwho wins\b|\beach other\b|\bever fought\b/;
const SUPERLATIVE = /\b(most(?! recent)|highest|best|longest|top|worst|lowest|fewest|fastest|greatest)\b/;

const CARDINALS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
/** The place a question asks for in a ranking: "number two", "ranked third", "the 3rd best", "fifth best". Only where the question is about rankings at all. */
function placeAsked(q: string): number | undefined {
  if (!has(q, /\b(ranked|ranking|rankings|best|number|contender|pound.for.pound|p4p|in the world|rated|place|sits?|sitting|spot|position)\b/)) return undefined;
  const word = q.match(/\b(?:number|no\.?|#|ranked|rated)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\b/)?.[1] ?? q.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2}(?:st|nd|rd|th))\b/)?.[1];
  const n = word ? CARDINALS[word] ?? ORDINALS[word] ?? parseInt(word, 10) : undefined;
  return n && n >= 1 && n <= 25 ? n : undefined;
}

export const ARABIC_FOLDED = /[؀-ۿ]/;

/** The no-key planner: turns a question into tool calls with patterns. It will not understand everything, and an unrecognised question yields no calls. */
export function planByRules(question: string, w: World, names: Names): Call[] {
  const q = westernize(normalize(question)).replace(/[?؟!.]+$/g, "");
  // another sport, or a game: "who won the game last night" is not a question for the recent-events list
  if (has(q, OTHER_SPORTS) && !has(q, /box|fight|bout|ملاكم|نزال/)) return [];
  const countries = [...new Set(w.boxers.map((b) => b.country))];
  const f = heuristicParse(question, countries, w.today);
  const year = q.match(/\b(20\d\d)\b/)?.[1];
  const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20 };
  const limitMatch = q.match(/\b(?:top|first|best)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\b/);
  // "أفضل ثلاثة ملاكمين": the number of the best, in digits or in words (folded: ة is ه)
  const AR_NUMBERS: Record<string, number> = { اثنين: 2, ثلاثه: 3, اربعه: 4, خمسه: 5, سته: 6, سبعه: 7, ثمانيه: 8, تسعه: 9, عشره: 10 };
  const arLimit = q.match(/(?:افضل|اقوي|اعلي)\s+(\d{1,2}|اثنين|ثلاثه|اربعه|خمسه|سته|سبعه|ثمانيه|تسعه|عشره)\s/)?.[1];
  const limit = limitMatch ? Math.min(25, WORD_NUMBERS[limitMatch[1]] ?? +limitMatch[1]) : arLimit ? Math.min(25, AR_NUMBERS[arLimit] ?? +arLimit) : undefined;
  const scope = { ...(f.sex ? { sex: f.sex } : {}), ...(f.weightClass ? { division: f.weightClass } : {}) };
  // a cut beyond division and sex ("top 5 welterweights with more than 10 wins"): the rankings have none, so the answer is a fighter search, not the ranking with the cut left out
  const cut = Object.keys(f).some((k) => !["weightClass", "sex", "sort", "text"].includes(k) && !(k === "champion" && f.champion === "current"));
  const withLimit = (a: Record<string, unknown>) => (limit ? { ...a, limit } : a);
  const { fighters, rest } = claim(w, names, question);
  // a region is not a country the data has: "the best welterweight from South America" answered with every welterweight would look right and be wrong
  if (!fighters.length && has(q, REGIONS)) return [];
  // counts and facts of the coming cards that the events list does not give ("how many cards are scheduled this month", "how many fights does the next card have"), and a belt's history or kind: no answer, not the latest card, every champion or a fighter search
  if (!fighters.length && has(q, /\bhow many\b.*\b(cards?|events?|shows?)\b.*\b(scheduled|upcoming|coming|next|planned|this (week|month|year)|does the next|has the next)\b|\bhow many\b.*\b(does|has|will)\b.*\b(next|upcoming)\b.*\b(card|event)\b/)) return [];
  if (!fighters.length && has(q, /موقت|شاغر|تغير حامل|تغيير حامل|\b(interim|vacant|stripped|unified)\b|\bchanged hands\b|\bhow many times has\b.*\b(title|belt)\b|\bhow many (world )?(titles|belts)\b/)) return [];
  // groupings no tool makes: by venue, by country ("which country has the most champions"), by round ("fights that ended in the first round"): no answer, not a list of
  // fighters sorted by fights, the list of champions or every fight
  if (!fighters.length && has(q, /\b(venues?|arenas?|stadiums?|cit(?:y|ies))\b/) && !has(q, /\b(gates?|tickets?|revenue|purses?|earn\w*|paid|attendance)\b/) && has(q, /\b(most|more|biggest|largest|best|top)\b/)) return [];
  if (!fighters.length && has(q, /\b(which|what)\s+(countr(?:y|ies)|nations?)\b/) && has(q, /\b(most|more|best|top|biggest)\b/)) return [];
  if (!fighters.length && has(q, /\b(?:in|by|during|within)\s+(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d+(?:st|nd|rd|th))\s+round\b|\bround\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/)) return [];
  // the same in Arabic: who beat, stopped or knocked out someone; and who trains, manages or runs the most champions
  if (!LISTS.some(([re]) => has(q, re)) && has(q, /(?:^|\s)من\s+(?:هزم|هزمه|فاز علي|تغلب علي|خسر امام|اسقط|اوقف|تفوق علي)/)) return [];
  if (!fighters.length && has(q, /(?:مدرب|يدرب\S*|دربه|صاله|صالات|مدير اعمال|يدير|منظم|يروج)/) && has(q, /(?:اكثر|اغلب)/) && has(q, /(?:ابطال|بطل|احزمه|حزام|القاب)/)) return [];
  // who beat someone, or whom someone lost to: no tool lists a fighter's opponents by result, and the fighter's profile (what it had answered) is not the answer
  if (!LISTS.some(([re]) => has(q, re)) && (has(q, /\bwho\s+(?:has\s+|have\s+|ever\s+|had\s+)?(?:beat|beaten|defeated|knocked out|ko'?d|stopped|lost to|drew with)\b/) || has(q, /\bwho\s+(?:did|has|have)\s+.{2,40}?\s+(?:beat|defeat|lose to|lost to|draw with|knock out|stop)\b/))) return [];
  // a place in a ranking ("who is ranked number two at welterweight", "the third best heavyweight"): the fighter in that place, not the number one
  if (!fighters.length) {
    const place = placeAsked(question.toLowerCase()); // (the raw question: "3rd" is folded to "iii" in the normalised one)
    if (place && !cut && (scope.division || has(q, /pound.for.pound|\bp4p\b|in the world|in boxing|overall/))) return [{ tool: "rankings", args: { ...scope, ...(place > 1 ? { position: place } : {}) } }];
  }
  // the facts about champions and the people behind them that no tool aggregates: no answer, not the list of champions
  const champ = has(q, /\b(champions?|champs?|title.?holders?|belt.?holders?)\b/);
  if (!fighters.length && champ && has(q, /\b(youngest|oldest)\b/)) return [{ tool: "champions", args: { ...scope, by: has(q, /\byoungest\b/) ? "youngest" : "oldest" } }];
  if (!fighters.length && champ && has(q, /\b(tallest|shortest|heaviest)\b/)) return [];
  // an average of anything is not in the data's tools: no answer, not the list it is an average of
  if (!fighters.length && has(q, /\b(average|mean|median)\b/) && has(q, /\b(height|age|reach|weight|rating|wins|knockouts|fights)\b/)) return [];
  if (!fighters.length && has(q, /\b(gyms?|trainers?|trains?|trained|coach(es|ed)?|managers?|manages|managed|promoters?|promoted)\b/) && has(q, /\b(most|more)\b/) && has(q, /\b(champions?|belts?|titles?)\b/)) return [];
  // how many: a count of what is asked ("how many fighters are there", "how many southpaw heavyweights", "how many events in 2024")
  if (!fighters.length && has(q, /\bhow many (fighters|boxers)\b/)) return [{ tool: "fighters", args: Object.fromEntries(Object.entries(f).filter(([k]) => k !== "text" && k !== "sort")) }];
  if (!fighters.length && has(q, /\bhow many (events|cards|shows)\b/)) return [{ tool: "events", args: year ? { year: +year } : { when: "all" } }];
  let trainerFound: { name: string | undefined } | undefined;
  const trainer = () => (trainerFound ??= { name: trainerNamed(w, question, rest) }).name;
  // "how many fighters are trained by X", "managed by X": the team filter, even when X is also a fighter in the data
  if ((f.trainer || f.manager || f.promoter || f.gym) && has(q, /\b(trained|coached|managed|promoted|signed) by\b|\bout of the\b/)) return [{ tool: "fighters", args: withLimit(Object.fromEntries(Object.entries(f).filter(([k]) => k !== "text"))) }];

  // two fighters and one fact between them ("who is taller, A or B", "A vs B reach"): their two answers side by side, not a prediction of who would win
  if (fighters.length === 2 && !has(q, MEETING)) {
    const about = FACT_ASKED.find(([re, fact]) => COMPARABLE.has(fact) && has(q, re))?.[1];
    if (about) return fighters.map((b) => ({ tool: "fighter", args: { name: b.name, about } }));
  }
  if (fighters.length >= 2 && !has(q, /\bmost\b|\bhighest\b/)) return [{ tool: "head_to_head", args: { a: fighters[0].name, b: fighters[1].name } }];

  // a fighter's knockdowns are not in the data (only a fight's): "how many times has X been knocked down" is no answer, not the record
  if (fighters.length === 1 && has(q, /\bknocked down\b|\bknockdowns? (suffered|taken|scored)\b/)) return [];
  // one fighter named and one fact asked ("how tall is X", "what is X's knockout rate"): the answer is that fact, not the profile and not a list for everybody
  if (fighters.length === 1 && (!has(q, SUPERLATIVE) || has(q, /\bstreaks?\b|\bwinning run\b|\bwin run\b/))) {
    const about = FACT_ASKED.find(([re]) => has(q, re))?.[1];
    // (a trainer named in a question that says "trainer" is the trainers tool's question, even when a fighter has nearly the same name)
    if (about && !(about === "trainer" && trainer())) return [{ tool: "fighter", args: { name: fighters[0].name, about } }];
  }

  const filters = () => ({ tool: "fighters", args: withLimit(Object.fromEntries(Object.entries(f).filter(([k]) => k !== "text"))) });
  const numeric = f.minWins !== undefined || f.minKOs !== undefined || f.minKoRate !== undefined || f.minReach !== undefined || f.undefeated;
  // "fighters with more than 20 wins and a knockout rate over 70%" is a search, even though "knockout rate" is also the name of a list
  // (but "unbeaten" in "the longest unbeaten run among fighters who …" is the streak list, which is answered or refused below)
  if (!fighters.length && numeric && has(q, /\b(fighters?|boxers?) (with|who|that)\b/) && !has(q, /(longest|best|biggest) (winning |win |unbeaten |undefeated )?(streak|run)/)) return [filters()];

  if (has(q, /fight of the year|(best|greatest) (fight|bout) of|(afdal|افضل|اعظم) نزال في|نزال العام/)) return [{ tool: "fight_of_the_year", args: withLimit(year ? { year: +year } : {}) }];
  // a question about a fighter's record or form ("who lost their last fight", "never been stopped", "fought in the last 6 months") is a fighter search: the events and fights lists have no such cut
  // how someone's last fights ended ("lost their last fight by knockout") is not a cut either tool has: no answer, not the events list and not everyone who lost
  if (!fighters.length && has(q, /(?:خسر|فاز|انتصر|هزم)\S*\s+(?:في |ب)?نزاله[من]\S*\s+(?:الاخير|الاخيره)\s+(?:ب|عن طريق|امام|ضد)/)) return [];
  if (!fighters.length && has(q, /\b(lost|won|drew)\s+(their|his|her)\s+(last|most recent|previous)\b.*\b(by|via|in)\s+(a\s+)?(knockout|ko|tko|decision|stoppage|round|points|split|unanimous)/)) return [];
  // (with an events word in it ("upcoming fights of fighters on a streak") no tool has both: no answer, not the list of events with the cut left out)
  // (a record list, "the longest winning streak among welterweights who have never been stopped", is the list's to answer or refuse: it cannot be cut by the fact, and a search sorted by rating would drop "longest")
  if (!fighters.length && RECORD_KEYS.some((k) => k in f) && !LISTS.some(([re]) => has(q, re))) return has(q, /\b(upcoming|next|recent|latest|results?|cards?|events?|schedule|calendar)\b|قادم|نتايج|فعاليه|فعاليات|بطاقه|جدول/) ? [] : [filters()];
  if (has(q, /upcoming.*(upset|underdog)|underdogs?\b|upset watch|(could|might|may) (be )?upset|upsets? (are )?(coming|expected)|favou?rites? .*(lose|beaten|upset|vulnerable|shaky|wobbl\w*|at risk|in (danger|trouble))|(look|looks|looking) (shaky|vulnerable)|\bin (danger|trouble)\b|at risk of (losing|being)|مفاج\S*\s+(ال)?(محتمل|متوقع)\S*|(ال)?(محتمل|متوقع)\S*\s+(ال)?مفاج|(could|might|may|going to) (get |be |getting )?(upset|beaten)|(produce|cause|spring|pull off) an? (shock|upset)|could .*\b(shock|upset)\b|(most )?likely to (lose|be beaten|be upset)|shock results?|danger fights?|مفاجاه محتمله|الاقل ترجيحا/)) return [{ tool: "upset_watch", args: withLimit({}) }];

  // completed fights of a year or the title fights, by how they ended: "knockouts in 2025", "title fights this year", "fastest finishes of 2024"
  const thisYear = Number(w.today.slice(0, 4));
  // "since 2018" or "in the 2010s" is a stretch of years: it is not the year it mentions, and nothing here can cut a stretch
  const span = has(q, SPAN);
  const boutYear = span ? undefined : year ? +year : has(q, /\bthis year\b/) ? thisYear : has(q, /\blast year\b/) ? thisYear - 1 : undefined;
  if (span && has(q, ABOUT_FIGHTS) && !has(q, ABOUT_FIGHTERS)) return [];
  // scheduled rounds: "at least 10 rounds", "10 or more rounds" and the 12-round maximum are the tool's minimum; any other count (exactly 8 rounds) it cannot say, so no answer
  const roundsAsked = q.match(/(?:at least |minimum of )?(\d{1,2})[- ](?:or more[- ])?rounds?\b/);
  const minRounds = roundsAsked && (has(q, /at least|or more|minimum/) || +roundsAsked[1] === 12) ? +roundsAsked[1] : undefined;
  if (roundsAsked && minRounds === undefined && has(q, /\b(fights?|bouts?)\b/)) return [];
  const recently = has(q, /\b(recent|latest|newest)\b/) && has(q, /\b(knockouts?|kos?|stoppages?|decisions?)\b/);
  if ((boutYear || recently || has(q, /title (fights?|bouts?)/) || has(q, /\bhow many\b/)) && has(q, /\b(fights?|bouts?|knockouts?|kos?|stoppages?|finishes|decisions?|draws?)\b|ضربات? (ال)?قاضيه|نزالات|تعادل/) && !has(q, /\b(most|highest|longest|biggest|greatest|upcoming|next|coming)\b|fight of the year|best fights?|اكثر|اعلي|اطول|اكبر|اعظم|اسرع|افضل|القادم/)) {
    return [{ tool: "bouts", args: withLimit({
      ...(boutYear ? { year: boutYear } : {}), ...(scope.division ? { division: scope.division } : {}),
      ...(has(q, /title (fights?|bouts?)/) ? { title: true } : {}),
      ...(minRounds ? { minRounds } : {}),
      ...(has(q, /knockouts?|\bkos?\b|stoppages?|finishes|ضربات? (ال)?قاضيه/) ? { method: "stoppage" } : has(q, /decisions?/) ? { method: "decision" } : has(q, /draws?|تعادل/) ? { method: "DRAW" } : {}),
      ...(has(q, /fastest|quickest/) ? { sort: "fastest" } : has(q, /knockdowns?/) ? { sort: "knockdowns" } : {}),
    }) }];
  }

  // a division plus "of all time" is that division's greatest list; a division plus "right now" is its ranking
  if (scope.division && has(q, /\b(best|greatest|goat)\b/) && has(q, /of all time|\bever\b|in history|all.time/)) return [{ tool: "record_list", args: withLimit({ list: "greatest", ...scope }) }];
  if (!cut && scope.division && has(q, /\b(best|top|number one|champion)\b/) && has(q, /right now|currently|today|at the moment|\balive\b|these days/)) return [{ tool: "rankings", args: withLimit(scope) }];

  for (const [re, list] of LISTS) {
    if (!has(q, re)) continue;
    if (boutYear && list === "fastest-kos") return [{ tool: "bouts", args: withLimit({ year: boutYear, sort: "fastest" }) }];
    if (boutYear && list === "knockdowns" && !has(q, /\b(boxers?|fighters?)\b/)) return [{ tool: "bouts", args: withLimit({ year: boutYear, sort: "knockdowns" }) }];
    // the all-time lists have no year: "most knockouts in 2024" answered with the all-time list would be a wrong answer that looks right, so it is no answer
    if (boutYear || span) return [];
    // nor can they be cut to a group they do not know ("among southpaws", "in Japan", "among active fighters"): answered as asked they would be the list for everybody. A fighter
    // search can honour the group for the three lists it can sort by; for the rest there is no answer
    // ("unbeaten" in "longest unbeaten run" is the list, not a group of unbeaten fighters)
    const group = narrowsList(f, list);
    if (group) return LIST_AS_SORT[list] ? [{ tool: "fighters", args: withLimit({ ...Object.fromEntries(Object.entries(f).filter(([k]) => k !== "text")), sort: LIST_AS_SORT[list], ...(list === "ko-rate" && f.minWins === undefined ? { minWins: 15 } : {}) }) }] : [];
    return [{ tool: "record_list", args: withLimit({ list, ...scope }) }];
  }

  if (has(q, /(highest|biggest|top|largest) (live )?(gate|gates)|gate record|(most expensive|priciest) tickets?|ticket (sales|revenue)|gate (receipts?|takings?|revenue)|اعلي.*(ايرادات? بوابه|بوابه)/)) return [{ tool: "money", args: withLimit({ kind: "gates" }) }];
  if (has(q, /pay.?per.?view|\bppv\b|بي ?بي ?في/)) return [{ tool: "money", args: withLimit({ kind: "ppv" }) }];
  if (has(q, /(biggest|highest|largest) purses?|highest.paid|best.paid|paydays?|paychecks?|اعلي.*(اجر|مكافاه)/)) return [{ tool: "money", args: withLimit({ kind: "purses" }) }];
  if (has(q, /(highest|top|biggest) earners?|top.paid|who earns the most|earns? the most|how much (do|does|did) (boxers?|fighters?) (make|earn)|اعلي.*(دخل|رواتب|اجور|مكافات)|(رواتب|اجور|مكافات|دخل).*(اعلي|الاعلي|اكبر)/)) return [{ tool: "money", args: withLimit({ kind: "earners" }) }];

  if (has(q, /champs?\b|champions?\b|title.?holders?|who holds|holds the|belt.?holders?|بطل|ابطال|حامل|يحمل|حزام|احزمه/) && !fighters.length) {
    // champions who are also something else ("champions from Mexico", "champions over 35", "former champions", "retired champions") are a search: the list of live champions has no such cut, and
    // answering with it would look right and be wrong (round 51)
    const cut = Object.keys(f).some((k) => !["champion", "weightClass", "sex", "sort", "text"].includes(k)) || f.champion === "former" || f.champion === "ever";
    return cut ? [filters()] : [{ tool: "champions", args: scope }];
  }
  if (has(q, /trainer|coach|مدرب/) && (!fighters.length || trainer())) {
    const typed = question.match(/(?:trainer|coach|مدرب)\s+([\p{L}.'\- ]{4,40})/iu)?.[1]?.trim();
    const name = trainer() ?? (typed && !has(normalize(typed), /^(impact|effect|the|best|has|have|had|with|who|that|is|are|does|did|get|gets|add|adds|win|wins)\b/) ? typed : undefined);
    return [{ tool: "trainers", args: withLimit(name ? { name } : {}) }];
  }
  if (!fighters.length && trainer()) return [{ tool: "trainers", args: withLimit({ name: trainer() }) }];
  // one fighter named: what is asked about him is on his page, whatever else the sentence mentions ("what was X's last fight")
  if (fighters.length === 1) return [{ tool: "fighter", args: { name: fighters[0].name } }];

  // "the best three middleweights", in Arabic: the ranking of the division
  if (!cut && scope.division && has(q, /(افضل|اقوي)\s*(\d+|\S+)?\s*(ملاكم|ملاكمين|ملاكمون|ملاكمات)/)) return [{ tool: "rankings", args: withLimit(scope) }];
  if (f.archetype && !has(q, /rank|pound.for.pound|p4p/)) return [filters()];
  if (has(q, /new to boxing|who should i (know|watch|follow)|where (do|should) i (start|begin)/)) return [{ tool: "rankings", args: withLimit({}) }];
  // "top 5 southpaws": a ranking is by division; a group of fighters from anywhere is a search
  if (GROUP_KEYS.some((k) => k in f) && has(q, /\btop \d+\b|\bbest\b|\bhighest rated\b/) && !has(q, /pound.for.pound|\bp4p\b/)) return [filters()];
  if (!cut && has(q, /rankings?\b|ranked\b|top \d+|pound.for.pound|\bp4p\b|تصنيف|ترتيب/)) return [{ tool: "rankings", args: withLimit(scope) }];
  if (has(q, /(upcoming|next|coming up|future) (fights?|events?|cards?|shows?)|fight calendar|schedule|(what|which) (fights?|cards?|boxing|events?|bouts?) (is |are )?(on|coming|scheduled|happening|next)|who.?s (fighting|boxing)( next| tonight| this)?|who headlines|headliners?|next (big |major |title )?(fight|bout|card)|(next|upcoming|coming) (main event|headline|headliner|big fight)|coming up|boxing is on|on this (week|month|weekend)|this weekend|tonight|next (week|month)|القادمه|القادم|جدول/)) return [{ tool: "events", args: withLimit({ when: "upcoming" }) }];
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
  const q = westernize(normalize(question)).replace(/[?؟!.]+$/g, "");
  const list = LISTS.some(([re]) => has(q, re));
  const span = has(q, SPAN);
  if (span && ABOUT_FIGHTS.test(q) && !ABOUT_FIGHTERS.test(q)) return "span";
  const yearly = !span && (/\b20\d\d\b/.test(q) || has(q, /\bthis year\b|\blast year\b/));
  if (yearly && list) return "year";
  if (list && span) return "span";
  const listId = LISTS.find(([re]) => has(q, re))?.[1];
  if (list && (has(q, REGIONS) || narrowsList(heuristicParse(question, []), listId))) return "group";
  return null;
}
