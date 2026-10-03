# California purses and gates: how to get them, and how they go in

**What changed.** The survey (`docs/data-sources-survey.md`) expected CSAC purse sheets to be downloadable. They are not: the commission's Events page (https://www.dca.ca.gov/csac/events/index.html, read 2026-10-03) says event results are no longer posted there and sends boxing results to BoxRec, which Ringside never uses, and MMA to combatreg.com. Press reports (ESPN, Sports Illustrated) say California rules make purses public and cite commission figures, so the commission has them. The way to get them is to ask.

## 1. Ask: a public-records request

A person sends this (the DCA, the department that houses CSAC, takes records requests; **find the current submission route on dca.ca.gov or call CSAC on (916) 263-2195 and ask where California Public Records Act requests go**, because that route changes and this repository should not guess it). Keep the request narrow and specific: a short list of cards gets a faster, cheaper answer than "everything".

> **Subject:** Public records request: purse and attendance reports for sanctioned boxing events
>
> Under the California Public Records Act, I request copies of the following records held by the California State Athletic Commission for the professional boxing events listed below:
> 1. the post-event report(s) that show each boxer's purse (guaranteed amount and any bonus);
> 2. the report(s) that show paid attendance, gate receipts and ticket sales, if the Commission collects them;
> 3. the official results.
>
> Events: [EVENT NAME, DATE, VENUE] ... (list up to ten)
>
> Electronic copies by email are preferred. If any part is withheld, please identify the exemption relied on for each record, and release the rest. If fees apply, please tell me the estimate before copying.
>
> [YOUR NAME] · [EMAIL] · [PHONE]

**Choose the cards by what the site needs:** recent California world-title cards first (the ones fans look up), then notable older ones. Names of boxers on a purse report are public; **do not ask for anything beyond purses, attendance, receipts and results** (no licence files, no medical records: Ringside's rule is public pay for public sporting events only).

Keep the reply (the PDF and the email) as it came. It is the evidence.

## 2. Put it in the claim pipeline

For each figure in a reply, write a claim as in `docs/research.md`, with `source` = "California State Athletic Commission (public records response)", `basis` = `disclosed` (an official record), `quote` = the line as the document words it, and `sourceUrl` = see below. Kinds: `purse` (one per boxer) and `event_financials` (gate, tickets, attendance).

**The one gap:** `npm run research -- check` confirms a claim by fetching its web page again and finding the quote. A PDF that arrived by email has no page to fetch, and the checker reads HTML and text only. Until it can check a local document (a planned change: PLAN §52), such claims cannot reach "verified" by code. The honest options meanwhile:
- put them in `data/research/inbox/` as usual: they will show as `unconfirmed`, and nothing is published for them;
- or, only for a figure the owner has read in the document himself or herself, settle it with a `decisions.jsonl` entry that says so.

Neither is silent, and nothing is ever published from a claim the checker did not confirm or a person did not decide.

## What a purse figure does and does not say

A commission purse is the **guaranteed** amount in the contract. It omits pay-per-view shares, sponsorship and promoter deals, and Saudi-funded cards show nominal figures. Every claim's `note` should say so; the money pages already label the basis.
