/**
 * Bouts that were billed as exhibitions: no official result, not in either fighter's professional record. The supplier lists them as ordinary
 * fights (a knockout win in a three-round "bout"), which put Floyd Mayweather's held record three wins above his real fifty. The list is
 * curated by hand from the events' own billing, each entry a date and the two fighters' names; a bout that matches is shown as an exhibition,
 * has no winner and stays out of every record and rating. Add a line here when a new one turns up.
 */
const EXHIBITIONS: [string, string, string][] = [
  ["2018-12-31", "Floyd Mayweather", "Tenshin Nasukawa"],
  ["2020-11-28", "Mike Tyson", "Roy Jones Jr"],
  ["2021-06-06", "Floyd Mayweather", "Logan Paul"],
  ["2022-05-21", "Floyd Mayweather", "Don Moore"],
  ["2022-09-25", "Floyd Mayweather", "Mikuru Asakura"],
  ["2022-11-13", "Floyd Mayweather", "Oladeji Olatunji"],
  ["2022-12-11", "Manny Pacquiao", "DK Yoo"],
  ["2024-08-24", "Floyd Mayweather", "John Gotti III"],
];

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const KEYS = new Set(EXHIBITIONS.map(([d, a, b]) => `${d}|${[fold(a), fold(b)].sort().join("|")}`));

/** Whether the bout on this date between these two fighters was an exhibition. */
export const isExhibition = (date: string, a: string, b: string): boolean => KEYS.has(`${date}|${[fold(a), fold(b)].sort().join("|")}`);
