# The sanctioning bodies' official lists: what to do with the vendor's answer

Written 2026-10-06. The vendor's API relays the IBF, WBA, WBC and WBO standings "sourced from BoxingScene". The email in `docs/boxing-data-api-vendor-email.md` (and `docs/boxing-data-api-rankings-enquiry.md`) asks whether we may store and show them and what credit they want. Until there is a written answer, **a licensed site leaves them out**: `VENDOR_RANKINGS_CONFIRMED` is unset, so the fetch and the load do not request the 17 pages, and the site does not show lists that are already stored. (The demo league and a file feed are not affected.)

## What a visitor sees without the lists
Nothing is broken and nothing is empty. A division page offers only the "Ringside rating" ranking; the WBC/WBA/IBF/WBO tabs appear only for a body that has a list. A fighter's page shows no "#3 WBC" badge. The Data page says nothing about them either way. Ringside's own Elo ranking, labelled unofficial, is the ranking.

## If the answer is yes
1. Read what they said about credit. The page credits "Boxing Data API from BoxingScene"; change the wording in `components/OfficialList.tsx` and `lib/site-info.ts` if they ask for something else (and `docs/vendor-credit.md` says where).
2. Set `VENDOR_RANKINGS_CONFIRMED=1` in the shell you fetch and load from, and in the site's settings (`vendor:site` and the host). `npm run doctor` reports the state.
3. Fetch the lists: `npm run vendor:fetch` (or any `vendor:backfill` run) now asks for the 17 pages and caches them; the next `vendor:load` stores them. A daily `--update` refreshes them.
4. Check the top of a few divisions are people you would expect (`docs/real-data-runbook.md`, the checklist), and read `rankingsSkipped` after the first run: the mapping was written from the docs, not from a real response.

## If the answer is no
Do nothing: leave `VENDOR_RANKINGS_CONFIRMED` unset. The lists are never requested and never shown. To also remove ones already stored (not required, they are hidden): `sqlite3 "$DATABASE_PATH" "DELETE FROM official_rankings;"`. The tabs and badges are already absent. The credit line "from BoxingScene" belongs to the lists, so it goes with them; the vendor credit in the footer stays (`docs/vendor-credit.md`).

## If the answer is "some of it" (for example: yes for display but not storage, or only some bodies)
Not built, and not guessable: say what they allow and it can be done. The two places a rule would go are the adapter's `loadRankings()` (what is requested and kept) and `lib/official.ts` `buildOfficial()` (what is shown).

## If there is no answer
The same as "no". Don't read silence as permission.
