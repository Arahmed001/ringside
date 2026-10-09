# Boxing news headlines

The site lists headlines from boxing outlets' own public feeds, each a link to the original story. It keeps the title, the date, the link and the short excerpt the feed itself publishes. It never keeps an article body or an image, and it shows nothing of an outlet's work beyond that.

## Turn it on

```bash
export NEWS_CONTACT=you@example.org                 # required: goes in the User-Agent so an outlet can reach you
npm run news:refresh -- --dry-run                   # lists the feeds it would read; reads none
npm run news:refresh                                # reads them, keeps the new headlines, drops those older than 120 days, looks up Wayback copies
```

Run it hourly from the nightly job's scheduler or cron. It asks only for what changed (ETag / Last-Modified), reads `robots.txt` first and stays away from what it forbids, waits three seconds between outlets, takes only XML up to 1.5 MB, follows no redirect to another site, never fetches a private address, and does not retry a refusal (401, 403, 429). One outlet failing never stops the others. Nothing is shown until a refresh has run: the fighter and card pages show a section only when there are headlines about them.

## Which outlets

`lib/news/sources.ts` lists them, each with why it is allowed. Four independent outlets' public feeds are read by default (Boxing News, Boxing News 24, 15Rounds, World Boxing News). The BBC, The Guardian and Sky Sports limit their feeds to non-commercial sites: they are read only if you set `NEWS_NONCOMMERCIAL=1`, which is your statement that the site earns nothing (no advertising, no sales, no paid tier). Boxing News's excerpts have the names cut out of them, so only its headlines are kept.

To add an outlet, add a line there with its feed address and what its terms say, and confirm it with `--dry-run` before the first read.

## Where it shows

- A fighter's page: "In the news", the five newest headlines that name them.
- A card's page: the six newest that name a fighter on the card.
- `/news`: the 60 newest, filtered by outlet (`?source=`). Kept out of search results.

A headline is credited to a fighter only when their whole name (two words or more) appears in the title or excerpt, the name is one fighter's in the whole league, and they have fought at least three times. It errs towards saying nothing.

## Wayback copies

Each headline gets a link to a Wayback Machine copy when the Internet Archive has one ("Archived copy"), so a link that goes dead still leads somewhere. A story from today is usually not archived yet; a headline without a copy is asked about again after a week, 25 at a time, one a second.

## What the visitor sees and sends

Links open the outlet's own page in a new tab with `noopener noreferrer nofollow`. Nothing is loaded from an outlet's site when a page is viewed: no image, script or frame. The privacy page needs no change.
