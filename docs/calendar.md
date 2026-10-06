# Fight calendars

Calendar apps (Apple, Google, Outlook) can follow Ringside's fights. Everything is one address, `/feeds/calendar.ics`, and returns an iCalendar file (RFC 5545):

| Address | What it holds |
|---|---|
| `/feeds/calendar.ics` | the cards of the next 60 days, one entry per card, headed by its main event |
| `/feeds/calendar.ics?slugs=a,b,c` | the upcoming fights of those fighters (a watchlist), one entry per fight; a fight that fell off the card stays in as CANCELLED so a subscribed calendar drops it |
| `/feeds/calendar.ics?event=ID` / `?bout=ID` | one card, one fight (the "Add to calendar" links on the event and fight pages, which download it) |
| `&days=N` | how far ahead for the first two (1 to 365; the watchlist page asks for 180) |
| `&lang=ar` | Arabic text and Arabic links |

Behaviour worth knowing:
- **All-day entries.** The data has a date for each card and no start time, so every entry is an all-day one rather than a guessed hour.
- **Stable identity.** Each entry has a fixed `UID` (`bout-12@host`, `event-3@host`), so a calendar that fetches again updates an entry (a date change, a cancellation) and never adds a second.
- **Cached for 15 minutes** and stamped with the data's own day, so two fetches in a day are the same text.
- **Private by construction.** The feed holds public facts only; the fighters in `slugs` come from the address, not from an account. On the watchlist page the subscribe link (`webcal://`) is built in the browser from the list kept there.
- **Links** use `SITE_URL`; without it the entries link to `http://localhost:3000`.

Code: `lib/ics.ts` (the format: folding to 75 octets on UTF-8 bytes, escaping), `lib/calendar.ts` (what goes in), `app/feeds/calendar.ics/route.ts`, `components/AddToCalendar.tsx`, the links in `components/WatchlistPage.tsx`. Tests: `tests/calendar.test.ts`; the smoke crawl fetches the feed in both languages and checks it is a whole calendar with CRLF lines under 75 octets.
