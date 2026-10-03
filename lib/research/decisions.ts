import type { CheckedFact } from "./types";

/**
 * A recorded decision about a claim the cross-check cannot settle by itself. One line per decision in data/research/decisions.jsonl:
 *
 *   {"action":"exclude","claims":["<claim id>"],"fields":["ppvBuys"],"why":"outlier","reason":"...","evidence":["https://..."],"decidedBy":"claude-research","date":"2026-10-03"}
 *
 * Only exclusion exists, on purpose: a decision can take a figure out of the comparison and say why, but it can never put a number
 * into the database that no page states. What is left is then checked as usual, so a figure still needs two independent sources.
 * A claim is named by its id, which hashes its values: if the claim is edited the decision stops matching and is reported as stale.
 */
export type ExcludeWhy =
  | "outlier"       // one source against two or more independent ones, and the evidence says it is the one that is wrong
  | "floor"         // an "at least" or "over" figure that is compatible with the exact one, not a disagreement with it
  | "preliminary"   // an early report that later reporting superseded
  | "derived"       // computed from other figures rather than published
  | "hearsay"       // the source itself only passes on an unnamed report
  | "different-list"; // belongs to another ranking with another period (use the `list` field instead where you can)

export const WHY: ExcludeWhy[] = ["outlier", "floor", "preliminary", "derived", "hearsay", "different-list"];

export interface Decision {
  action: "exclude";
  claims: string[];
  /** The values it applies to; all of the claim's values when omitted. */
  fields?: string[];
  why: ExcludeWhy;
  reason: string;
  /** Pages that show why (the claim's own page is not evidence for dropping it). */
  evidence: string[];
  decidedBy: string;
  date: string;
}

export function decisionProblems(d: Decision): string[] {
  const p: string[] = [];
  if (d.action !== "exclude") p.push(`unknown action "${d.action}"`);
  if (!Array.isArray(d.claims) || !d.claims.length || d.claims.some((c) => typeof c !== "string" || !c)) p.push("claims must list at least one claim id");
  if (d.fields !== undefined && (!Array.isArray(d.fields) || !d.fields.length)) p.push("fields, when given, must name at least one value");
  if (!WHY.includes(d.why)) p.push(`why must be one of ${WHY.join(", ")}`);
  if (!d.reason?.trim() || d.reason.trim().split(/\s+/).length < 6) p.push("reason is required: say what the evidence shows, in a sentence");
  if (!Array.isArray(d.evidence) || !d.evidence.length || d.evidence.some((u) => !/^https?:\/\//.test(u))) p.push("evidence must list at least one http(s) page");
  if (!d.decidedBy?.trim()) p.push("decidedBy is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "")) p.push("date must be yyyy-mm-dd");
  return p;
}

/** Decisions whose claims are not among `facts` (the claim changed or was removed): they apply to nothing and a person should look. */
export function staleDecisions(decisions: Decision[], facts: Pick<CheckedFact, "id">[]): { decision: Decision; missing: string[] }[] {
  const ids = new Set(facts.map((f) => f.id));
  return decisions.map((decision) => ({ decision, missing: decision.claims.filter((c) => !ids.has(c)) })).filter((x) => x.missing.length);
}
