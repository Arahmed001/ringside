# Arabic belt names (machine Arabic: needs a native reviewer)

A real feed's belts arrive as English strings: `WBC World Super Welterweight Champion`, `WBA Super World Welterweight Champion`, `IBF Interim World Lightweight Champion`, `The Ring Heavyweight Champion`. The first real cache has 129 of them in 19 shapes. `lib/i18n/belts.ts` writes their Arabic from the parts, so the Titles pages, the fight pages and the belt lineages read in Arabic without anybody typing 129 names.

**It is a fallback.** `t.name(...)` looks in the stored name translations first (`name_translations`, which records who wrote each row and whether a person reviewed it); only a name with no stored translation is derived. So a reviewed translation always wins, and the way to correct a derived one is to store the right one.

**The wording (for the reviewer).** The belt is the title, "لقب"; the body's code stays Latin, as Arabic sports pages print it; the division is the site's own Arabic name for it.

| English | Arabic |
|---|---|
| `WBC World Welterweight Champion` | لقب WBC العالمي في وزن الويلتر |
| `WBC World Super Welterweight Champion` | لقب WBC العالمي في وزن فوق الويلتر |
| `WBA Super World Welterweight Champion` | لقب WBA العالمي «سوبر» في وزن الويلتر |
| `IBF Interim World Lightweight Champion` | لقب IBF العالمي المؤقت في الوزن الخفيف |
| `WBO World Junior Welterweight Champion` | لقب WBO العالمي في وزن فوق الخفيف |
| `WBA World Minimumweight` (no "Champion": the same belt) | لقب WBA العالمي في وزن القش |
| `The Ring Heavyweight Champion` | لقب «ذا رينغ» في الوزن الثقيل |

The five bodies' full names: World Boxing Association الاتحاد العالمي للملاكمة, World Boxing Council المجلس العالمي للملاكمة, International Boxing Federation الاتحاد الدولي للملاكمة, World Boxing Organization المنظمة العالمية للملاكمة, The Ring ذا رينغ.

Questions for the reviewer: «سوبر» for WBA's "Super" champion (the site's own dictionary says "بطل سوبر" for the champion-status badge); "المؤقت" for Interim; whether "لقب ... العالمي" reads better than "بطل العالم" for a title shown as a label; the body names above.

**What is left as written:** any name that is not one of those shapes (another body such as OPBF or EBU, a belt with an unknown division, "WBC Silver ..."), so nothing is guessed. Server-rendered pages get the fallback; client components show belt names that the server already translated.

Code: `lib/i18n/belts.ts`, wired in `makeT`'s fourth argument (`lib/i18n/dicts.ts`). Tests: `tests/belts-ar.test.ts` over `tests/fixtures/belt-names.json` (all 129 names).
