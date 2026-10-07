# The community forum (built: rounds 125 to 127; not yet announced: see "Opening it to the public")

Decided with the owner, 2026-10-06: **discussion on fighters and fights** (one thread under each fighter and each fight, made by the first post written there, plus a general board where people start threads), **post first, report and hide** (people post at once; anyone signed in can report; an editor hides or restores), **public to read, not indexed** (every forum answer carries `X-Robots-Tag: noindex, nofollow`, and the forum's text will be loaded by the page after it opens, never written into the HTML of a fighter's page, which search engines do index).

## What exists

**Round 125:** storage, rules, limits, reporting, moderation, export and deletion, and the web endpoints. **Round 126:** the pages. A *Discussion* section at the bottom of every fighter page and every fight page (`components/Discussion.tsx`, linked from the jump strip), loaded by the browser after the page opens, so what people write is never in the HTML of a page search engines index; `/forum` (the general board and the form that starts a thread, `components/StartThread.tsx`) and `/forum/<id>` (a general thread). The forum pages are `noindex`, are not in the sitemap, and are not in the menu yet (round 127). Reading is open to everyone; posting, editing your post (15 minutes), deleting it, and reporting need an account; editors see Hide and Restore on every post and the number of open reports.

To try it locally: create an account at `/account`, wait five minutes (or age the account in `accounts.db`), and write under any fighter.

| Endpoint | Who | What |
|---|---|---|
| `GET /api/forum/thread?kind=boxer&subject=<slug>` (or `kind=bout&subject=<fight number>`, or `id=<thread>`) `&after=<post id>` | anyone | the thread and 30 posts, oldest first |
| `GET /api/forum/threads?page=` | anyone | the general board, newest activity first, 20 a page |
| `POST /api/forum/post` `{kind, subject, body}` or `{threadId, body}` | signed in | write a post (the thread under a fighter or fight is made now) |
| `POST /api/forum/threads` `{title, body}` | signed in | start a thread on the general board |
| `PATCH` / `DELETE /api/forum/posts/<id>` | the author | edit (15 minutes) / withdraw (the words are wiped; if the post was hidden or reported they are kept for editors, see below) |
| `POST /api/forum/posts/<id>/report` `{reason, note?}` | signed in | report; `spam`, `abuse`, `off_topic`, `other` |
| `POST /api/forum/posts/<id>/appeal` | the author | ask the editors to review a post that reports hid (once per post) |
| `POST /api/forum/posts/<id>/moderate` `{action: hide \| restore \| confirm, reason?}` | editor, admin | hide, restore, or confirm (keep a hidden post hidden, which settles an appeal) |
| `POST /api/forum/threads/<id>/moderate` `{action: lock \| unlock \| hide \| show}` | editor, admin | |
| `GET /api/forum/reports` | editor, admin | appeals first, then posts with open reports, most reported first |

Every state-changing call needs a matching `Origin` (the same guard as the rest of the accounts), a signed-in session, and answers with the status for what went wrong (401 not signed in, 403 not allowed or account too new, 404 not found, 409 locked or already said, 429 too often).

## The rules (all numbers live in `lib/forum/rules.ts`)

- **Plain text, 2 to 2,000 characters.** No HTML, no markdown; the words are only ever shown as text. Invisible and control characters (zero-width, every bidi mark and isolate, fillers, variation selectors) are removed, runs of more than three combining marks are cut, and line endings are made one way. The link and number checks also see full-width forms and every script's digits.
- **No links of any kind**, no ten-digit numbers (phone numbers; dates are fine), no run of twelve of one character. Links are where nearly all forum spam is; they can be allowed later, tightening after a flood is harder.
- **Who may write:** a signed-in account at least five minutes old; accounts under a day old at most ten posts a day; a disabled account never. Ten posts in ten minutes per person, thirty per address. A refused post uses none of the allowance. Three new threads a day.
- **The same words twice in a day** (ignoring case, accents, spacing and punctuation) are refused; only a hash of the words is kept for this, wiped with the post.
- **The same text from a different account (PLAN 229):** a post whose letters (ignoring case, accents, spacing, digits and punctuation) match a post another account wrote in the last 24 hours is refused with "That has already been posted here by someone else". Posts of fewer than 24 letters ("Great fight, well done") are exempt. A refused post spends no allowance, leaves no thread behind, and is logged (`forum_copy_refused`, the account and a short hash, never the words; once an hour per person and text). The check is one indexed lookup on `wave_fp` (a hash of the letters, wiped with the post); editing a short post into a copy is refused too. The false-positive risk is two people who really write the same 24-plus letters in a day (a stock phrase with a number changed, such as "Round 3 went to the champion clearly" and "Round 9 ..."): they are told to put it in their own words.
- **Reports:** not your own post, once per person, one of four reasons. **Six different people hide a post** (PLAN 229; `FORUM_AUTO_HIDE_REPORTS`, default 6, never below 2) until an editor looks (hidden: the place stays, the words and the name do not). Only established reporters count: an account at least **7 days** old, not disabled, with at least **3 posts of its own still standing** (visible; hidden and withdrawn ones do not count). Each person counts once, reporters from one network area (an IPv4 /24 or IPv6 /64) count as one person, and reporters from the post author's own area count as none. The network area is only held in memory (the privacy page says addresses are not written down), so after a restart earlier reports count one person each, as before. Every report still reaches the editors' queue, counted or not. An editor can hide, restore, confirm or lock; every action is in the activity log with the editor's reason.
- **Appeal (PLAN 229):** the author of a post that reports hid automatically sees "Your post was hidden after reports from other members" and an *Ask for a review* button (the words are still not shown to anyone but editors). One appeal per post, five a day per person, and it spends nothing unless it is accepted. The post goes to the top of the editors' queue (`/review/forum`) marked *appeal*, the author is told "Your post is under review by the editors", and an editor either restores it or presses *Keep hidden* (`confirm`); the author is then told which. Reporters' names are never shown to the author. The activity log has `forum_auto_hide`, `forum_appeal`, then `forum_appeal_restore` or `forum_appeal_confirm`. A post an editor hid by hand has no appeal.
- **Your own words:** editable for 15 minutes (ten edits in ten minutes); withdrawable at any time; withdrawing (or deleting your account) wipes the words and leaves an empty place so replies still read. The data export includes everything you wrote and reported.
- **Withdrawing a hidden or reported post (PLAN 229):** the public words are wiped as always, but if the post was hidden or had an open report the words are first copied to `forum_posts.withdrawn_body`, which only the editors' views read (`/api/forum/recent` shows it, marked *withdrawn*; it is in no public answer, search, sitemap, feed or cache, and `listPosts` never reads it). It is kept for 90 days (`WITHDRAWN_KEEP_MS`, wiped by whichever editor view or withdrawal comes next) and wiped at once when the account is deleted (`eraseForumFor`, which also clears the titles of general threads the person started). The withdrawal is in the activity log as `forum_withdraw` (the person, the post, no words). A post nobody had complained about is wiped with nothing kept and nothing logged. The person's own data export lists what is kept.

## Known limits, said plainly

No notifications, no mentions, no search of posts, no pictures, no replies-to-a-reply (a thread is one flat list). The limits live in memory per process, like the sign-in limits. An editor is needed to deal with reports; with none, the only protection is the four-report auto-hide. The Terms page does not yet mention user posts (the owner's call: it is another session's page).


## Round 127: the editors' side, the rules, and opening it

- **`/review/forum`** (editors and admins; linked from the other review pages): *Reported posts* (most reported first, with the reasons) and *Newest posts* (hidden ones included, with their words, so an editor can judge), Hide / Restore / Dismiss the reports on each, a link to where the post is (the fighter, the fight or the thread), and the threads that are hidden with a *Show again* button. `GET /api/forum/recent` feeds the second tab.
- **On a general thread's page** editors see *Lock / Unlock / Hide the thread*.
- **`/forum/rules`** states the rules in words; every number on it is read from `lib/forum/rules.ts`, so it cannot drift from what the server enforces (a test fails if one is written into the page).
- **Privacy:** the three tables are declared on the privacy page (with what deleting an account does), and the data export includes everything a person wrote and reported.

## Opening it to the public: the owner's decisions

1. **The Terms clause** is on the Terms page now ("Forum posts", in the same small print, linked to the rules; the draft wording below is what it says). It is a plain-language draft, not legal advice: have the owner or a lawyer read it before the forum is announced. The draft:
2. **The menu.** The forum is reachable (from every fighter and fight page, which end with its discussion, and by address) but is off the menu and the footer. To put it in the menu, move `"/forum"` from `OFF_NAV` into a group of `NAV_GROUPS` in `lib/nav.ts` (a test keeps menu entries and the smoke list in step).
3. **Search engines.** Every forum page and answer is `noindex`. Leave it until the forum has some history and an editor has used the queue; indexing would be a deliberate change in `generateMetadata` of the forum pages and the answers' header in `lib/forum/http.ts`.
4. **Who moderates.** `npm run accounts -- role <name> editor` (the existing command for making an editor). With no editor, the only protection is the automatic hiding (six reports from established accounts, `FORUM_AUTO_HIDE_REPORTS`). `npm run doctor` now says so: once the forum has a post and no editor or admin account that is enabled, it warns, with that command as the fix.
5. **Links.** Not allowed at all for now. If you want them, the change is the `LINK` rule in `lib/forum/rules.ts` (and the sentence on the rules page); nothing else.


## How it behaves when it is large (measured, `npm run forum:bench`)

A throwaway database of 5,000 accounts, 32,000 threads, 200,000 posts (5,000 in one thread) and 6,000 reports, in process: every read under 5 ms (a page of a thread 0.1 ms, the board 0.1 ms, a fighter's thread 0.02 ms, the editors' queue of 3,000 reported posts 5 ms, the newest 50 posts 1.3 ms) and every write under a quarter of a millisecond. The first run found the one slow thing: looking up the thread under a fighter or a fight scanned every thread of its kind (2.6 ms at 32,000 threads, and 4 ms to add a post), because the partial unique index cannot serve a lookup whose kind is a parameter; `idx_forum_subject` fixed it (0.02 ms and 0.15 ms). A test pins the plans of the queries that matter.

Spam waves, simulated: sixty young accounts behind one address get 30 posts in all; forty young accounts on forty addresses get ten each; fifty established accounts pasting the same advert get one copy through and are refused after that (PLAN 229; it was two).

Security review: `docs/forum-security-review.md`.
