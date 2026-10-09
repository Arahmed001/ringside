# What is in Ringside, and its switches

A map of the features added from 1 to 9 October 2026 (rounds up to 139), one line each: where it is, what controls it, and where the detail lives. Anything not listed as having a switch is always on and is removed by deleting the code named.

| Feature | Where | Switch or tuning | Detail |
|---|---|---|---|
| **Fight calendar** (add a card or a fight to your calendar; a feed of upcoming cards) | the *Add to calendar* buttons; `/feeds/calendar.ics?days=30&slugs=a,b` | none; `days`, `slugs`, `event`, `bout` and `lang` in the address | `docs/calendar.md` |
| **Watchlist and its digest** (what changed for the fighters you star, since you last looked) | `/watchlist`; `/api/watch`, `/api/watch/digest` | stored in this browser (and in your account when signed in) | `docs/watchlist-digest.md` |
| **Arabic belt and body names** | automatic, in every title shown | a vendor-supplied Arabic name wins over the derived one | `docs/arabic-belts.md` |
| **Public JSON API** | `/api/v1/*`; OpenAPI at `/api/v1/openapi.json`; `/developers` | on for the demo league; `PUBLIC_API=0` turns it off; for **licensed** data it is off until `PUBLIC_API=1` **and** `VENDOR_REDISTRIBUTION_CONFIRMED=1` (your statement that the vendor's terms allow it). 60 requests a minute per address; behind a proxy that sets `X-Forwarded-For` | `docs/public-api.md` |
| **Embeds** (a fighter card, a division ranking, for other sites) | `/embed/en/fighter/<slug>`, `/embed/en/rankings/<division>`; the code builder on `/developers` | the same switch as the API; framing is allowed on `/embed` only, nowhere else | `docs/embeds.md` |
| **Page motion** (fade between pages, a progress bar, figures that count up once, a pop on the watch star, a marker on the row under the pointer, dialogs that slide in) | everywhere | none; **all of it is off for visitors who ask their device for reduced motion**; nothing animates on scroll (a test enforces both) | `DESIGN.md`, "Motion" |
| **Sortable columns** | division ranking tables and the four *Corners & officials* tables | none; the choice is in the address (`?sort=ko&dir=desc`), whole list, real places kept | `PLAN.md` §200 and §219 |
| **Hover preview of a fighter** | any link to a fighter's page, on a desktop with a mouse | none; never on touch; remove `<HoverPreview />` from `app/[locale]/layout.tsx` to remove it; data from `/api/fighter-card/<slug>` | `PLAN.md` §201 |
| **Jump strip** on a fighter's page | under the top bar | none | `PLAN.md` §202 |
| **Weight classes heaviest first** | every list of divisions | `DIVISIONS_HEAVIEST_FIRST` in `lib/divisions.ts`; the logic still uses the lightest-first list | `DESIGN.md` decisions log |
| **Forum** (discussion under every fighter and fight, a general board) | the *Discussion* section of those pages; `/forum`; rules at `/forum/rules`; editors at `/review/forum` | **built but not announced**: not in the menu, `noindex` everywhere, plain text and no links. To open it, see "Opening it to the public" in the forum document. Editors are made with `npm run accounts -- role NAME editor` | `docs/forum.md` |
| **Boxing news headlines** (a title, date and link, with the outlet's own short excerpt and the picture its feed offers, saved by us; never a body) | "In the news" on a fighter's and a card's page; `/news` (noindex) | refreshed by `npm run news:refresh`; needs `NEWS_CONTACT`; `NEWS_NONCOMMERCIAL=1` adds the BBC, Guardian and Sky Sports feeds (your statement that the site earns nothing); `NEWS_REFRESH=1` has the nightly job do it | `docs/news.md` |
| **Official videos** (promoters' and networks' own YouTube channels, played in YouTube's own player after a click) | "Official videos" on a fighter's and a card's page and on `/news`; nothing is requested from YouTube until the visitor presses play | your own `YOUTUBE_API_KEY` (or the file `~/.ringside-youtube-key`); without it no videos are listed | `docs/news.md` |
| **Chosen posts** (specific public posts on X, Reddit, Instagram, Facebook, YouTube, shown behind a button) | "Posts" on a fighter's and a card's page and `/news`; editors choose them at `/review/social` | editors only; six per place; the content security policy allows exactly five frame hosts | `docs/news.md` |
| **Recorded pictures** (a fighter's photo with its licence or the rights-holder's permission, and the credit shown beside it) | editors record them at `/review/photos`; `npm run photos:apply` puts them back after a reload | a picture without a licence and a credit cannot be saved; a photo that came with the supplier's feed is never replaced | `docs/photo-permissions.md` |
| **The editors' pages in one place** | the top of `/review`: team-history edits, reports of mistakes, forum moderation, updates from public sources, chosen posts, recorded pictures, each with what waits | editors and administrators only | `docs/operator-handbook.md` section 6 |
| **Source watchers and the approval page** (a public source is compared with what the site holds; a difference becomes a proposal an administrator approves, never a change by itself) | `/review/updates`; `npm run watch -- --source champions` | the nightly job's `WATCH_SOURCES`; the champions lists are the first source | `PLAN.md` §253 to §259 |
| **The vendor update gate** (what a daily update would change in rows the site already holds is reported, or held for approval) | the log and `<data>/gate-reports/`; held changes at `/review/updates` | `VENDOR_GATE=observe` records, `hold` holds; off by default | `docs/vendor-gate-plan.md` |
| **Links to the sanctioning bodies' own lists** | a division's ranking page: "The bodies' own lists: WBC WBA IBF WBO" | none; links only, nothing is copied, because no body grants reuse | `docs/official-bodies.md` |
| **Enrichment from public sources** (Arabic names, birth details, honours, title reigns, venue and fighter photos with their licences) | `npm run vendor:enrich` (a contact for Wikimedia is required; the staged Wikidata boxers are kept in `wikidata-staging.json` beside the database so a clean reload does not fetch them again) | `WIKIMEDIA_CONTACT`; each step resumes | `docs/load-day.md` section 6, `docs/media.md` |
| **Name plates** (a fighter with no photo shows their surname in large capitals, not an invented face) | every fighter picture without a licensed photo | none | `PLAN.md` §255 |
| **The nightly job** (backup, update, watch, news, off-host copy; every optional step a warning, never a failed night) | `npm run nightly`; its status in `/api/health` | `NIGHTLY_SCHEDULE`, `NIGHTLY_OFFSITE_CMD`, `WATCH_SOURCES`, `NEWS_REFRESH` | `docs/nightly.md` |
| **Loading from spreadsheets** (fighters, events and fights from three CSV files) | `docs/spreadsheet-loading.md`; samples in `docs/sample-csv/` | none | `docs/spreadsheet-loading.md` |
| **Vendor data tools** (fetch, load, audit, preview, status) | `npm run vendor:status`, `vendor:fetch`, `vendor:load`, `vendor:audit`, `vendor:site` | the key, the storage statement and the redistribution statement are the owner's (`.env.example`) | `docs/load-day.md`, `docs/real-data-runbook.md` |

## Checks that are worth knowing about

| Command | What it does |
|---|---|
| `npm run gate` | **everything CI runs before a change reaches main**, in one command: route types, type check, lint, translations, data validation, the tests, the production build, the six smoke runs and the audit of what ships; stops at the first failure and fails unless every smoke run ends "N/N ok". `-- --fresh` runs it in a clean clone of the last commit (a used folder is not a clean checkout); `-- --quick` stops after the build; `-- --keep-going` reports every failure. Use it when CI cannot run (GitHub has twice refused to start the smoke job over billing) |
| `npm test` | the whole suite (about 35 seconds); safe to run in two terminals at once |
| `npm run smoke` and its variants | the site, built and served, every page in both languages; CI runs six: default, `--feed sparse`, `--feed empty`, `--facts unknown`, `--feed partial`, `--feed hostile --crawl 60`; `--database FILE` runs it on a real league |
| `npm run forum:bench` | how fast the forum is with 200,000 posts |
| `npm run a11y` | the browser accessibility sweep (needs a Chromium download; see `docs/accessibility.md`) |
| `npm audit --omit=dev` / `npm audit` | what ships must say 0 (the gate and CI require it); the five "high" findings of the full audit are the linter's, have no patched version, and are explained in `docs/dependencies.md` |
| `npm run sweep -- --database FILE [--each N]` | every library calculation and every Ask tool on a database, at its real size; "no problems" or the list |
| `npm run first-look -- --database FILE` | a description of a loaded database in counts only (no name of a fighter, card or place), safe to paste back |
| `npm run post-load` | the first real look at a loaded league and how fast it runs, as one report |
| `npm run e2e` | the browser suite: the main flows in English and Arabic at 375 and 1280 px |
| `npm run news:refresh` | the headlines, official videos and Wayback copies; `--dry-run` lists what it would read |
| `npm run photos:apply` | puts the recorded pictures onto the fighters' pages (after a reload) |
| `npm run vendor:audit` | what a loaded league must satisfy (the guided load runs it at the end) |

## Where the numbers are

Every limit a visitor can run into is a named constant, never a number in a sentence: the forum's in `lib/forum/rules.ts` (the rules page reads them), the sign-in and picks limits in `lib/accounts/guard.ts`, the API's in `lib/public-api-http.ts`, the counting animation in `lib/count-up.ts`.
