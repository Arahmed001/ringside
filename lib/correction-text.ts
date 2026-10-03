import type { T } from "@/lib/i18n/t";
import { METHOD_NAME, type Method } from "@/lib/methods";

/** Words for the fields of a report, its status and its values: one place, so the form, the queue and the page notes say the same thing. */
export function fieldLabel(t: T, field: string | null): string {
  switch (field) {
    case "birth_date": return t("Date of birth");
    case "height_cm": return t("Height");
    case "reach_cm": return t("Reach");
    case "stance": return t("Stance");
    case "nickname": return t("Nickname");
    case "country": return t("Country");
    case "result": return t("Result");
    case "method": return t("How it ended");
    case "end_round": return t("Round it ended");
    case "other": return t("Something else");
    default: return field ?? "";
  }
}

export function statusLabel(t: T, status: string, state: string | null = null): string {
  if (status === "accepted") return state === "retired" ? t("Accepted, since withdrawn") : state === "vendor_changed" ? t("Accepted, to be rechecked") : t("Accepted");
  switch (status) {
    case "open": return t("Waiting for review");
    case "rejected": return t("Not accepted");
    case "withdrawn": return t("Withdrawn");
    case "noted": return t("Noted, nothing changed");
    default: return status;
  }
}

const methodName = (t: T, m: string) => (m in METHOD_NAME ? t(METHOD_NAME[m as Method]) : m);

/** A stored value as a person reads it. A result is "red|UD" (who won, and how); `names` are the red and blue fighters when they are known. */
export function valueText(t: T, field: string | null, value: string | null, names?: [string, string]): string {
  if (value === null || value === "") return t("none");
  switch (field) {
    case "height_cm": case "reach_cm": return t("{n} cm", { n: value });
    case "end_round": return t("Round {r}", { r: value });
    case "method": return methodName(t, value);
    case "result": {
      const [res, method] = value.split("|");
      const how = method ? methodName(t, method) : "";
      if (res === "red") return how ? t("{name} won: {how}", { name: names?.[0] ?? t("The red corner"), how }) : t("{name} won", { name: names?.[0] ?? t("The red corner") });
      if (res === "blue") return how ? t("{name} won: {how}", { name: names?.[1] ?? t("The blue corner"), how }) : t("{name} won", { name: names?.[1] ?? t("The blue corner") });
      if (res === "draw") return how ? t("Draw: {how}", { how }) : t("Draw");
      if (res === "nc") return t("No contest");
      return value;
    }
    default: return value;
  }
}

/** The two fighters of a fight report, from its "A vs B" name. */
export const namesOf = (targetName: string | null): [string, string] | undefined => {
  const p = targetName?.split(" vs ");
  return p && p.length === 2 ? [p[0], p[1]] : undefined;
};
