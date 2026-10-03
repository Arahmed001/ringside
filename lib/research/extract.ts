import { squash } from "./text";
import type { FactEvent, FactKind, ResearchFact } from "./types";

export type Ask = (system: string, user: string, maxTokens?: number) => Promise<string>;

export interface ExtractTask { event?: FactEvent; fighter?: string; year?: number; want: FactKind[] }

const SYSTEM = `You extract boxing money facts from one web page for a statistics site. Return ONLY a JSON object {"facts":[...]}.
Each fact: {"kind","event":{"name","date","venue","city","fighters":[two main-event boxers]},"fighter","year","values":{...},"basis","source","quote","note"}.
Kinds and value keys: event_financials {gateUsd, ticketsSold, capacity, siteFeeUsd, ppvBuys, ppvPriceUsd, ppvRevenueUsd, sponsorshipUsd}; purse {guaranteedUsd, bonusUsd, totalUsd} (needs "fighter"); broadcast {broadcaster, platform: ppv|streaming|subscription|free-tv, region, viewersAvg, viewersPeak}; earning {totalUsd, ringUsd, offRingUsd} (needs "fighter" and "year").
Hard rules:
- Use ONLY what the page text says. Never use your own memory. If the page does not state a figure, omit it. No guessing, no arithmetic on your own (a sum the page states is fine).
- "quote" must be copied WORD FOR WORD from the page text, at most 40 words, and must contain every number you report in that fact.
- Numbers as plain numbers in US dollars (72198500, not "$72.2 million"). If the page gives another currency, skip the figure.
- basis: "disclosed" if the page is itself an official record (commission, filing, the promoter's own statement); "reported" if it says a named outlet or person reported it; "estimated" if the page calls it an estimate or approximate.
- "source" is the publisher of the page (e.g. "ESPN"). One fact per figure group per subject; do not repeat.`;

/** Asks Claude for facts on one page, then keeps only those whose quote really is on the page (a hallucinated quote is dropped here, before the checker ever sees it). */
export async function extractFromPage(o: { ask: Ask; text: string; url: string; task: ExtractTask; agent?: string; today?: string }): Promise<{ facts: ResearchFact[]; dropped: number }> {
  const subject = o.task.event ? `the card ${o.task.event.name} on ${o.task.event.date} (${o.task.event.fighters.join(" vs ")})` : `the boxer ${o.task.fighter}${o.task.year ? ` in ${o.task.year}` : ""}`;
  const user = `Find these kinds of facts: ${o.task.want.join(", ")}. About: ${subject}.\nPage URL: ${o.url}\n\nPAGE TEXT:\n${o.text.slice(0, 60_000)}`;
  const out = await o.ask(SYSTEM, user, 4000);
  let raw: { facts?: Partial<ResearchFact>[] };
  try { raw = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); } catch { return { facts: [], dropped: 0 }; }
  const page = squash(o.text);
  let dropped = 0;
  const facts: ResearchFact[] = [];
  for (const f of raw.facts ?? []) {
    if (!f.quote || !page.includes(squash(f.quote))) { dropped++; continue; }
    facts.push({ ...(f as ResearchFact), event: f.event ?? o.task.event, sourceUrl: o.url, accessedAt: o.today ?? new Date().toISOString().slice(0, 10), agent: o.agent ?? "bot" });
  }
  return { facts, dropped };
}
