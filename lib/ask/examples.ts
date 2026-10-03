import type { World } from "../world";
import type { T } from "../i18n/t";
import { pound4pound } from "../rankings";
import { featuredYear } from "../fight-score";

/** The example questions on the page. Each one must be understood by the rule-based planner in both languages (a test checks it). */
export function exampleQuestions(w: World, t: T): string[] {
  const [first, second] = pound4pound(w, 2);
  const fy = featuredYear(w);
  return [
    t("Who has the most knockouts among women?"), t("Longest title reigns at {division}", { division: t("Welterweight") }), t("Who are the current champions at {division}?", { division: t("Lightweight") }),
    ...(fy ? [t("Best fight of {year}", { year: fy })] : []), t("Biggest upsets of all time"), t("Upcoming fights where the underdog could win"), t("Highest gates"), t("Who are the best trainers?"),
    ...(first && second ? [t("Compare {a} and {b}", { a: t.name(first.name), b: t.name(second.name) })] : []),
  ];
}
