# Public API (read-only JSON)

`/api/v1/` gives other sites and scripts the same public facts the pages show: fighters, divisions, rankings, events. Nothing from accounts or picks; nothing is written. The machine-readable description is `/api/v1/openapi.json` (OpenAPI 3).

| Request | Answer |
|---|---|
| `GET /api/v1/divisions` | the divisions, lightest to heaviest, with weight limits |
| `GET /api/v1/fighters?q=&division=&country=&sex=&active=&limit=&offset=` | fighters, best rated first; `q` is a name and forgives a slip (`Alma Rui`) |
| `GET /api/v1/fighters/{slug}` | one fighter: record (and how it was reached), knockouts, rating, rank in the division, last five fights, next fight |
| `GET /api/v1/rankings/{division}?sex=&limit=&offset=` | a division's ranking with each place, 90-day movement and the rule used |
| `GET /api/v1/events?when=upcoming\|recent&limit=&offset=` | upcoming (soonest first) or recent (newest first) events with their main event |
| `GET /api/v1/events/{id}` | one event with all its bouts and each result |

Every call takes `lang=ar` for Arabic names, belts and links. Every answer is `{ "data": ..., "meta": { "updated": "2026-10-03", "source": "Ringside", ... } }`; an error is `{ "error": { "status": 404, "message": "..." } }`. `limit` is 1 to 50 (default 20).

**Behaviour.** CORS is open for GET, so a browser on another site can call it. Answers are cached for five minutes. There are 60 requests a minute per address (the first address in `X-Forwarded-For`, so put it behind a proxy that sets it); past that, 429 with `Retry-After`. An unexpected error is a 500 with a fixed message, never the exception's text.

**The record.** A fighter's `record` is what the page shows: `source` is `loaded` (the fights held add up to it), `supplier` (the data supplier's career total, because only part of the career is held; `held` of `total` fights are in the list) or `disputed` (the supplier's total and its own fight list disagree). Ratings are Ringside's own.

## The switch (read this before turning it on for real data)

Showing a data vendor's records on your own site is one thing; handing them to other sites through an API is another, and the vendor's terms may not allow it. So:

| Feed | Default | To turn on |
|---|---|---|
| demo league, a file feed | on | `PUBLIC_API=0` turns it off |
| **licensed** feed | **off** (404 with the reason) | **both** `PUBLIC_API=1` and `VENDOR_REDISTRIBUTION_CONFIRMED=1` |

`VENDOR_REDISTRIBUTION_CONFIRMED=1` is the owner's statement that the vendor's terms allow other sites to receive its data, like the storage statement (`BOXING_API_STORAGE_CONFIRMED`): it is never set for you, and one without the other is not enough. When it is on for a licensed feed, every answer's `meta.credit` names the supplier and the `/embed` widgets show it. The doctor (`npm run doctor`) reports a half-set switch. The embeds use the same switch.

Code: `lib/public-api.ts` (the data and the switch), `lib/public-api-http.ts` (CORS, cache, limit, errors), `lib/rate-limit.ts`, the routes under `app/api/v1/`. Tests: `tests/public-api.test.ts`.
