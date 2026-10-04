import type { Filters } from "./ai";
import { bound, put, cmpOf } from "./search-quantities";
import { westernize } from "./search-quantities-ar";

/**
 * A fighter's record and form in an Arabic search, as lib/search-record.ts reads them in English (round 54): times stopped ("لم يتعرضوا للضربة القاضية أبدا",
 * "خسروا بالضربة القاضية 3 مرات على الأقل"), draws ("بدون تعادلات", "لديهم تعادل"), streaks ("سلسلة انتصارات من 5 نزالات", "فازوا في آخر 3 نزالات", "خسروا نزالهم الأخير"),
 * an unbeaten run ("لم يخسروا في آخر 5 نزالات"), when they last fought ("خاضوا نزالا في آخر 6 أشهر", "لم يخوضوا نزالا منذ أكثر من سنة", "آخر نزال لهم في 2024"), the year they
 * turned pro ("احترفوا في 2015") and a knockout rate ("نسبة ضرباتهم القاضية أقل من 30%"). It works on the question after `normalize` (so ئ is ي, ة is ه, no vowel marks),
 * before the quantity parser, which would otherwise take "لم يخسروا" for "undefeated" and "5 نزالات" for a count of fights. The verb "أوقف" is not read: without its
 * vowel marks it is both "stopped" and "was stopped", and a wrong guess is a wrong answer; "تعرض للضربة القاضية" and "خسر بالضربة القاضية" are clear.
 */

const AR = "\\u0600-\\u06ff";
const START = `(?<![${AR}])`, END = `(?![${AR}])`;
const KO = "(?:ال)?(?:ضربه (?:ال)?قاضيه|ضربات (?:ال)?قاضيه|ايقاف|توقف|ك ?او)";
const COUNT_WORDS: Record<string, number> = { مره: 1, مرتين: 2, مرتان: 2 };
const CMP = [
  `(?<ge>علي الاقل|لا يقل عن|لا تقل عن|ما لا يقل عن|حد ادني)`,
  `(?<gt>اكثر من|اكتر من|اكبر من|فوق|يزيد عن|تزيد عن|يتجاوز|تتجاوز)`,
  `(?<le>علي الاكثر|لا يزيد عن|لا تزيد عن|لا يتجاوز|حد اقصي)`,
  `(?<lt>اقل من|اصغر من|تحت|دون)`,
  `(?<eq>بالضبط|تماما|بالتحديد)`,
].join("|");
const SUFFIX = `(?:(?<sge>او اكثر|فاكثر|فما فوق)|(?<sle>او اقل|فاقل|فما دون))`;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const UNIT: [RegExp, "days" | "weeks" | "months" | "years"][] = [[/^(?:يوم|ايام)/, "days"], [/^(?:اسبوع|اسابيع|اسبوعين)/, "weeks"], [/^(?:شهر|اشهر|شهور|شهرين)/, "months"], [/^(?:سنه|سنوات|سنين|سنتين|عام|اعوام|عامين)/, "years"]];
const DUAL = /^(?:اسبوعين|شهرين|سنتين|عامين)$/;
const shift = (today: string, n: number, unit: string): string => {
  const d = new Date(today + "T12:00:00Z");
  if (unit === "years") d.setUTCFullYear(d.getUTCFullYear() - n);
  else if (unit === "months") d.setUTCMonth(d.getUTCMonth() - n);
  else if (unit === "weeks") d.setUTCDate(d.getUTCDate() - 7 * n);
  else d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
};
const dayBefore = (date: string) => iso(new Date(new Date(date + "T12:00:00Z").getTime() - 86400000));

/** `q` is the folded question; returns what is left of it. `today` is the league's own date (a relative span needs it). */
export function peelRecordAr(q: string, f: Filters, today?: string): string {
  q = westernize(q);
  const take = (re: RegExp, set: (g: Record<string, string | undefined>) => void | false) => {
    q = q.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), (...args) => {
      const groups = (args[args.length - 1] ?? {}) as Record<string, string | undefined>;
      return set(groups) === false ? (args[0] as string) : " ";
    });
  };
  const re = (src: string) => new RegExp(src);
  const times = (g: Record<string, string | undefined>) => (g.w ? COUNT_WORDS[g.w] : +g.n!);
  const streak = (key: "minWinStreak" | "minLossStreak", n: number) => { f[key] = Math.max(f[key] ?? 0, n); };
  const unit = (word: string) => UNIT.find(([r]) => r.test(word))?.[1];
  const amount = (g: Record<string, string | undefined>) => (DUAL.test(g.u!) ? 2 : g.n ? +g.n : 1);

  // how the last fight ended is not a filter: leave "خسروا نزالهم الاخير بالضربة القاضية" as it is
  const NOT_HOW = `(?!\\s+(?:ب|عن طريق|بواسطه|امام|ضد)\\S*)`;

  // stopped: never, and how many times
  take(re(`${START}لم (?:يتعرض|يتعرضوا|يتعرضن|تتعرض)\\s+(?:لل|ل)${KO}(?: ابدا| قط)?${END}|${START}لم (?:يخسر|يخسروا|يهزم|يهزموا|تخسر)\\s+(?:(?:اي|احد|واحد) منهم\\s+)?(?:ب|عن طريق ال)${KO}(?: ابدا| قط)?${END}|${START}(?:بدون|بلا|ليس (?:لديهم|لديه|لهم|له))\\s+(?:هزايم|هزيمه|خساير|خساره)\\s+ب${KO}${END}`), () => put(f, "stopped", undefined, 0));
  // went the distance every time
  take(re(`${START}(?:انهوا|يخوضون|خاضوا)\\s+(?:كل )?(?:نزالاتهم|نزالاتهن)\\s+(?:حتي|الي)\\s+(?:النهايه|اخر جوله|الجوله الاخيره)${END}`), () => { put(f, "stopped", undefined, 0); put(f, "kos", undefined, 0); });
  // "تعرضوا للضربة القاضية 3 مرات على الاقل", "خسروا بالضربة القاضية اكثر من مرتين", "5 هزائم بالضربة القاضية"
  take(re(`${START}(?:تعرض|تعرضوا|تعرضن|تعرضت|خسر|خسروا|خسرن|خسرت|هزم|هزموا)\\S*\\s*(?:لل|ل|ب|عن طريق ال)${KO}\\s+(?:(?:${CMP})\\s+)?(?:(?<n>\\d+)\\s*(?:مرات|مره)?|(?<w>مره|مرتين|مرتان))(?:\\s*${SUFFIX})?${END}`), (g) => { const [lo, hi] = bound(cmpOf(g, "ge"), times(g)); put(f, "stopped", lo, hi); });
  take(re(`${START}(?:(?:${CMP})\\s+)?(?<n>\\d+)\\s*(?:هزايم|هزيمه|خساير|خساره|خسارات)\\s+ب${KO}(?:\\s*${SUFFIX})?${END}`), (g) => { const [lo, hi] = bound(cmpOf(g, "ge"), +g.n!); put(f, "stopped", lo, hi); });

  // draws
  take(re(`${START}(?:(?:بدون|بلا|دون|ليس (?:لديهم|لديه|لهم|له))\\s+تعادل(?:ات)?|لم (?:يتعادل|يتعادلوا|تتعادل)(?: ابدا| قط)?)${END}`), () => put(f, "draws", undefined, 0));
  take(re(`${START}(?:(?:${CMP})\\s+)?تعادلين${END}(?:\\s*${SUFFIX})?`), (g) => { const [lo, hi] = bound(cmpOf(g, "ge"), 2); put(f, "draws", lo, hi); });
  take(re(`${START}(?:تعادل واحد|تعادلا واحدا)${END}`), () => put(f, "draws", 1, 1));
  take(re(`${START}(?:لديهم|لديه|لديهن|سجلهم يتضمن|يحتوي سجلهم علي|سجلهم فيه|سجله فيه)\\s+تعادل(?:ا)?${END}`), () => put(f, "draws", 1, undefined));
  take(re(`${START}(?:تعادلوا|تعادلن|تعادل)\\s+(?:علي الاقل )?(?:مره|مره واحده)${END}`), () => put(f, "draws", 1, undefined));

  // an unbeaten run, then streaks and the last results
  take(re(`${START}(?:لم (?:يخسر|يخسروا|يهزم|يهزموا|تخسر)|غير مهزومين|غير مهزوم|بلا هزايم|بدون هزايم|دون هزيمه)\\s+(?:في|خلال)\\s+(?:ال)?(?:اخر|اخير)\\s+(?<n>\\d+)\\s*(?:نزالات|نزال)?${END}`), (g) => { f.unbeatenIn = Math.max(f.unbeatenIn ?? 0, +g.n!); });
  take(re(`${START}(?:لم (?:يخسر|يخسروا|يهزم|يهزموا)|غير مهزومين|غير مهزوم)\\s+(?:في|خلال)\\s+(?:اخر|اخير)\\s+(?<d>نزالين|نزالان)${END}`), () => { f.unbeatenIn = Math.max(f.unbeatenIn ?? 0, 2); });
  take(re(`(?<!(?:اطول|اكبر|افضل|اعلي|اقصر|اقوي)\\s(?:ال)?)${START}(?:في )?سلسله\\s+(?<kind>انتصارات|فوز|هزايم|خساير)(?:\\s+(?:من|بطول|لا تقل عن|لا تقل|اكثر من|علي الاقل|تبلغ|مكونه من))?(?:\\s+(?<n>\\d+)\\s*(?:نزالات|نزال|انتصارات|هزايم)?)?(?:\\s*${SUFFIX})?${END}`), (g) => { const n = g.n ? +g.n : 2; streak(/^(?:هزايم|خساير)/.test(g.kind!) ? "minLossStreak" : "minWinStreak", n); });
  take(re(`${START}(?<kind>فاز|فازوا|فزن|فازت|انتصر|انتصروا|خسر|خسروا|خسرن|خسرت|هزم|هزموا)\\s+(?:في |ب)?(?:اخر|اخير)\\s*(?:(?<n>\\d+)\\s*(?:نزالات|نزال|مباريات)|(?<d>نزالين|نزالان))?(?<tail>\\s+(?:ب|عن طريق)\\S*)?${END}`), (g) => { if (g.tail) return false; const n = g.d ? 2 : g.n ? +g.n : 1; streak(/^(?:خس|هزم)/.test(g.kind!) ? "minLossStreak" : "minWinStreak", n); });
  take(re(`${START}(?<kind>فاز|فازوا|فازت|انتصر|انتصروا|خسر|خسروا|خسرن|خسرت|هزم|هزموا)\\s+(?:في |ب)?نزالهم الاخير${NOT_HOW}${END}`), (g) => { streak(/^(?:خس|هزم)/.test(g.kind!) ? "minLossStreak" : "minWinStreak", 1); });
  take(re(`${START}(?<kind>فاز|فازوا|فازت|انتصر|انتصروا|خسر|خسروا|خسرن|خسرت|هزم|هزموا)\\s+(?:في |ب)?نزالهن الاخير${NOT_HOW}${END}`), (g) => { streak(/^(?:خس|هزم)/.test(g.kind!) ? "minLossStreak" : "minWinStreak", 1); });

  if (today) {
    // when they last fought
    take(re(`${START}(?:خاضوا|خاضت|خاضن|لعبوا|نزلوا الي الحلبه)\\s+نزالا\\s+(?:في|خلال)\\s+(?:ال)?(?:اخر|اخير)\\s+(?:(?<n>\\d+)\\s+)?(?<u>اشهر|شهرا|شهر|شهور|ايام|يوما|يوم|اسابيع|اسبوعا|اسبوع|سنوات|سنه|سنين|اعوام|عاما|عام|اسبوعين|شهرين|سنتين|عامين)${END}`), (g) => { const u = unit(g.u!); if (!u) return false; f.lastFightAfter = shift(today, amount(g), u); });
    take(re(`${START}(?:لم (?:يخوضوا|يخض|تخض|يلعبوا)|لا يخوضون)\\s+(?:اي )?نزالا\\s+(?:منذ|لمده|في)\\s+(?:(?<gt>اكثر من)|(?<ge>علي الاقل))?\\s*(?:(?<n>\\d+)\\s+)?(?<u>اشهر|شهرا|شهر|شهور|ايام|يوما|يوم|اسابيع|اسبوعا|اسبوع|سنوات|سنه|سنين|اعوام|عاما|عام|اسبوعين|شهرين|سنتين|عامين)${END}(?:\\s+(?:علي الاقل))?`), (g) => { const u = unit(g.u!); if (!u) return false; const cutoff = shift(today, amount(g), u); f.lastFightBefore = g.gt ? dayBefore(cutoff) : cutoff; });
    take(re(`${START}(?:(?:لا نشاط لهم|غير نشطين|بلا نشاط|دون نشاط|لا نشاط))\\s+(?:منذ|لمده)\\s+(?:(?<gt>اكثر من)|(?<ge>علي الاقل))?\\s*(?:(?<n>\\d+)\\s+)?(?<u>اشهر|شهرا|شهر|شهور|ايام|يوما|يوم|اسابيع|اسبوعا|اسبوع|سنوات|سنه|سنين|اعوام|عاما|عام|اسبوعين|شهرين|سنتين|عامين)${END}(?:\\s+(?:علي الاقل))?`), (g) => { const u = unit(g.u!); if (!u) return false; const cutoff = shift(today, amount(g), u); f.lastFightBefore = g.gt ? dayBefore(cutoff) : cutoff; });
    take(re(`${START}(?:خاضوا|خاضت|خاضن|لعبوا)\\s+نزالا\\s+(?:هذا العام|هذه السنه|هذا العام الحالي|خلال هذا العام)${END}`), () => { f.lastFightAfter = today.slice(0, 4) + "-01-01"; });
    take(re(`${START}(?:خاضوا|خاضت|خاضن|لعبوا)\\s+نزالا\\s+(?:العام الماضي|السنه الماضيه|في العام الماضي)${END}`), () => { const y = +today.slice(0, 4) - 1; f.lastFightAfter = `${y}-01-01`; f.lastFightBefore = `${y}-12-31`; });
  }
  // by year, which needs no date to compare with
  q = q.replace(new RegExp(`${START}(?:خاضوا|خاضت|خاضن|لعبوا)?\\s*(?:اخر نزال لهم|اخر نزال لها|اخر نزال له|اخر نزال)\\s+(?:لهم |لها |له )?(?:كان )?(?:في|عام)\\s+((?:19|20)\\d\\d)${END}`, "g"), (_m, y: string) => { f.lastFightAfter = `${y}-01-01`; f.lastFightBefore = `${y}-12-31`; return " "; });
  q = q.replace(new RegExp(`${START}(?:اخر نزال)\\s+(?:لهم |لها |له )?(?:قبل)\\s+((?:19|20)\\d\\d)${END}`, "g"), (_m, y: string) => { f.lastFightBefore = `${+y - 1}-12-31`; return " "; });
  q = q.replace(new RegExp(`${START}(?:اخر نزال)\\s+(?:لهم |لها |له )?(?:منذ)\\s+((?:19|20)\\d\\d)${END}`, "g"), (_m, y: string) => { f.lastFightAfter = `${y}-01-01`; return " "; });
  q = q.replace(new RegExp(`${START}لم (?:يخوضوا|يخض|تخض|يلعبوا)\\s+(?:اي )?نزالا\\s+منذ\\s+((?:19|20)\\d\\d)${END}`, "g"), (_m, y: string) => { f.lastFightBefore = `${y}-12-31`; return " "; });
  q = q.replace(new RegExp(`${START}(?:خاضوا|خاضت|خاضن|لعبوا)\\s+نزالا\\s+منذ\\s+((?:19|20)\\d\\d)${END}`, "g"), (_m, y: string) => { f.lastFightAfter = `${y}-01-01`; return " "; });

  // the year they turned pro
  q = q.replace(new RegExp(`${START}(?:احترف\\S*|بد\\S*\\s+(?:ال)?احتراف\\S*|بد\\S*\\s+مسيرت\\S*\\s+(?:ال)?احترافيه?)\\s+(?:في|عام|خلال)\\s+((?:19|20)\\d\\d)${END}`, "g"), (_m, y: string) => { f.debutAfter = +y; f.debutBefore = +y; return " "; });
  q = q.replace(new RegExp(`${START}(?:احترف\\S*|بد\\S*\\s+(?:ال)?احتراف\\S*|بد\\S*\\s+مسيرت\\S*\\s+(?:ال)?احترافيه?)\\s+بعد\\s+((?:19|20)\\d\\d)${END}`, "g"), (_m, y: string) => { f.debutAfter = +y + 1; return " "; });
  q = q.replace(new RegExp(`${START}(?:احترف\\S*|بد\\S*\\s+(?:ال)?احتراف\\S*|بد\\S*\\s+مسيرت\\S*\\s+(?:ال)?احترافيه?)\\s+قبل\\s+((?:19|20)\\d\\d)${END}`, "g"), (_m, y: string) => { f.debutBefore = +y - 1; return " "; });
  q = q.replace(new RegExp(`${START}(?:احترف\\S*|بد\\S*\\s+(?:ال)?احتراف\\S*|بد\\S*\\s+مسيرت\\S*\\s+(?:ال)?احترافيه?)\\s+منذ\\s+((?:19|20)\\d\\d)${END}`, "g"), (_m, y: string) => { f.debutAfter = Math.max(f.debutAfter ?? 0, +y); return " "; });

  // a knockout rate
  take(re(`${START}نسبه\\s+(?:ال)?(?:ضربات\\S*|ضرباتهم|ضرباتهن)\\s*(?:ال)?(?:قاضيه)?\\s*(?:لديهم|لديهن|لديه)?\\s*(?:(?<lt>اقل من|تحت|دون|لا تزيد عن|علي الاكثر)|(?<gt>اكثر من|فوق|لا تقل عن|علي الاقل|تزيد عن))\\s*(?<n>\\d+)\\s*%`), (g) => { if (g.lt) f.maxKoRate = +g.n! / 100; else f.minKoRate = Math.max(f.minKoRate ?? 0, +g.n! / 100); });
  return q;
}
