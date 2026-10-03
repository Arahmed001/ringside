# Ringside

A boxing database with ratings, division rankings, fight predictions, plain-English search and AI scouting reports.
**All fighters, fights and events in this build are fictional, simulated data.** See `PLAN.md` for architecture, the data-vendor shortlist and the roadmap, and `DESIGN.md` for the design system.

## Run it
```bash
npm install
npm run dev -- -p 3100      # http://localhost:3100  (Node 22.5+ required for node:sqlite)
```
The first request creates `data/ringside.db` and seeds it with the demo roster (about 2 seconds).
To regenerate the demo data, stop the server, delete `data/`, and start again.

## Optional settings (copy `.env.example` to `.env.local`)
- `ANTHROPIC_API_KEY`: Claude-written search parsing and scouting reports. Without it everything falls back to rules.
- `BOXING_PROVIDER=licensed` plus `BOXING_API_URL` / `BOXING_API_KEY`: use a real data feed (adapter still to be written, see `lib/providers/licensed.ts`).
- `WIKIMEDIA_CONTACT` and `npm run media:resolve`: fetch freely licensed fighter photos from Wikimedia Commons (real fighters only).

## Scripts
`npm run dev` · `npm run build` · `npm start` · `npm run lint` · `npm test` · `npm run data:check` · `npm run bench -- --scale 5` · `npm run media:resolve` · `npm run wikidata:import` · `npm run venues:resolve` · `npm run model:fit`

`npm test` runs the suite (a couple of seconds). `npm run bench -- --scale 20 [--keep]` generates a league 20 times the demo size (about 19,000 fighters and 160,000 bouts), loads it into `data/bench-20.db` and times the data work behind every page; see PLAN.md §10. `npm run data:check -- --file sample.json` validates a vendor sample before you build an adapter for it. CI (`.github/workflows/ci.yml`) runs type check, lint, tests, the data check and a production build.

See `PLAN.md` §8 for what data exists, the data model, and what each script does.

## Languages
English at `/`, Arabic at `/ar`. UI text is keyed by its English sentence (`i18n/ar.json`); proper names have their own table. `npm run i18n:check` lists missing entries; `npm run i18n:translate` fills them with Claude (`ANTHROPIC_API_KEY` in `.env.local`); `npm run i18n:names -- auto` does the same for names. See `docs/i18n.md`. Set `SITE_URL` for canonical URLs and sitemaps; the demo league is `noindex` until a real provider is configured.

## Fight previews
`/previews` lists the next upcoming events; each bout has a data-built preview (stakes, tape, form, the model's pick and how it could end, factors, what to watch). With `ANTHROPIC_API_KEY` set, an AI-written article replaces the plain text, using only the facts on the page.

## Money data
Gates, tickets, pay-per-view, purses, broadcasters, audiences and yearly earnings (`/money`, event and fighter pages) with a basis and source on every figure. The demo league has simulated money. Real figures come from a licensed feed that carries them or from the research pipeline: `docs/research.md` (rules, claim format, `npm run research -- lint|check|report|promote|apply|markdown|extract`), results in `docs/research-results.md`, source landscape in `docs/data-sources-survey.md`. `npm run data:ingest` re-runs the configured provider into the existing database.
