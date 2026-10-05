import { tEn, type T } from "./i18n/t";

/** Canonical professional divisions (men's), lightest to heaviest. */
export interface Division {
  name: string;
  short: string;
  lb: number | null; // upper limit; null = unlimited
  kg: number | null;
  aliases: string[];
}

const D = (name: string, short: string, lb: number | null, kg: number | null, aliases: string[] = []): Division => ({ name, short, lb, kg, aliases });

export const DIVISIONS: Division[] = [
  D("Minimumweight", "MIN", 105, 47.6, ["strawweight", "mini flyweight", "atomweight"]),
  D("Light Flyweight", "LFLY", 108, 49, ["junior flyweight", "super flyweight (108)"]),
  D("Flyweight", "FLY", 112, 50.8, []),
  D("Super Flyweight", "SFLY", 115, 52.2, ["junior bantamweight", "jr bantamweight", "super fly"]),
  D("Bantamweight", "BAN", 118, 53.5, ["bantam"]),
  D("Super Bantamweight", "SBAN", 122, 55.3, ["junior featherweight", "jr featherweight", "super bantam"]),
  D("Featherweight", "FEA", 126, 57.2, ["feather"]),
  D("Super Featherweight", "SFEA", 130, 59, ["junior lightweight", "jr lightweight", "super feather"]),
  D("Lightweight", "LIG", 135, 61.2, ["light"]),
  D("Super Lightweight", "SLIG", 140, 63.5, ["junior welterweight", "jr welterweight", "light welterweight", "super light"]),
  D("Welterweight", "WEL", 147, 66.7, ["welter"]),
  D("Super Welterweight", "SWEL", 154, 69.9, ["junior middleweight", "jr middleweight", "light middleweight", "super welter"]),
  D("Middleweight", "MID", 160, 72.6, ["middle"]),
  D("Super Middleweight", "SMID", 168, 76.2, ["super middle"]),
  D("Light Heavyweight", "LHW", 175, 79.4, ["light heavy", "lhw"]),
  D("Cruiserweight", "CRU", 200, 90.7, ["cruiser", "junior heavyweight"]),
  D("Heavyweight", "HVY", null, null, ["heavy", "hw"]),
];

export const DIVISION_NAMES = DIVISIONS.map((d) => d.name);
const byName = new Map(DIVISIONS.map((d) => [d.name.toLowerCase(), d]));
const byAlias = new Map<string, Division>();
for (const d of DIVISIONS) for (const a of d.aliases) byAlias.set(a, d);

/** "Welterweight" or "Women's Welterweight": the divisions share names and limits, but the rankings are separate. */
export const divisionLabel = (name: string, sex: "male" | "female", t: T = tEn) => (sex === "female" ? t("Women’s {division}", { division: t(name) }) : t(name));

export const slugifyDivision = (n: string) => n.toLowerCase().replace(/\s+/g, "-");
export const divisionFromSlug = (s: string) => DIVISIONS.find((d) => slugifyDivision(d.name) === s);
export const divisionInfo = (name: string) => byName.get(name.toLowerCase());

export function limitLabel(d: Division, t: T = tEn): string {
  return d.lb === null ? t("Over 200 lb") : t("{lb} lb · {kg} kg", { lb: d.lb, kg: d.kg ?? "" });
}

/**
 * Maps vendor strings ("Jr. Welterweight", "Light-Middle", "154lbs", "Super-Middle", "Women's Featherweight", "Super Light (140)", "Over 200 lbs") to a canonical
 * name. A "Women's" or "Female" prefix is dropped (the sex is its own field, and the divisions share names), and so is a limit in brackets ("(140)", "(126 lbs)").
 */
export function normalizeDivision(raw: string): string | null {
  const s = raw.toLowerCase().replace(/[.\-_]/g, " ").replace(/\bjr\b/, "jr").replace(/^(women'?s|womens|female|ladies|men'?s|male)\s+/, "").replace(/\s*\(\s*\d{2,3}\s*\+?\s*(?:lbs?|pounds)?\s*\)/, "").replace(/\s+/g, " ").trim();
  if (/^(?:over|above)\s*200\b|^200\s*\+/.test(s)) return "Heavyweight"; // the limit's own words: "over 200 lbs" is the heavyweight limit, not the cruiserweight one (the pound match below would read 200)
  const exact = byName.get(s) ?? byAlias.get(s);
  if (exact) return exact.name;
  const stripped = s.replace(/\s*weight$/, "");
  for (const d of DIVISIONS) {
    if (d.name.toLowerCase().replace(/weight$/, "").trim() === stripped) return d.name;
    if (d.aliases.some((a) => a.replace(/weight$/, "").trim() === stripped)) return d.name;
  }
  const lb = s.match(/(\d{3})\s*(?:lb|lbs|pounds)/);
  if (lb) {
    const n = +lb[1];
    const hit = DIVISIONS.find((d) => d.lb === n);
    if (hit) return hit.name;
  }
  return null;
}
