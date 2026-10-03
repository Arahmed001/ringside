import { endsEarly } from "./methods";
import { nowMs } from "./clock";
import type { Locale } from "./i18n/config";
import { tEn, type T } from "./i18n/t";

// Arabic dates and numbers use the Gregorian calendar and Western digits, which is how Saudi and Gulf sports media print them.
const INTL: Record<Locale, string> = { en: "en-US", ar: "ar-u-nu-latn-ca-gregory" };

export const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }, locale: Locale = "en") =>
  new Date(d + "T12:00:00Z").toLocaleDateString(INTL[locale], { ...opts, timeZone: "UTC" });
/** Country name in the visitor's language (the data holds English names). */
const regionNames = new Map<string, Intl.DisplayNames>();
export const COUNTRY_CODE: Record<string, string> = {
  "United States": "US", Mexico: "MX", "United Kingdom": "GB", Japan: "JP", Ukraine: "UA", Philippines: "PH", Nigeria: "NG", Argentina: "AR",
  "Saudi Arabia": "SA", Germany: "DE", Russia: "RU", Cuba: "CU", "Puerto Rico": "PR", Ghana: "GH", Kazakhstan: "KZ", Australia: "AU", Canada: "CA",
  France: "FR", Italy: "IT", Spain: "ES", Ireland: "IE", "South Africa": "ZA", Thailand: "TH", Colombia: "CO", Brazil: "BR", Uzbekistan: "UZ", Poland: "PL",
  Egypt: "EG", Morocco: "MA", Jordan: "JO", Iraq: "IQ", Syria: "SY", Lebanon: "LB", Kuwait: "KW", Bahrain: "BH", Qatar: "QA", Oman: "OM", Yemen: "YE", Algeria: "DZ", Tunisia: "TN", Libya: "LY", Sudan: "SD",
  "United Arab Emirates": "AE", Venezuela: "VE", Panama: "PA", "Dominican Republic": "DO", Nicaragua: "NI", Armenia: "AM", Belarus: "BY", Georgia: "GE", Kenya: "KE", Uganda: "UG", Tanzania: "TZ", Indonesia: "ID", "South Korea": "KR", China: "CN", India: "IN", Turkey: "TR",
};
export function countryName(c: string, locale: Locale = "en"): string {
  const code = COUNTRY_CODE[c];
  if (!code || locale === "en") return c;
  let dn = regionNames.get(locale);
  if (!dn) { dn = new Intl.DisplayNames([locale], { type: "region" }); regionNames.set(locale, dn); }
  return dn.of(code) ?? c;
}
export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const daysUntil = (d: string) => Math.ceil((Date.parse(d + "T12:00:00Z") - nowMs()) / 86400000);
export const FLAGS: Record<string, string> = {
  "United States": "🇺🇸", Mexico: "🇲🇽", "United Kingdom": "🇬🇧", Japan: "🇯🇵", Ukraine: "🇺🇦",
  Philippines: "🇵🇭", Nigeria: "🇳🇬", Argentina: "🇦🇷", "Saudi Arabia": "🇸🇦", Germany: "🇩🇪",
};
export const flag = (c: string) => FLAGS[c] ?? "🏳️";
/** Short result label: "KO R4", "UD", "DQ R3", "Draw". */
export const methodLabel = (m: string | null, r: number | null, t: T = tEn) =>
  !m ? "—" : m === "DRAW" ? t("Draw") : m === "TDRAW" ? (r ? t("Tech draw R{r}", { r }) : t("Tech draw")) : m === "NC" ? t("No contest") : endsEarly(m) && r ? t("{m} R{r}", { m: t(m), r }) : t(m);
