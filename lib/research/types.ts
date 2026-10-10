import type { MoneyBasis } from "../providers";

/**
 * One claim a researcher (an AI agent browsing the web, or the extraction bot) wants to add: a number, where it was read,
 * and the exact words that say so. Nothing a researcher claims is trusted: `check` re-fetches the page, confirms the quote is
 * really there and that the numbers match it, and only publishes figures that two independent sources agree on.
 */
export type FactKind = "event_financials" | "purse" | "broadcast" | "earning" | "weigh_in";

export interface FactEvent { name: string; date: string; venue?: string; city?: string; fighters: string[] }

export interface ResearchFact {
  kind: FactKind;
  /** The card (event_financials, purse, broadcast). `fighters` are the two main-event boxers as the source names them. */
  event?: FactEvent;
  /** The boxer a purse or earning is about, as the source names them. */
  fighter?: string;
  /** Calendar year (earning). */
  year?: number;
  /**
   * Earning only: which published ranking the figure comes from, e.g. "Forbes 2024 list (12 months to 1 May 2024)". Lists cover
   * different periods, so figures from different lists are never compared with each other (Forbes and Sportico "disagree" about
   * the same year only because they measure different twelve months). Omit it for a one-off figure with no ranking behind it.
   */
  list?: string;
  /**
   * event_financials: gateUsd ticketsSold capacity siteFeeUsd ppvBuys ppvPriceUsd ppvRevenueUsd sponsorshipUsd
   * purse: guaranteedUsd bonusUsd totalUsd     earning: totalUsd ringUsd offRingUsd
   * broadcast: broadcaster platform(ppv|streaming|subscription|free-tv) region viewersAvg viewersPeak
   * Amounts in US dollars, counts as plain numbers (4600000, not "4.6 million"). Convert other currencies and say so in `note`.
   */
  values: Record<string, number | string>;
  basis: MoneyBasis;
  /** Who published it: "Nevada Athletic Commission", "ESPN", "Wikipedia (CC BY-SA 4.0)". */
  source: string;
  /** The exact page the figure was read from. Exactly one of `sourceUrl` and `document`. */
  sourceUrl?: string;
  /** Instead of a page: the name of a document registered in data/research/manual (a PDF from a records request). See lib/research/documents.ts. */
  document?: string;
  /** A short passage copied word for word from that page that contains the figure(s) (at most about 40 words). */
  quote: string;
  accessedAt?: string;
  note?: string;
  /** Who gathered it (agent name or "bot"), for the review trail. */
  agent?: string;
}

export const VALUE_KEYS: Record<FactKind, { numeric: string[]; text: string[] }> = {
  event_financials: { numeric: ["gateUsd", "ticketsSold", "capacity", "siteFeeUsd", "ppvBuys", "ppvPriceUsd", "ppvRevenueUsd", "sponsorshipUsd"], text: [] },
  purse: { numeric: ["guaranteedUsd", "bonusUsd", "totalUsd"], text: [] },
  broadcast: { numeric: ["viewersAvg", "viewersPeak"], text: ["broadcaster", "platform", "region"] },
  earning: { numeric: ["totalUsd", "ringUsd", "offRingUsd"], text: [] },
  /** pounds: the official weigh-in (usually the day before), the contract limit, and the pre-fight weight where one is published */
  weigh_in: { numeric: ["officialLb", "limitLb", "fightNightLb"], text: [] },
};

/**
 * verified       quote confirmed on the live page, numbers match the quote, and two independent sources agree (or one official one does)
 * single_source  quote confirmed, but only one source: held back unless you promote with --allow-single-source
 * conflict       sources disagree by more than 5%: a person has to look, or records a decision (decisions.ts)
 * excluded       a recorded decision took the claim out of the cross-check, with the reason and evidence (never published)
 * unconfirmed    the page could not be fetched (blocked, paywalled, gone), or the quote or numbers are not on it
 * invalid        the claim itself is malformed
 */
export type FactStatus = "verified" | "single_source" | "conflict" | "unconfirmed" | "invalid" | "excluded";
/** Per value: the same words, except that a claim is only "excluded" or "conflict" for the values that are. */
export type FieldStatus = "verified" | "single_source" | "conflict" | "excluded";

export interface CheckedFact extends ResearchFact {
  id: string;
  host: string;
  status: FactStatus;
  reasons: string[];
  /** For a claim read from a registered document: what it was, copied from the manifest at check time (the hash proves it was unchanged). */
  doc?: { file: string; sha256: string; issuer: string; receivedAt: string; official: boolean; form: "original" | "transcription" };
  /** Other sources that agree (hosts), for the review trail. */
  agreeing?: string[];
  /** Status of each numeric value on its own: one conflicting value no longer holds back the others. */
  fields?: Record<string, FieldStatus>;
  /** The recorded decision that excluded this claim (or some of its values), for the review trail. */
  decision?: { reason: string; why: string; decidedBy: string; date: string; fields?: string[] };
}
