# Ringside

A boxing database with ratings, division rankings, fight predictions, plain-English search and AI scouting reports.
**All fighters, fights and events in this build are fictional, simulated data.** See `PLAN.md` for architecture, the data-vendor shortlist and the roadmap, and `DESIGN.md` for the design system.

## Run it
```bash
npm install
npm run dev -- -p 3100
```
Open http://localhost:3100 (Node 22.5+ is required for `node:sqlite`).
The first request creates `data/ringside.db` and seeds it with the demo roster (about 2 seconds).
To regenerate the demo data, stop the server, delete `data/`, and start again.

## Optional settings (copy `.env.example` to `.env.local`; `npm run doctor` checks them)
- `ANTHROPIC_API_KEY`: Claude-written search parsing, scouting reports and fight previews. Without it everything falls back to rules. `AI_DAILY_BUDGET` (default 1,000 calls per day), `AI_CLIENT_LIMIT` and `AI_CLIENT_WINDOW_MS` cap what visitors can spend (PLAN.md §21).
- `BOXING_PROVIDER=licensed` plus `BOXING_API_KEY`: the Boxing Data API adapter (`lib/providers/boxing-data-api.ts`). The vendor confirmed that its data may be stored (`BOXING_API_STORAGE_CONFIRMED=1` records it, `=0` refuses to store). The Mega plan allows 500 requests an hour, so the full fighter fetch (about 35,000 requests) is days of requests: `npm run vendor:backfill` is paced to the limit (`--per-hour 450` or `BOXING_API_PER_HOUR`), waits out a rate-limit refusal, is resumable from its cache, takes **the most recently active fighters first** (`--fighters 5000`, about 11 hours) and loads only the fights between fetched fighters, with `--plan` showing what each size gives before any fighter is fetched. One run at a time per key: a second one refuses to start. A fighter whose history is held only in part shows the vendor's career total, labelled. Start with `docs/real-data-readiness.md`; the first load, the staged load and the daily update are `docs/real-data-runbook.md`; `npm run vendor:sample` evaluates a sample without storing it.
- `SITE_CONTACT` and `VENDOR_TERMS_URL`: where someone who is not signed in can report a mistake (an email address or an `https://` page, published as written: use a role address), and the link to the data vendor's licence terms. The Data page credits the vendor when `BOXING_PROVIDER=licensed` and shows both; neither has a default, and `npm run doctor` warns when a licensed site has no contact.
- `WIKIMEDIA_CONTACT` and `npm run media:resolve`: fetch freely licensed fighter photos from Wikimedia Commons (real fighters only); `-- --entities` does the same for the four sanctioning bodies' belt photos, organisation logos and venue photos, each shown with its credit (`docs/media.md`: no promotion has a free logo, so they keep their name in text). `npm run wikidata:import` stages boxers from Wikidata (CC0); `-- --enrich` links your fighters to them and fills blanks only: birth details, honours, the Arabic name, a nickname and the link to the Wikipedia article. `npm run champions:import` reads Wikipedia's lists of WBA, WBC, IBF and WBO champions into a fighter's title history (`docs/title-reigns.md`).

## Scripts
`npm run dev` · `npm run build` · `npm start` · `npm run lint` · `npm test` · `npm run data:check` · `npm run bench -- --scale 5` · `npm run media:resolve` · `npm run smoke` · `npm run wikidata:import` · `npm run champions:import` · `npm run venues:resolve` · `npm run model:fit` · `npm run vendor:sample` · `npm run vendor:backfill` · `npm run vendor:rehearse` · `npm run vendor:explain`

`npm test` runs the suite (a couple of seconds). `npm run bench -- --scale 20 [--keep]` generates a league 20 times the demo size (about 19,000 fighters and 160,000 bouts), loads it into `data/bench-20.db` and times the data work behind every page; see PLAN.md §10. `npm run data:check -- --file sample.json` validates a vendor sample before you build an adapter for it. CI (`.github/workflows/ci.yml`) runs type check, lint, tests, the data check, a production build and the smoke check (`npm run smoke`, every kind of page in both languages on a real server).

See `PLAN.md` §8 for what data exists, the data model, and what each script does.

## Deploying
`docs/features.md` is a one-page map of what is in it and each feature's switch.

A `Dockerfile` and `docs/deploy.md` cover running it as one container with a persistent volume, the health check at `/api/health`, settings, backups and updates.

## Languages
English at `/`, Arabic at `/ar`. UI text is keyed by its English sentence (`i18n/ar.json`); proper names have their own table. `npm run i18n:check` lists missing entries; `npm run i18n:translate` fills them with Claude (`ANTHROPIC_API_KEY` in `.env.local`); `npm run i18n:names -- auto` does the same for names. See `docs/i18n.md`. Set `SITE_URL` for canonical URLs and sitemaps; the demo league is `noindex` until a real provider is configured.

## Arabic review
The Arabic is machine-written. `npm run i18n:review -- export` builds an offline sheet a native speaker can edit, approve and flag in; `-- import` applies the file they send back, and nothing counts as reviewed until it does. The data page shows how much has been checked. See `docs/arabic-review.md`.

## Ask the data
`/account` has sign-in (a name and a password, no email), and a signed-in visitor's pick'em picks are kept on the account, lock when fight day begins and feed `/leaderboard` (one published scoring rule, the model on the same fights as the bar to beat). Anyone signed in can suggest a trainer or manager for a fighter at `/contribute`, with a source link and the quoted words; editors approve them in `/review`, and an approved edit appears marked as a community edit with its link. Anyone signed in can also report a wrong fact at `/report` (linked from every fighter and fight page): a fight's result is corrected only from a page its commission or sanctioning body published, a fighter's own details from the fighter's own page or their admin-confirmed account (`npm run accounts -- owner`), and anything else is noted while the ingested value stands; an accepted correction is kept across the daily update and shown on the page with where it came from. The accounts live in their own SQLite file next to the database; `docs/accounts.md` has the design, the limits and `npm run accounts` for operators.

`/ask` answers plain-English or Arabic questions (who has the most knockouts among women, compare two fighters, longest title reigns at welterweight ...) from the database, with the tables behind every answer. It works without an AI key, using patterns; with `ANTHROPIC_API_KEY` set, Claude picks the queries and writes the answer, but only from the query results, and any number it invents is thrown away. Model calls are limited per visitor and per day (`AI_*` settings).

## Upset watch and trainer impact
`/upset-watch` ranks every upcoming fight by the underdog's chance, with reasons, how the same calls fared in the past, and which warning signs actually mattered (plus an Atom feed). `/trainers` estimates how much each head trainer changes their fighters' results, with honest error bars: most trainers cannot be told from average, and the page says so.

## Navigation
A grouped left rail on desktop that collapses to icons (the choice is remembered), and a drawer on phones. Sections live in `lib/nav.ts`.

## Fight of the year and all-time lists
`/fight-of-the-year` picks the best fight of each year by a published 0-100 score (knockdowns, finish, action, matchup, upset, stakes, comeback) and shows why. `/all-time` has sixteen record lists (greatest of all time, longest reigns, biggest upsets, fastest knockouts ...) with sex and division filters. Both only cover the fights in the data, and say so.

## On this day
`/on-this-day` lists the fights decided and the fighters born on a calendar date (today by default; `?d=MM-DD` for another, with previous / next links and a pointer to the nearest day that has anything), across every year in the database. A crowded day shows title fights and the highest fight scores first, at most three from any one year. Only results on record and exact birth dates are used. `lib/on-this-day.ts`, PLAN.md section 53.

## Accessibility
WCAG 2.2 AA is the target in both languages: skip link, visible focus, text colours measured at 4.5:1 or better, no text under 12px, charts that state their numbers, and a list view of the style map. See `docs/accessibility.md` for what was tested and what was not.

## Fight previews
`/previews` lists the next upcoming events; each bout has a data-built preview (stakes, tape, form, the model's pick and how it could end, factors, what to watch). With `ANTHROPIC_API_KEY` set, an AI-written article replaces the plain text, using only the facts on the page.

## Money data
Gates, tickets, pay-per-view, purses, broadcasters, audiences and yearly earnings (`/money`, event and fighter pages) with a basis and source on every figure. The demo league has simulated money. Real figures come from a licensed feed that carries them or from the research pipeline: `docs/research.md` (rules, claim format, `npm run research -- lint|check|report|promote|apply|markdown|extract|fetch|add-document|documents`; a commission's PDF or a records-request reply is registered with `add-document`), how to read purse sheets by hand in `docs/csac-purses.md`, UK suspension notices in `docs/uk-sources.md`, results in `docs/research-results.md`, source landscape in `docs/data-sources-survey.md`. `npm run data:ingest` re-runs the configured provider into the existing database.
