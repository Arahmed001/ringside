# UK sources: BBBofC notices and Barb audiences (read 2026-10-03, not built)

Both were on the list as "free pages with attribution". Looked at properly, neither can simply be scraped into Ringside. This records why, so nobody repeats the work, and what could be done.

## British Boxing Board of Control notices (https://bbbofc.com/notices)

**What is there.** Each Area Council (Midlands, Northern, Central, Southern, Scottish, Welsh, Northern Ireland) publishes its meeting minutes as a notice, and the Board publishes championship circulars. The minutes are free text about named licensees. A real one, read on the day:

> Regulation 5.10 — Lamah Griggs. Continue on reports and restrict to 12 minute contests.
> REGULATION 22.2.1 & 25 — Marley Mason. Mr. Mason appeared alone. The Council gave Mr. Mason words of guidance for the future and fined him.
> Ross McGuigan – call to appear at next meeting.

**Why it was not built.**
1. **It is not a suspension list.** There is no structured field: a regulation number, a name and a sentence. "Continue on reports and restrict to 12 minute contests" is a medical-type restriction; "words of guidance" and "call to appear" are neither suspensions nor results. Turning the sentences into a `suspensions` table means interpreting free text, and a wrong reading is a wrong statement about a named person.
2. **The people are not only boxers.** Licensees include managers, trainers, seconds, promoters and referees. A name in a notice cannot be tied to a boxer in our database without guessing (two people can share a name).
3. **Personal data.** These are disciplinary and health-related notes about named individuals. That they are public on the Board's site does not make republishing them on another site fair under UK GDPR, and a medical restriction is special-category data. Ringside has no consent, no lawful basis written down and no way for a person to ask for removal of a line.
4. **No reuse terms were found** on the notices pages (only a site-wide copyright footer); there is no `robots.txt` (the address returns the site's 404 page).

**What could be done, if wanted** (each is the owner's decision, ideally after taking advice on data protection):
- Ask the Board whether it will give a structured feed or permission, and for which uses (`docs/bbbofc-enquiry.md`, a draft).
- If it agrees: show only what the Board itself states about a **boxer's current status** (suspended until a date, restricted to N-minute contests) on that boxer's page, with the notice linked and dated, never fines or "words of guidance", and a way to report an error. A person added by hand against a source, with the quote, the same way trainer edits work (`/contribute`), is safer than a parser.
- Do nothing: Ringside's value does not depend on it.

## Barb weekly top 50 (https://www.barb.co.uk/viewing-data/weekly-top-50-shows/)

**What is there.** Barb's own page says: "All the viewing data available on Barb's website is free for users to publish, although the data must be credited to Barb" (https://www.barb.co.uk/viewing-data/how-can-i-get-barb-data/, read 2026-10-03). The top 50 programmes of each week, with audiences. No `robots.txt` (the address returns a 404 page).

**Why it was not built.**
1. **Boxing barely appears.** The latest week on the page (7 to 13 September 2026) had no boxing in it, and Sky and DAZN pay-per-view fights are not what the top 50 measures. A fight shows up only when it is on a free-to-air or widely carried channel.
2. **The page has no data in it.** The table is filled in by the browser from a separate Barb service (`barb-api.mediatel.co.uk`), so the polite fetcher sees an empty table and the research checker could never find a quote on the page: every Barb claim would be `unconfirmed`. Calling that service directly would be using something the page does not offer to the public as an API, and its terms were not read.
3. **The archive** (https://www.barb.co.uk/viewing-data/archive/) was not read.

**What could be done:** when a particular fight is known to have been in a week's top 50 (a free-to-air card, a press report citing Barb), a person records a `broadcast` claim (`viewersAvg`, `viewersPeak`) with the press report as one source and the Barb figure saved as a registered document (a saved page or a screenshot text: `docs/research.md`, "Evidence that is a file"), credited "Barb". That is manual, one fight at a time, and worth it only for the few that appear.

## What this changes in the plan

The survey's list (`docs/data-sources-survey.md`, section 12) put both as "small to medium". They are not: BBBofC needs a data-protection decision first and Barb has little boxing in it. Neither blocks anything else.
