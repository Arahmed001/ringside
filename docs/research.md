# Research: finding boxing money data on the open web

Ringside's money pages (gates, tickets, pay-per-view, purses, broadcasters, audiences, yearly earnings) need figures that no free feed carries
in full. They are scattered across commission filings, company reports, news stories and reference sites. This describes how researchers (Claude
agents browsing the web, or the extraction bot) gather them, and why nothing they claim is published until code has checked it.

## The rule: claim, then check
A researcher never writes to the database. It writes **claims** to `data/research/inbox/<name>.jsonl`, one JSON object per line:

```json
{"kind":"event_financials","event":{"name":"Mayweather vs Pacquiao","date":"2015-05-02","venue":"MGM Grand Garden Arena","city":"Las Vegas","fighters":["Floyd Mayweather Jr.","Manny Pacquiao"]},
 "values":{"gateUsd":72198500,"ticketsSold":16219},"basis":"disclosed","source":"Nevada Athletic Commission","sourceUrl":"https://…","quote":"…word for word from that page, with the figures…","accessedAt":"2026-10-03","note":"gate excludes closed-circuit","agent":"agent-a"}
```

| kind | extra fields | values (US dollars; counts as plain numbers) |
|---|---|---|
| `event_financials` | `event` | `gateUsd ticketsSold capacity siteFeeUsd ppvBuys ppvPriceUsd ppvRevenueUsd sponsorshipUsd` |
| `purse` | `event` (the bout's two boxers), `fighter` | `guaranteedUsd bonusUsd totalUsd` |
| `broadcast` | `event` | `broadcaster` `platform` (ppv, streaming, subscription, free-tv) `region` `viewersAvg viewersPeak` |
| `earning` | `fighter`, `year`, and `list` (the ranking: `Forbes 2024 list`, `Sportico 2024 list`) | `totalUsd ringUsd offRingUsd` |

`basis`: **disclosed** only for an official record (a commission's purse disclosure, a company filing, the promoter's own statement); **reported** when a named
outlet cites people or documents; **estimated** when the page calls it an estimate or it is worked out from other figures. `npm run research -- check` then:

1. rejects malformed claims;
2. **fetches the page again, in code**, and requires the `quote` to be on it word for word and every number claimed to be stated in the quote (an invented quote or a misread figure is `unconfirmed`);
3. groups claims by what they describe and requires **two independent sites** (at least one not Wikipedia) within 5% of each other, or one official `.gov` record, to call a figure `verified`; a lone site is `single_source` (held back unless you promote with `--allow-single-source`); sites that disagree are a `conflict` for a person to settle (see "Settling a conflict"). Each value on a claim has its own status (`fields` in `checked.jsonl`), so one disputed value does not hold back the others, and `promote` publishes value by value;
4. `promote` matches verified claims to fighters, cards and bouts already in the database by date (a day either side) and both boxers' names, and refuses to guess: anything it cannot pin to exactly one bout is listed as unmatched. A site claiming `disclosed` that is not an official host is downgraded to `reported`.
5. `apply` writes the rows (replaced per source, so re-running never duplicates) through the same quality gate the vendor feeds use.

## Settling a conflict
Most conflicts are not disagreements. Check which of these it is before deciding anything:
- **Different lists.** Forbes counts twelve months to 1 May, Sportico counts the calendar year, so Canelo's "2024" is $85 million on one and $73 million on the other. Put each figure's ranking in `list`; earnings are compared only within one list, and `promote` writes one row per list (the row's source is the list's name, so a re-run replaces it and never duplicates).
- **A floor against a round number.** "At least 650,000" and "around 700,000" are compatible. An early "over 800,000" is a lower bound, not a rival to 830,000.
- **A computed figure.** Buys times price is arithmetic on another claim, not a second source.
- **One origin repeated.** Three sites quoting one reporter's number are one source. The checker counts sites, not origins, so read the quotes before trusting a "verified".
- **A real disagreement.** Then find a tie-break: a page that is itself evidence (a contemporaneous price list, a second independent outlet), add it to `data/research/inbox/` as a claim like any other and run `check`. Often that settles it with no decision at all (De La Hoya–Mayweather: HBO's own $54.95 list price beat Fox's "$50").

When a claim should still not count, record it in `data/research/decisions.jsonl`, one line each:
```json
{"action":"exclude","claims":["fed1a53ff257"],"fields":["ppvPriceUsd"],"why":"outlier","reason":"…what the evidence shows, in a sentence…","evidence":["https://…"],"decidedBy":"you","date":"2026-10-03"}
```
`why` is `outlier`, `floor`, `preliminary`, `derived`, `hearsay` or `different-list`. A decision can only **take a figure out of the comparison**, never put one in: what is left is judged as usual, so it still needs two independent sources to be verified, and an excluded claim is never published (status `excluded`, with the reason shown in `docs/research-results.md`). Claims are named by id, which hashes their values; if a claim is edited the decision no longer matches, `check` prints `STALE decision`, and a test fails until someone looks. A test also fails while any `conflict` is left open in `checked.jsonl`. `npm run research -- lint` checks the decisions file offline.

## What researchers may and may not do
- Read pages one at a time, as a person would: no bulk crawling, no downloading whole sites, no scraping behind logins or paywalls, no CAPTCHA solving, no changing identity to get round a block. A 403, 429 or challenge page means that source is closed to us; note it and move on.
- Respect `robots.txt` (the fetcher enforces it) and the site's terms. **Never BoxRec** (its terms forbid it; data is licensed to partners only). Do not circumvent the Nevada Athletic Commission site's blocking: its event PDFs have to be downloaded by hand by a person and dropped into `data/research/manual/` for transcription. See `docs/data-sources-survey.md` for what each source allows.
- Take facts, not prose. Store the figure, the source and a short quote; never copy articles. Facts are not copyright, expression is, and a forty-word quote is a citation, not a reproduction.
- Never record a number from memory. If the page does not say it, it does not go in. If two pages differ, record both, with their own URLs.
- Identify the bot: the fetcher sends `RingsideResearch/0.1 (+RESEARCH_CONTACT)` and waits 3 s between requests to one host. `RESEARCH_CONTACT` must be your own email or site (set it in `.env.local`).
- People's money is sensitive: only publicly reported pay for public sporting events (purses, disclosed earnings lists), never private finances, sponsorship contract terms that were leaked, or anything about a person who is not a professional boxer or boxing figure.

## Good sources, roughly in order of reliability
Official: athletic commission event reports and, where the law still allows it, purse disclosures. **Purses are public in California; Nevada made them confidential in July 2020 (NRS 467.1005) and Florida and Arizona followed**, so for recent Nevada cards the commission gives gates and attendance at best, and purses can only be `reported`. Also Texas (receipts reports by public-records request), New York, the UK Board of Control, Saudi GEA announcements (press only), company filings (SEC: TKO Group, Endeavor, Live Nation, MSG Sports, DAZN Group accounts at Companies House), promoter and broadcaster press releases (gate and attendance, Netflix/DAZN viewership releases).
Press: ESPN, The Ring, Sports Business Journal, Forbes (athlete earnings lists), Bloomberg, Variety, Sky Sports, BBC, Reuters, Nielsen/Barb-based reports, venue announcements.
Reference (a second opinion, not a primary source): Wikipedia event articles and its pay-per-view lists (CC BY-SA, cite as "Wikipedia (CC BY-SA 4.0)"), Wikidata.

## Beyond money: what else fight fans want (and where it can legitimately come from)
The same pipeline works for any fact with a source and a quote; the schema would grow a `kind` per topic. Candidate datasets, with the access question that decides each:

| Dataset | Why fans care | Where from | Access |
|---|---|---|---|
| Fight-night odds and line movement | betting context, upset history | licensed odds feeds | paid API; most odds sites forbid scraping |
| Commission medical suspensions, licences, withdrawals | health and availability | commission databases | public records, often PDF, by hand |
| Judges' and referees' round-by-round cards | controversy analysis | commissions, broadcasters | partial; some paid |
| Punch statistics | styles, accuracy | CompuBox | paid licence |
| Belt lineage and vacancies | who was champion when | sanctioning-body sites, Wikipedia lists | public pages, check each body's terms |
| Amateur pedigree: Olympics, national titles | prospects and context | Olympedia, Wikipedia, federations | open or CC |
| Training camps, gyms, trainer histories | the team data nobody has | interviews, press, editors | editor workflow with a source per row |
| Ring-walk music, venue details, event posters | colour and archive | licensed or editorial | rights vary |
| Hall of Fame and award rosters | history | IBHOF, BWAA, Ring pages | public lists |
| Social following and streaming audience | marketability | platform APIs | rate-limited APIs |
| Sanctioning-body rankings history | official pecking order | WBC/WBA/IBF/WBO pages, archives | public pages, terms vary |

## Running it
```bash
echo 'RESEARCH_CONTACT=you@example.org' >> .env.local     # your own contact, never someone else's
npm run research -- check            # confirm every claim in data/research/inbox/*.jsonl against its live page
npm run research -- report           # counts by status, kind and site
npm run research -- promote          # match verified claims to the database -> data/research/money-feed.json
npm run research -- apply            # write them into the database
npm run research -- extract --url https://… --event "Name|2015-05-02|Floyd Mayweather Jr.;Manny Pacquiao" --want event_financials,purse   # the bot; needs ANTHROPIC_API_KEY
```
`promote` only matches claims about fighters and cards that exist in the database, so real research needs the real data feed loaded first
(the demo league is fictional, so the claims researched here are kept in `data/research/` until it is).
