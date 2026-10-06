# "Since you last looked" (watchlist digest)

The watchlist page opens with what changed for the fighters you follow since the day you last looked: new results (with how each moved the rating), each rating's move, and any fight coming up in the next fortnight. It leaves out fighters with nothing new.

How it works, and what it does not do:
- **The browser keeps one day.** `ringside:watchseen` in local storage holds the data's day you last looked (a date, no time, no account, this device only; declared on the privacy page). Nothing about you is stored on the server.
- **First visit.** The page only learns the data's day (`GET /api/watch/digest?slugs=…` with no `since`) and remembers it; the digest starts from the next visit.
- **Marking as seen.** The day is brought up to date when you leave the page (or press "Mark as seen"), not at once, so a reload still shows the same digest.
- **What counts as new.** A fight dated after the day last seen and not after the data's own today (the day itself was already seen). At most five results per fighter are shown, the rest counted ("+2 more"). A day more than a year back is brought forward to a year; a day in the future shows nothing newer.
- **Rating move.** From the rating at the end of the day last seen to the rating now, only when it differs; each result also shows its own change.
- **Next fight.** Shown only within 14 days; a cancelled fight is never a next fight.
- **Signed in.** The list can come from your account, but the day last seen stays on the device.

`GET /api/watch/digest?slugs=a,b&since=YYYY-MM-DD&lang=ar` returns `{ today, since, clamped, watched, items[] }` (400 for a day that is not real, such as 2026-02-31). Code: `lib/watch-digest.ts` (pure), `app/api/watch/digest/route.ts`, `components/WatchDigest.tsx`, the storage helpers in `lib/useWatchlist.ts`. Tests: `tests/watch-digest.test.ts`.
