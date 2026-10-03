# Accounts, the leaderboard and community edits

Built host-agnostic: one more SQLite file next to the sports database, no email service, no third-party sign-in. What it does:

- **Sign in / create account** (`/account`): a name and a password. No email, so there is nothing to verify and nothing personal to lose.
- **Picks follow you** (`/`, `/picks`): signed in, your pick'em picks are kept on the account; signed out they stay in the browser as before, and signing in moves them across (open fights only).
- **Leaderboard** (`/leaderboard`): graded picks scored by one published rule, with the Ringside model on the same fights as the bar to beat.
- **Suggest an edit** (`/contribute`, linked from every fighter page): anyone signed in can propose a trainer or manager (person, role, dates) with a source link and the quoted words from that page. **Review queue** (`/review`): editors check the source (the server can fetch the page and confirm the quote is on it) and approve or reject; approving publishes at once, marked "Community edit" with its link.

## Where things live

`accounts.db` (default: next to `DATABASE_PATH`, override with `ACCOUNTS_DB_PATH`) holds `users`, `sessions`, `resets`, `picks`, `contributions` and `audit`. It is separate from `ringside.db` on purpose: that file is rebuilt, re-ingested and (for the demo) deleted at will, and nobody's account may go with it. Everything in it points at the sports data by **external id** (a bout's and a boxer's `external_id`), never by row number, so a rebuilt database does not orphan a pick or an edit.

Approved community edits are written into `ringside.db` as `team_stints` rows with `source = "Community edit"` (plus `source_url` and the quote in `note`), and **replayed from `accounts.db` every time the sports database opens** (`applyContributions`, idempotent). Vendor re-ingests replace team history per source, so they never touch the community rows; a database rebuilt from scratch gets them back on the next open. An approved edit about a fighter the current database lacks is skipped, not lost. `npm run accounts -- apply` does the same by hand.

## The rules

**Names**: 3-24 letters, digits or underscores, unique ignoring case, a short reserved list (admin, ringside, ...). **Passwords**: at least 10 characters (counted as characters, so an Arabic passphrase is fine), not on a short common list, not containing the name; stored as a salted scrypt hash (N=2^15), never readable, upgraded on login if the cost is raised. **Sessions**: a random 256-bit token in an `HttpOnly; SameSite=Lax` cookie (`Secure` behind https), only its SHA-256 stored, 30 days, killed on sign-out, password change (all other devices) and deletion.

**Picks lock when fight day begins** (the card is on a later UTC day than today, not cancelled, no result). A locked pick can be neither changed nor deleted, so nobody can pick after the fact or quietly drop the ones they got wrong. Imports from the browser accept open fights only and never overwrite a pick already on the account.

**Scoring**: a right pick scores `1 + (1 - the model's probability for your side)`, a wrong one 0. Favourite right = 1 to 1.5, underdog right = up to 2. The likelier side is always the better pick on average (expected points `p(2-p)` rises with `p`), so there is nothing to gain by backing underdogs to look bold. No ledger prediction on file = the model is taken as 50/50. Only graded picks count (not draws, no-contests, cancellations). Ranked after 10 graded picks; people who turn their picks private (or are disabled) are not listed; the model is scored the same way on every fight a ranked player picked.

**Contributions**: person name (letters only, no links), role (head trainer, assistant, strength coach, cutman, manager), dates (year-month-day, not in the future, end after start), an `http(s)` source link (no credentials, no `file:`/`javascript:`), a 12-300 character quote, an optional note. Ten proposals a day per person; a refused one does not use the allowance. The reviewer sees flags (the quote does not contain the person's name; overlaps someone already in the role; starts long before the fighter's first fight; a person not yet in the data) and the **source check**: the research pipeline's polite fetcher (robots.txt, one request at a time per site, never BoxRec, a 403 is the end) in strict mode, which checks the host and every redirect so a link cannot be used to reach the server's own network, and says whether the quote is on the page. The result is shown to reviewers only (a proposer could otherwise probe addresses). An editor cannot decide their own proposal; an admin can. Rejecting needs a reason. Every decision and source check goes in the `audit` table.

## Attack surface and what covers it

| Risk | Protection | Test |
|---|---|---|
| Cross-site forged requests | every POST/DELETE needs a matching `Origin` (or none, for non-browsers), plus `SameSite=Lax` | `CSRF: a cross-site POST changes nothing` |
| Guessing passwords | 6 failures per name and 20 per address per 15 minutes, counted before any hashing; a success forgives | `repeated wrong passwords are locked out` |
| Telling which names exist | one answer for wrong password and unknown name; the same hashing work for both | `sign up, sign in, sign out` |
| Hashing as a way to keep the CPU busy | 5 sign-ups an hour per address, plus a site-wide budget of 240 hashes a minute that does not depend on the (fakeable) address | `hashing has a site-wide budget` |
| Stolen session | deleting an account or changing the password needs the password again; the latter signs every other device out | `changing the password signs the other devices out` |
| Stored data readable from a copy of the file | passwords scrypt-hashed, session tokens hashed, file mode 0600 | `passwords: salted scrypt` |
| Link as a way to reach internal services | host and redirects checked, same-site redirects only, private ranges refused | `a link cannot be used to reach this server's own network`, `strict redirects` |
| Script or odd links in contributions | `http(s)` only on input and again on output; `rel="noopener noreferrer nofollow ugc"`; text is escaped by React | `proposing an edit`, `links from contributions are only ever http(s)` |
| Backdated or deleted picks | the lock rule above, enforced on the server | `picks: stored on the account, open bouts only, frozen` |

Known limits, said plainly: usernames are not moderated (an operator can `disable` one, which hides it and signs it out); there is no CAPTCHA, so determined bulk sign-up from many addresses is slowed, not stopped; limits live in memory, per process (one instance, as `docs/deploy.md` already requires); the client address comes from `X-Forwarded-For`, which only a proxy you control can be trusted to set; there is no email, so a lost password needs the operator; no two-factor sign-in.

## Sessions and the leaderboard at scale

`/account` lists where the person is signed in (a coarse "Chrome on macOS", the sign-in date, last use recorded at most once an hour; nothing else of the user agent is kept) and can end any other session or all of them but this one. A session id shown there is a short prefix of the stored hash: it names a session but cannot be used to sign in, and ending a session only works on your own.

The leaderboard grades every public player's picks, which measured about 0.2 s at 500 players with 100 picks each and **1.9 s, blocking, at 5,000**. Pages therefore use `leaderboardCached`: one result per language, rebuilt when the day, the sports database, any pick, or the set of public players changes (each of those has a test that fails if it is dropped from the cache key). Beyond tens of thousands of players it needs a database-side aggregate instead.

## Your place and the recap (`/picks`, signed in)

A card shows the person's own place ("#4 of 31 players"), or how many more graded picks they need to be ranked, with their points and points a pick and, when the model called at least three of the same fights, the model's score on those fights. It counts **whether or not they are on the public board**: someone who hid themselves still sees where their score would put them, and is told that only they see it. The place is worked out from the cached leaderboard (`rankIn`: one more than the ranked players strictly ahead; equal points and accuracy share a place, as on the board), and a test checks that a person's own place equals their row on the board.

Under it, a recap of what was graded since they last looked: right and wrong counts and the five newest fights. It is kept by a mark, not a clock: `users.picks_seen_through` holds the date of the latest graded fight they were shown, "Got it" moves it to the latest graded fight, and the recap is the graded picks on fights after the mark (so each fight is reported once, a result that arrives hours late is still reported, and the mark never moves backwards or accepts a junk date). New fights are therefore reported, old ones are not, however long they stay away. `GET /api/account/standing?lang=ar` returns both; `POST {through}` dismisses.

## Operator commands

```bash
npm run accounts -- list                         # users, roles, picks, contributions
npm run accounts -- role NAME editor             # user | editor | admin (nobody is an editor until an operator says so)
npm run accounts -- disable NAME                 # signed out, cannot sign in, off the leaderboard (enable to undo)
npm run accounts -- reset NAME                   # a one-time code, valid an hour, for someone who forgot their password
npm run accounts -- audit 50                     # the last 50 audit entries
npm run accounts -- check                        # integrity check, counts, expired sessions waiting
npm run accounts -- purge                        # delete expired sessions and reset codes
npm run accounts -- apply                        # replay approved edits into the sports database by hand
```

Run them where the files are (inside the container: `docker exec ringside npm run accounts -- list`).

## Privacy

A person's data is a name, a password hash, their picks and the edits they proposed. `/account` offers a download of all of it (`/api/account/export`, no secrets) and deletion (password required): it removes the person, their picks and sessions; edits they proposed stay in the record, with no name on them, because what was published rests on a source, not on who found it.
