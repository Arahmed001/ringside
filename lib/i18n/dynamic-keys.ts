import { DIVISIONS } from "../divisions";
import { METHODS, METHOD_NAME } from "../methods";
import { ARCHETYPES } from "../style";
import { ROLE_LABEL } from "../team";
import { TERMS } from "../model";
import { WEIGHT_CLASSES } from "../types";

/**
 * Strings that reach t() through a variable (a table lookup, a database value) instead of a literal, so the source
 * scanner cannot see them. Anything user-visible that comes from one of these sets is translated with t(value), and
 * the sets are listed here so `npm run i18n:extract` includes them and the test suite can prove every one has Arabic.
 * Page-local tables use msg("...") instead, which the scanner does pick up.
 */
export function dynamicKeys(): string[] {
  const keys = new Set<string>();
  const add = (...xs: string[]) => xs.forEach((x) => keys.add(x));
  add(...DIVISIONS.map((d) => d.name), ...DIVISIONS.map((d) => d.short), ...WEIGHT_CLASSES);
  add(...METHODS, ...Object.values(METHOD_NAME));
  add(...ARCHETYPES, ...Object.values(ROLE_LABEL), ...Object.values(TERMS).map((x) => x.label));
  add("Orthodox", "Southpaw", "Switch", "Toss-up", "Lean", "Clear favourite", "Heavy favourite");
  add("scheduled", "completed", "cancelled", "postponed");
  add("rating", "wins", "knockouts", "KO rate", "age", "reach");
  return [...keys].sort();
}
