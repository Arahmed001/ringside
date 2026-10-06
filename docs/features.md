# What is in Ringside, and its switches

A map of the features added in the first week of October 2026, one line each: where it is, what controls it, and where the detail lives. Anything not listed as having a switch is always on and is removed by deleting the code named.

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
| **Vendor data tools** (fetch, load, audit, preview, status) | `npm run vendor:status`, `vendor:fetch`, `vendor:load`, `vendor:audit`, `vendor:site` | the key, the storage statement and the redistribution statement are the owner's (`.env.example`) | `docs/load-day.md`, `docs/real-data-runbook.md` |

## Checks that are worth knowing about

| Command | What it does |
|---|---|
| `npm test` | the whole suite (about 35 seconds); safe to run in two terminals at once |
| `npm run smoke` and its variants | the site, built and served, every page in both languages; CI runs six: default, `--feed sparse`, `--feed empty`, `--facts unknown`, `--feed partial`, `--feed hostile --crawl 60`; `--database FILE` runs it on a real league |
| `npm run forum:bench` | how fast the forum is with 200,000 posts |
| `npm run a11y` | the browser accessibility sweep (needs a Chromium download; see `docs/accessibility.md`) |
| `npm run vendor:audit` | what a loaded league must satisfy (the guided load runs it at the end) |

## Where the numbers are

Every limit a visitor can run into is a named constant, never a number in a sentence: the forum's in `lib/forum/rules.ts` (the rules page reads them), the sign-in and picks limits in `lib/accounts/guard.ts`, the API's in `lib/public-api-http.ts`, the counting animation in `lib/count-up.ts`.
