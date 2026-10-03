import type { DatabaseSync } from "node:sqlite";
import { PoliteFetcher, type FetchOutcome } from "../research/fetcher";
import { publicHostOnly } from "../research/netguard";
import { squash } from "../research/text";
import { accountsDb, audit, nowIso } from "./store";

/**
 * Has the quote on a contribution really been said on the page it links to? Run by code when a reviewer asks, with the research
 * pipeline's polite fetcher (robots.txt, one request at a time per site, never BoxRec, no workaround for a block) in its strict mode:
 * the address and any redirect are checked so a link cannot be used to reach this server's own network. The result is shown to
 * reviewers only, so a proposer cannot use it to probe addresses.
 */
export type SourceCheck = "quote_found" | "quote_missing" | "unreadable" | "unavailable";

/**
 * Wikipedia and many news pages put footnote markers ("[ 1 ]", "[ b ]") inside the sentence and space out punctuation ("art . Taking"),
 * which a person copying the words would not. Both sides are tidied the same way before comparing; the words themselves still have to match.
 */
const plain = (s: string) => squash(s.replace(/\[ ?[A-Za-z0-9]{1,3} ?\]/g, " ")).replace(/\s+([.,;:!?])/g, "$1").replace(/\s+/g, " ").trim();
export const checkQuote = (text: string, quote: string): boolean => plain(text).includes(plain(quote));

export async function runSourceCheck(id: number, reviewer: string, acc: DatabaseSync = accountsDb(), get?: (url: string) => Promise<FetchOutcome>): Promise<SourceCheck | "not_found"> {
  const c = acc.prepare("SELECT source_url, quote FROM contributions WHERE id = ?").get(id) as { source_url: string; quote: string } | undefined;
  if (!c) return "not_found";
  let result: SourceCheck;
  try {
    const fetchPage = get ?? (() => {
      const contact = process.env.RESEARCH_CONTACT;
      if (!contact) return null;
      const f = new PoliteFetcher({ contact, strictRedirects: true, hostCheck: (h) => publicHostOnly(h), delayMs: Number(process.env.RESEARCH_DELAY_MS ?? 3000) });
      return (u: string) => f.get(u);
    })();
    if (!fetchPage) result = "unavailable";
    else { const res = await (fetchPage as (u: string) => Promise<FetchOutcome>)(c.source_url); result = !res.ok ? "unreadable" : checkQuote(res.text, c.quote) ? "quote_found" : "quote_missing"; }
  } catch { result = "unreadable"; }
  acc.prepare("UPDATE contributions SET source_check = ?, source_checked_at = ? WHERE id = ?").run(result, nowIso(), id);
  audit(acc, reviewer, "source_check", `#${id}`, result);
  return result;
}
