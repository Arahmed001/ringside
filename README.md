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
`npm run dev` · `npm run build` · `npm start` · `npm run lint` · `npm run media:resolve` · `npm run wikidata:import` · `npm run model:fit`

See `PLAN.md` §8 for what data exists, the data model, and what each script does.
