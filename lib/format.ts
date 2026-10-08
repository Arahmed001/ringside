import { endsEarly } from "./methods";
import { nowMs } from "./clock";
import type { Locale } from "./i18n/config";
import { tEn, type T } from "./i18n/t";

// Arabic dates and numbers use the Gregorian calendar and Western digits, which is how Saudi and Gulf sports media print them.
const INTL: Record<Locale, string> = { en: "en-US", ar: "ar-u-nu-latn-ca-gregory" };

export const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }, locale: Locale = "en") =>
  new Date(d + "T12:00:00Z").toLocaleDateString(INTL[locale], { ...opts, timeZone: "UTC" });
/** A date that may be only a month ("1995-03") or a year ("1990"), as the title lists give them: shown at the precision it was stated, never padded to a day. */
export const fmtPartialDate = (d: string, locale: Locale = "en") =>
  d.length >= 10 ? fmtDate(d, undefined, locale) : d.length === 7 ? fmtDate(`${d}-01`, { month: "short", year: "numeric" }, locale) : d;
/** Country name in the visitor's language (the data holds English names). */
const regionNames = new Map<string, Intl.DisplayNames>();
export const COUNTRY_CODE: Record<string, string> = {
  "United States": "US", Mexico: "MX", "United Kingdom": "GB", Japan: "JP", Ukraine: "UA", Philippines: "PH", Nigeria: "NG", Argentina: "AR",
  "Saudi Arabia": "SA", Germany: "DE", Russia: "RU", Cuba: "CU", "Puerto Rico": "PR", Ghana: "GH", Kazakhstan: "KZ", Australia: "AU", Canada: "CA",
  France: "FR", Italy: "IT", Spain: "ES", Ireland: "IE", "South Africa": "ZA", Thailand: "TH", Colombia: "CO", Brazil: "BR", Uzbekistan: "UZ", Poland: "PL",
  Egypt: "EG", Morocco: "MA", Jordan: "JO", Iraq: "IQ", Syria: "SY", Lebanon: "LB", Kuwait: "KW", Bahrain: "BH", Qatar: "QA", Oman: "OM", Yemen: "YE", Algeria: "DZ", Tunisia: "TN", Libya: "LY", Sudan: "SD",
  "United Arab Emirates": "AE", Venezuela: "VE", Panama: "PA", "Dominican Republic": "DO", Nicaragua: "NI", Armenia: "AM", Belarus: "BY", Georgia: "GE", Kenya: "KE", Uganda: "UG", Tanzania: "TZ", Indonesia: "ID", "South Korea": "KR", China: "CN", India: "IN", Turkey: "TR",
};
/** "Türkiye", "Côte d’Ivoire", "St. Lucia & the Grenadines" and "turkey" all normalise alike: lower case, no accents or punctuation, "&" as "and". */
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[’'.]/g, "").replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();

/** Names the data and the press use that the platform's own region names do not (checked by the round-trip test in tests/countries.test.ts). */
const ALIASES: Record<string, string> = {
  usa: "US", us: "US", "united states of america": "US", uk: "GB", "great britain": "GB", britain: "GB", "northern ireland": "GB", "republic of ireland": "IE",
  "russian federation": "RU", turkey: "TR", turkiye: "TR", "czech republic": "CZ", "ivory coast": "CI", "cape verde": "CV", swaziland: "SZ", macedonia: "MK",
  burma: "MM", myanmar: "MM", bosnia: "BA", "bosnia herzegovina": "BA", holland: "NL", uae: "AE", korea: "KR", "viet nam": "VN", "east timor": "TL",
  serbia: "RS", /* the platform also names the retired code YU "Serbia", and the later one would win */
  "hong kong": "HK", macau: "MO", palestine: "PS", "democratic republic of congo": "CD", "dr congo": "CD", drc: "CD", congo: "CG", "republic of congo": "CG",
  // regions of Australia that a feed writes as a nationality: one country page, not one each
  "western australia": "AU", "new south wales": "AU", queensland: "AU", tasmania: "AU", "south australia": "AU",
};

let byName: Map<string, string> | null = null;
function countryNames(): Map<string, string> {
  if (byName) return byName;
  const dn = new Intl.DisplayNames(["en"], { type: "region" });
  const m = new Map<string, string>();
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b), n = dn.of(code);
    if (n && n !== code && n !== "Unknown Region") m.set(norm(n), code); // an unassigned code comes back as itself
  }
  for (const [k, v] of Object.entries(ALIASES)) m.set(norm(k), v);
  for (const [k, v] of Object.entries(COUNTRY_CODE)) m.set(norm(k), v);
  return (byName = m);
}
/** ISO country code for a country as written ("Denmark", "Côte d’Ivoire", "usa", "DK"), or undefined when it is not a country we can name. */
export function countryCode(c: string): string | undefined {
  const names = countryNames(), key = norm(c);
  if (/^[a-z]{2}$/.test(key) && [...names.values()].includes(key.toUpperCase())) return key.toUpperCase();
  return names.get(key);
}
/** Places inside a country that a boxing fan counts as their own nation: never folded into the sovereign state's page. */
const NATIONS_WITHIN = new Set(["northern ireland"]);
let nameOf: Map<string, string> | null = null;
/**
 * The one English spelling for a country however the feed wrote it ("USA", "U.S.", "United States of America" are all "United States"), so two spellings are
 * one country page. A name that is not a country we can identify (England, Scotland, a typo) is kept exactly as given: nothing is guessed.
 */
export function canonicalCountry(c: string): string {
  const code = countryCode(c);
  if (!code || NATIONS_WITHIN.has(norm(c))) return c.trim();
  if (!nameOf) {
    nameOf = new Map(Object.entries(COUNTRY_CODE).map(([n, k]) => [k, n]));
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) { const k = String.fromCharCode(a, b); if (!nameOf.has(k)) { const n = dn.of(k); if (n && n !== k) nameOf.set(k, n); } }
  }
  return nameOf.get(code) ?? c.trim();
}
/**
 * England, Scotland, Wales and Northern Ireland are nations a boxing fan counts as their own, but they are not ISO countries, so the platform's region names have no Arabic for
 * them (and Northern Ireland, which `countryCode` folds into the United Kingdom, came out as "the United Kingdom"). Their Arabic names are written here.
 */
const HOME_NATIONS_AR: Record<string, string> = { england: "إنجلترا", scotland: "اسكتلندا", wales: "ويلز", "northern ireland": "أيرلندا الشمالية", kurdistan: "كردستان" /* a region fighters list as their nation (found on the first real-sized league): no ISO code, so no Arabic name from the platform */ };
export function countryName(c: string, locale: Locale = "en"): string {
  if (locale === "ar") { const home = HOME_NATIONS_AR[norm(c)]; if (home) return home; }
  const code = countryCode(c);
  if (!code || locale === "en") return c;
  let dn = regionNames.get(locale);
  if (!dn) { dn = new Intl.DisplayNames([locale], { type: "region" }); regionNames.set(locale, dn); }
  return dn.of(code) ?? c;
}
export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const daysUntil = (d: string) => Math.ceil((Date.parse(d + "T12:00:00Z") - nowMs()) / 86400000);
/** A flag for England, Scotland or Wales is an emoji tag sequence (a black flag, the letters "gbeng", a terminator); Northern Ireland has none and uses the UK's. */
const tagFlag = (tag: string) => String.fromCodePoint(0x1f3f4, ...[...tag].map((ch) => 0xe0000 + ch.charCodeAt(0)), 0xe007f);
const NATIONS: Record<string, string> = { england: tagFlag("gbeng"), scotland: tagFlag("gbsct"), wales: tagFlag("gbwls") };
const flagCache = new Map<string, string>();
/** The flag emoji for any country by name (or ISO code), a white flag when it cannot be told. */
export const flag = (c: string): string => {
  const hit = flagCache.get(c);
  if (hit !== undefined) return hit;
  const code = countryCode(c);
  const out = NATIONS[norm(c)] ?? (code ? String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "🏳️");
  flagCache.set(c, out);
  return out;
};
/** Short result label: "KO R4", "UD", "DQ R3", "Draw". */
export const methodLabel = (m: string | null, r: number | null, t: T = tEn) =>
  !m ? "—" : m === "DRAW" ? t("Draw") : m === "TDRAW" ? (r ? t("Tech draw R{r}", { r }) : t("Tech draw")) : m === "NC" ? t("No contest") : endsEarly(m) && r ? t("{m} R{r}", { m: t(m), r }) : t(m);

/** The four nations that sit inside the United Kingdom's page: their fighters and cards are also the United Kingdom's. */
export const UK_NATIONS = new Set(["England", "Scotland", "Wales", "Northern Ireland"]);
/** Whether a place called `country` is `wanted`, or a nation inside it (England is in the United Kingdom). */
export const inCountry = (country: string, wanted: string): boolean => country === wanted || (wanted === "United Kingdom" && UK_NATIONS.has(country));
