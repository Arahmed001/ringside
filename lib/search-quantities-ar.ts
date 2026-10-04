import type { Filters } from "./ai";
import { bound, put, cmpOf, type Measure, type Cmp } from "./search-quantities";

/**
 * The numbers in an Arabic fighter search, read the way lib/search-quantities.ts reads English ones: "أكثر من 10 هزايم", "20 فوزًا على الأقل", "أقل من 5 نزالات",
 * "بين 25 و30 سنة", "أطول من 185 سم", "بدون هزايم", "سجل خاسر", "أبطال سابقون". It works on the question after `normalize` (hamza, ى and ة folded, no vowel marks), so
 * every pattern here is in folded letters (so "على" is "علي") (also ئ is ي: هزائم is هزايم); numbers may be Arabic-Indic digits or the number words one to ten and the tens, which `westernize` turns into digits first
 * (only before a word that counts something, so "ثلاثة ملاكمين" in "أفضل ثلاثة ملاكمين" stays a word). "أكثر من 20" is 21 and up, "أقل من 25" 24 and down, "على الأقل"
 * keeps its number, as in English; a bare number before a count is a minimum, except an age.
 */

const AR = "\\u0600-\\u06ff";
const START = `(?<![${AR}])`, END = `(?![${AR}])`;

const CMP = [
  `(?<ge>علي الاقل|لا يقل عن|لا تقل عن|ما لا يقل عن|لا اقل من|حد ادني|كحد ادني)`,
  `(?<gt>اكثر من|اكتر من|اكبر من|اعلي من|ازيد من|يزيد عن|تزيد عن|يزيد علي|تزيد علي|يتجاوز|تتجاوز|يفوق|تفوق|فوق|اطول من)`,
  `(?<le>علي الاكثر|لا يزيد عن|لا تزيد عن|لا يتجاوز|لا تتجاوز|حد اقصي|كحد اقصي)`,
  `(?<lt>اقل من|اقل عن|اصغر من|ادني من|اقصر من|تحت|دون)`,
  `(?<eq>بالضبط|تماما|بالتحديد)`,
].join("|");
const SUFFIX = `(?:(?<sge>او اكثر|او اعلي|او اكبر|فاكثر|فما فوق|وما فوق|او ازيد)|(?<sle>او اقل|او ادني|او اصغر|فاقل|فما دون|وما دون|وما تحت))`;
const NOUN: Record<Exclude<Measure, "height" | "reach" | "stopped">, string> = {
  wins: "(?:فوز(?:ا|ان|ين)?|انتصار(?:ات|ا|ان|ين)?)",
  losses: "(?:هزيمه|هزيمتان|هزيمتين|هزايم|خساره|خسارتان|خسارتين|خساير|خسارات)",
  kos: "(?:ضربه قاضيه|ضربات قاضيه|ضربتان قاضيتان|ضربتين قاضيتين|ك ?او)",
  draws: "(?:تعادلات|تعادلا|تعادل)",
  bouts: "(?:نزالا|نزال|نزالات|نزالان|نزالين|مباراه|مباريات)",
  age: "(?:سنه|سنوات|سنين|سنا|عاما|عام|اعوام)",
};
const ANY_NOUN = Object.values(NOUN).join("|");
const CM = "(?:سم|سنتيمتر(?:ا|ات)?|سنتمتر(?:ا|ات)?)";

const WEST: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
// folded forms: ة is ه, أ is ا
const WORDS: Record<string, number> = {
  واحد: 1, اثنين: 2, اثنان: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثماني: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10,
  عشرين: 20, ثلاثين: 30, اربعين: 40, خمسين: 50,
};

/** Arabic-Indic digits to 0-9, and a number word right before something that counts to its digits ("اكثر من عشر هزايم" is "اكثر من 10 هزايم"). */
/** Spans of time that are not already an age's unit ("6 أشهر"); "سنة" and "عام" are in the age nouns. */
const MORE_TIME = "(?:يوم|ايام|اسبوع|اسابيع|شهر|اشهر|شهور)";
export function westernize(s: string): string {
  s = s.replace(/[٠-٩۰-۹]/g, (d) => WEST[d]);
  const words = Object.keys(WORDS).sort((a, b) => b.length - a.length).join("|");
  return s.replace(new RegExp(`${START}(${words})(?=\\s+(?:${ANY_NOUN}|${MORE_TIME})${END})`, "g"), (_m, w: string) => String(WORDS[w]));
}

/** Reads every quantity out of the (folded) question `q`, sets the filters, and returns what is left. */
export function peelQuantitiesAr(q: string, f: Filters): string {
  q = westernize(q);
  const take = (re: RegExp, set: (g: Record<string, string | undefined>) => void | false) => {
    q = q.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), (...args) => {
      const groups = (args[args.length - 1] ?? {}) as Record<string, string | undefined>;
      return set(groups) === false ? (args[0] as string) : " ";
    });
  };
  const one = (m: Measure, n: number, g: Record<string, string | undefined>, fallback: Cmp) => { const [lo, hi] = bound(cmpOf(g, fallback), n); put(f, m, lo, hi); };
  const re = (src: string) => new RegExp(src);

  // the record as a whole
  take(re(`${START}ب?سجل\\S*\\s+(?:رابح|فايز|ايجابي|فوز)${END}`), () => { f.record = "winning"; });
  take(re(`${START}ب?سجل\\S*\\s+(?:خاسر|سلبي|هزايم|هزيمه)${END}`), () => { f.record = "losing"; });
  // none of something, in words
  take(re(`${START}و?(?:بدون|بلا|دون|ليس (?:لديه|لديهم|له|لهم)|لا (?:يملك|يملكون|لديه|لديهم)|صفر)\\s+(?:هزايم|هزيمه|خساير|خساره)${END}|${START}لم (?:يخسر|يهزم|يخسروا|يهزموا)(?: ابدا| قط)?${END}`), () => { put(f, "losses", undefined, 0); f.undefeated = true; });
  take(re(`${START}و?(?:بدون|بلا|دون|ليس (?:لديه|لديهم|له|لهم)|لا (?:يملك|يملكون)|صفر)\\s+(?:فوز|انتصارات|انتصار)${END}|${START}لم (?:يفز|ينتصر|يفوزوا|ينتصروا|يفوز)(?: ابدا| قط)?(?! بال)${END}`), () => put(f, "wins", undefined, 0));
  take(re(`${START}و?(?:بدون|بلا|دون|ليس (?:لديه|لديهم|له|لهم)|لا (?:يملك|يملكون)|صفر)\\s+(?:ضربات قاضيه|ضربه قاضيه|ك ?او)${END}|${START}لم (?:يفز|يفوزوا) بال(?:ضربه|ضربات) القاضيه${END}`), () => put(f, "kos", undefined, 0));

  // reach, with or without the word first
  const REACH = `(?:امتداد|مدي|طول)\\s*(?:ال)?(?:ذراعي\\S*|ذراع|اذرع)|امتداد|مدي`;
  take(re(`${START}(?:${REACH})\\s*(?:بين\\s+)?(?<a>\\d{2,3})\\s*(?:سم\\s*)?(?:و|الي|-|–)\\s*(?<b>\\d{2,3})(?!\\d)`), (g) => put(f, "reach", Math.min(+g.a!, +g.b!), Math.max(+g.a!, +g.b!)));
  take(re(`${START}(?:${REACH})\\s*(?:(?:${CMP})\\s+)?(?<n>\\d{2,3})(?!\\d)\\s*(?:${CM})?(?:\\s*${SUFFIX})?`), (g) => one("reach", +g.n!, g, "ge"));

  // height in centimetres, or "taller / shorter than 185"
  take(re(`${START}(?:طول\\S*\\s+)?بين\\s+(?<a>\\d{3})\\s*(?:و|الي|-|–)\\s*(?<b>\\d{3})\\s*${CM}`), (g) => put(f, "height", Math.min(+g.a!, +g.b!), Math.max(+g.a!, +g.b!)));
  take(re(`${START}(?:طول\\S*\\s+)?(?:(?:${CMP})\\s+)?(?<n>\\d{3})\\s*${CM}(?:\\s*${SUFFIX})?`), (g) => one("height", +g.n!, g, "ge"));
  take(re(`${START}(?:(?<gt>اطول)|(?<lt>اقصر)) من (?<n>\\d{3})(?!\\d)`), (g) => one("height", +g.n!, g, "gt"));

  // a range of a counted thing (an age too: "بين 25 و30 سنة"): "بين 15 و25 فوزا", "من 20 الى 30 فوزا"
  for (const [m, noun] of Object.entries(NOUN) as [Exclude<Measure, "height" | "reach" | "stopped">, string][]) {
    take(re(`${START}بين\\s+(?<a>\\d+)\\s*(?:و|الي|-|–)\\s*(?<b>\\d+)\\s*${noun}${END}`), (g) => put(f, m, Math.min(+g.a!, +g.b!), Math.max(+g.a!, +g.b!)));
    take(re(`${START}(?:من\\s+)?(?<a>\\d+)\\s*(?:الي|-|–)\\s*(?<b>\\d+)\\s*${noun}${END}`), (g) => put(f, m, Math.min(+g.a!, +g.b!), Math.max(+g.a!, +g.b!)));
  }

  // "فوز واحد" (one win): exactly one
  for (const [m, noun] of Object.entries(NOUN) as [Measure, string][]) {
    if (m === "age") continue;
    take(re(`${START}${noun}\\s+واحد(?:ه)?${END}`), () => one(m, 1, {}, "eq"));
  }
  // the comparison as a verb on the count: "لا يزيد عدد هزائمهم عن 5", "لا يقل عدد انتصاراتهم عن 30", "يزيد عمرهم عن 40"
  const MEASURE_OF: [RegExp, Measure][] = [[/^(?:هزايم|هزيمه|خساير|خساره)/, "losses"], [/^(?:فوز|انتصار)/, "wins"], [/^(?:ضربات|ضربه)/, "kos"], [/^(?:نزال|مباري|مباراه)/, "bouts"], [/^(?:عمر|اعمار|سن)/, "age"]];
  take(re(`${START}(?:(?<le>لا يزيد|لا يتجاوز)|(?<ge>لا يقل)|(?<gt>يزيد|يفوق|يتجاوز)|(?<lt>يقل))\\s+(?:عدد\\s+)?(?<noun>\\S+)\\s+(?:عن|من|علي)\\s+(?<n>\\d+)(?!\\d)`), (g) => {
    const m = MEASURE_OF.find(([r]) => r.test(g.noun!))?.[1];
    if (!m) return false;
    one(m, +g.n!, g, "ge");
  });

  // the comparison said after what is counted: "20 فوزا على الاقل", "3 هزايم على الاكثر" (before the plain form below, which would take the number alone)
  for (const [m, noun] of Object.entries(NOUN) as [Measure, string][]) {
    take(re(`${START}(?<![\\d.])(?<n>\\d+)\\s*${noun}\\s+(?:(?<ge>علي الاقل|لا يقل)|(?<le>علي الاكثر|لا يزيد)|(?<eq>بالضبط|تماما|بالتحديد))${END}`), (g) => one(m, +g.n!, g, "ge"));
  }
  // one number and what it counts: "أكثر من 10 هزايم", "15 ضربة قاضية أو أكثر", "5 نزالات"
  for (const [m, noun] of Object.entries(NOUN) as [Measure, string][]) {
    take(re(`${START}(?:و?(?:${CMP})\\s+)?(?<![\\d.])(?<n>\\d+)\\+?\\s*${noun}${END}(?:\\s*${SUFFIX})?`), (g) => one(m, +g.n!, g, m === "age" ? "eq" : "ge"));
  }
  // "اعمارهم فوق 35", "تحت 25", "اكبر من 30": an age, when nothing counted follows
  take(re(`${START}(?:(?:${CMP})\\s+)(?<n>\\d{2})(?![\\d.%]|\\s*(?:%|${ANY_NOUN}|${CM}|كجم|كيلو|باوند|جولات?|جوله)${END})`), (g) => { const n = +g.n!; if (n < 16 || n > 60) return false; one("age", n, g, "eq"); });
  return q;
}

