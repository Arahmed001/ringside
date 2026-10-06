# Search-engine and link-sharing audit (pre-launch)

Method: `npm run build`, `next start` twice on free ports, one as the demo (default) and one indexable (`INDEXABLE=1` with a non-local `SITE_URL`, because the demo data is all there is to crawl), then every page type fetched in English and Arabic: five or one of each, 168 pages, plus query-string variants, missing pages and the image URLs the tags name. For each: `<title>`, description, canonical, hreflang, Open Graph and Twitter tags, JSON-LD, robots meta and headers, heading order. The regression tests are in `tests/seo-audit.test.ts`.

## Checked and fine

- **Titles.** Present and unique on every page type and language sampled; no generic "Ringside" title on a content page. Fighter, event, bout and preview titles carry the names. Pages 2+ of a list say "Page 2".
- **Canonical and hreflang.** Every page names `en`, `ar` and `x-default`, each language page lists the same set (so each points to the other), and the sitemap repeats the same alternates. Canonicals never carry a query string: `?sort=`, `?page=`, `?sex=`, `?year=`, `?tab=`, `?x=1` all canonicalise to the bare page. English has one URL (`/en/...` is a 308 to the bare path; a trailing slash is a 308; upper-case slugs are a 404).
- **404.** Unknown fighters, events, bouts, countries, belts, divisions, people, organisations, years, lists, unknown locales and `/sitemaps/9.xml` return a real 404 with `noindex`, in both languages. The fighter 404 offers the nearest names.
- **Headings.** One `<h1>` and no skipped levels on every page type (after the fix below).
- **Structured data that was already right.** `Person` (fighter, trainer, judge, referee: only name, nationality, birth date, height, photo and Wikidata link when held), `SportsEvent` (event and preview: date, venue, the two main-event fighters, status), `Organization` (gyms, promotions, bodies), `ItemList` (all-time lists, fight of the year). Nothing in it is a rating, a prediction or a claim about how anything was produced.
- **The demo stays hidden.** With `BOXING_PROVIDER=demo` (or unset): every page `noindex, nofollow`, `robots.txt` is `Disallow: /`, `/sitemap.xml` and `/sitemaps/N.xml` are 404, no JSON-LD is emitted.
- **Sitemap.** `/privacy`, `/terms` and every other public static page, each event, each fighter with a fight, countries, belts, divisions, all-time lists, fight-of-the-year years, people, organisations, title fights and main events, and previews are listed in both languages. Per-file size and URL count stay under both limits (see below).
- **Private pages** (`/account`, `/picks`, `/watchlist`, `/leaderboard`, `/report`, `/review`, `/contribute`) are `noindex` and not in the sitemap; `/embed/` and `/api/` are disallowed in `robots.txt`.

## Found and fixed

| # | Defect | Fix |
|---|--------|-----|
| 1 | A live site with real data but **no `SITE_URL`** was indexable, with canonicals, hreflang, share images and sitemap pointing at `http://localhost:3000`. | `indexable()` now needs real data (or `INDEXABLE=1`) **and** a public `SITE_URL` (http or https, not localhost/127.x/::1). Without it: `noindex`, `robots.txt` disallows all, no sitemap. The doctor says so; the start-up config line reports the real answer. |
| 2 | **Share cards were empty on about 40 page types.** Each page sets its own `openGraph`, which drops the layout's image, yet declares `twitter:card: summary_large_image`. A link to `/rankings`, `/learn`, a person, an organisation, an all-time list and so on showed no picture. | `pageMetadata` falls back to the site card (`/opengraph-image`, `/ar/opengraph-image`) for every page without its own image file. A test keeps the list of pages with their own card in step with the `opengraph-image` files on disk. |
| 3 | The English share-image URL the tags name is `/en/.../opengraph-image`, which the proxy **redirected (308)**. Several scrapers do not follow a redirect for an image. | The proxy serves `/en/**/opengraph-image` directly. The pages themselves still redirect `/en/...` to the bare path. |
| 4 | **Descriptions up to 271 characters** (previews, all-time lists, matchmaking, trainers, bouts in Arabic) are cut wherever an engine likes, usually mid-word. | Every description is clamped to 160 characters in `pageMetadata`, at the end of a sentence when one fits, otherwise at a word with an ellipsis. Open Graph and Twitter say the same. |
| 5 | **Generic descriptions** on the all-time record lists ("Wins on record, by any method.", 30 characters). | Short one-line definitions are prefixed with the list name ("Most wins, all-time: ..."), in both languages. |
| 6 | **Thin pages offered to search engines.** The sitemap leaves out fighters with no fights, cancelled events and bouts, undercard bouts, upcoming bouts (the preview answers them) and previews beyond the co-main, but the pages themselves were `index, follow`, so a link could still get them listed. | The sitemap and the pages now share one set of rules (`isListedBoxer/Event/Bout/Preview` in `lib/sitemap.ts`); a page that is not listed is `noindex, follow`. |
| 7 | **Search results as pages.** `?q=` on any list returned an indexable page (canonical to the list, but a different title and content). | The proxy sends `X-Robots-Tag: noindex, follow` when `q` is non-empty. Sorting, paging and filters stay canonicalised to the bare page and are not hidden. |
| 8 | The **404 page carried two contradictory robots tags** (Next's `noindex` and the layout's `index, follow`). | The not-found page sets its own robots, so there is one. |
| 9 | **Two `<h1>` on every fighter page** (the print-only one-page sheet had its own). | The sheet's name is a `div`. |
| 10 | **No BreadcrumbList anywhere.** | Added to fighters, events, bouts, previews, countries, belts, divisions, people and organisations: home, section, page, in the page's language. |
| 11 | The **WebSite block rode on every page**, with no `Organization`. | WebSite (with the site-search action) and a minimal Organization (name and address only) are on the home page, once per language. |
| 12 | `Dataset` on belt pages had **no description** (required for the type to be valid). | It carries the same sentence as the meta description. |
| 13 | Structured-data names used a hard-coded English " vs " in Arabic pages (previews, fight-of-the-year list). | They use the dictionary's `{a} vs {b}`. |
| 14 | **Bout pages had no structured data.** | `SportsEvent` with date, venue, the two fighters and the card it belongs to. No result or winner is stated. |
| 15 | `/developers` was indexable when the API is open but missing from the sitemap. | Listed when the gate is open (it is `noindex` otherwise, as before). |

## Sitemap at 35,000 fighters

`PATHS_PER_FILE` is 10,000 paths, and every path is listed once per language, so a file holds at most 20,000 `<url>` entries (limit 50,000). Each entry with its three alternates is about 0.55 KB, so a full file measures 10.7 MB (limit 50 MB uncompressed). A synthetic 68,000-path site (35,000 fighters, 24,000 events, 9,000 bouts) splits into 7 files behind `/sitemap.xml`, with no path lost or repeated and `/sitemaps/7.xml` a 404 (`tests/seo-audit.test.ts`). The demo league is 3,186 paths in one file.

## Left (decided, or not worth doing now)

- **Titles longer than about 60 characters** (previews, belt pages, 80 to 95 characters with the site name) will be shortened by the engine. They name both fighters or the belt and division, which is what a searcher types; shortening them means a second Arabic phrasing per page type. Revisit with real search-console data.
- **`robots.txt` disallows the whole demo site** as well as marking it `noindex`. A crawler that obeys `Disallow` never reads the `noindex`, so a link from elsewhere could in theory list the bare URL without content. For fictional data that is the safer side; it is the opposite of what a live site wants, and the live site has neither.
- **No 410.** Nothing in the data model records "removed on purpose" versus "never existed", so both are a 404 (search engines drop a 404 after a few visits). If removals are logged later, a 410 can be added in the same place.
- **`/previews/<id>` of a finished fight** answers with a 307 to the bout page. It is correct while the fight is a preview; nothing links to it after.
- **Home canonical has no trailing slash** (`https://site.example`) where the sitemap and hreflang write `https://site.example/`. They are the same URL.
- **`robots.txt` is generated per request** so a build made on one provider can be deployed on another; a CDN in front must not cache it long.
- **The preview description loses its last sentence** ("The model favours ...") when the stand-first is long; the sentence is on the page.
- **Not measured here:** Core Web Vitals, rich-result validation by Google's own tool (no network from the audit machine), and real hreflang reciprocity in Search Console. Do these on the live site in the first week.
