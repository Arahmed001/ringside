# Title reigns from Wikipedia's champions lists

`npm run champions:import` reads Wikipedia's lists of WBA, WBC, IBF and WBO world champions and stores every reign: who held the belt, from which date to which, who they beat for it, how many defences, and why it ended when the page says. A fighter's page shows the reigns of the fighters we could link, credited to Wikipedia (CC BY-SA 4.0) with a link to the list.

## What it is, and what it is not

- **A reference, not an official record.** Wikipedia is crowd-edited. Each row carries the page and the revision it came from, and the fighter page says so. The Transnational Boxing Rankings Board's lineage (`docs/tbrb-enquiry.md`) is a separate source, to be added only if it agrees in writing; it never mixes into a Wikipedia row.
- **Facts from a table, not prose.** The end-of-reign note is cut to a sentence with its citations removed; the list is linked for the rest.
- **Men's lists of the four bodies only.** The women's lists are laid out differently and their pages are older snapshots (the IBF women's page says "Stand: March 6, 2025"); they need their own parser and a freshness check. Not done.

## Running it

```bash
export WIKIMEDIA_CONTACT=your-own-email-or-website
npm run champions:import
```

Use your own address: Wikimedia asks automated clients to identify themselves. The command waits about 1.5 s between requests, waits out a rate limit (Wikipedia limits shared addresses hard: a cloud machine may be refused for minutes), caches each page in `data/wikipedia-cache/` (gitignored), and stops with a plain message if it is refused for good; run it again later, the cache keeps what arrived. Four pages and a few dozen lookups (50 article titles each): a few minutes when Wikipedia is not limiting you.

**Linking comes from Wikidata.** Each reign's name links to a Wikipedia article; the article's Wikidata ID is looked up, and the reign is linked to one of our fighters only if that fighter carries the same ID (`npm run wikidata:import`, then `-- --enrich`, set it). A name that matches by spelling alone is never linked. Two Wikidata entries matched to one fighter would be ambiguous, so neither is linked. After a new `wikidata:import --enrich`, run `npm run champions:import -- --link-only` (no network).

Real fighters are needed for this to show anything: the demo league is fictional, so no reign links to anyone there.

## How a row is read (and what is refused)

| The list says | Stored as |
|---|---|
| `6 May 1989 – 11 Jan 1991` | 1989-05-06 to 1991-01-11 |
| `11 Jan – 28 Dec 1991` | the start's year is the end's: 1991-01-11 to 1991-12-28 |
| `17 Dec 1994 – Mar 1995` | 1994-12-17 to `1995-03` (a month stays a month) |
| `17 May 1990 – 1991` | 1990-05-17 to `1991` (a year stays a year) |
| `Sep 7, 1998` (US style) | read too |
| `… – present` | current |
| a name followed by `– Super champion` | the label is the reign's status ("Super champion"), not part of the name |
| `0<br>(3)` in defences | 0 (the figure in brackets is not read) |
| two rows both numbered 4 (a typo on the page) | both kept, in order; the key is the row's position |
| a division Ringside does not list (Bridgerweight) | kept under the page's name, counted |
| `10 No 1972`, `24 Ma 1980` (misspelt months), or one date with no end | **refused and counted**: "No" might be Nov, "Ma" might be Mar or May, and a reign needs an end. Never guessed |

The command prints how many rows it could not read. In the first run on the saved pages that was 1 on WBA (a single date, Kostya Tszyu's unified reign) and 3 on WBC (two misspelt months and one single date).

WBA's lists have a "Primary champion lineage" and a "Secondary champion lineage" per division (the second holds the other recognised titleholders); both are kept, with the heading in `category`.

## Where it goes

Table `title_reigns` (`lib/importers/wikipedia-champions.ts`, `REIGN_SCHEMA`, created with the database): body, division, category, position in its table, the page's number, name, status, article title and Wikidata ID, our fighter (when linked), start and end (ISO prefixes), current, who they beat, defences, end note, source page, revision, fetched at. Re-running replaces a page's rows: one removed upstream disappears, nothing duplicates.

## Not yet done

- The reigns are **not cross-checked** against the reigns Ringside derives itself from title fights (`lib/lineage.ts`). That would find both our gaps and Wikipedia's errors; it needs real title bouts in the data.
- The women's lists, interim-only lists and the Ring magazine lineage.
- Arabic names for belts and divisions use the existing translations; the status labels have Arabic text written by the project, not yet reviewed by a native speaker.
