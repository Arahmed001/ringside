# The community forum (in progress: rounds 125 and 126 done; round 127 is the editors' queue page, the rules page, the privacy and terms text)

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
| `PATCH` / `DELETE /api/forum/posts/<id>` | the author | edit (15 minutes) / withdraw (the words are wiped) |
| `POST /api/forum/posts/<id>/report` `{reason, note?}` | signed in | report; `spam`, `abuse`, `off_topic`, `other` |
| `POST /api/forum/posts/<id>/moderate` `{action: hide \| restore, reason?}` | editor, admin | hide or restore |
| `POST /api/forum/threads/<id>/moderate` `{action: lock \| unlock \| hide \| show}` | editor, admin | |
| `GET /api/forum/reports` | editor, admin | posts with open reports, most reported first |

Every state-changing call needs a matching `Origin` (the same guard as the rest of the accounts), a signed-in session, and answers with the status for what went wrong (401 not signed in, 403 not allowed or account too new, 404 not found, 409 locked or already said, 429 too often).

## The rules (all numbers live in `lib/forum/rules.ts`)

- **Plain text, 2 to 2,000 characters.** No HTML, no markdown; the words are only ever shown as text. Invisible and control characters (zero-width, every bidi mark and isolate, fillers, variation selectors) are removed, runs of more than three combining marks are cut, and line endings are made one way. The link and number checks also see full-width forms and every script's digits.
- **No links of any kind**, no ten-digit numbers (phone numbers; dates are fine), no run of twelve of one character. Links are where nearly all forum spam is; they can be allowed later, tightening after a flood is harder.
- **Who may write:** a signed-in account at least five minutes old; accounts under a day old at most ten posts a day; a disabled account never. Ten posts in ten minutes per person, thirty per address. A refused post uses none of the allowance. Three new threads a day.
- **The same words twice in a day** (ignoring case, accents, spacing and punctuation) are refused; only a hash of the words is kept for this, wiped with the post.
- **Reports:** not your own post, once per person, one of four reasons. **Four different people hide a post** (only reporters whose accounts are a day old count, so a batch of new accounts cannot silence anyone; their reports still reach the editors' queue) until an editor looks (hidden: the place stays, the words and the name do not). An editor can hide, restore or lock; every action is in the activity log with the editor's reason.
- **Your own words:** editable for 15 minutes (ten edits in ten minutes); withdrawable at any time; withdrawing (or deleting your account) wipes the words and leaves an empty place so replies still read. The data export includes everything you wrote and reported.

## Known limits, said plainly

No notifications, no mentions, no search of posts, no pictures, no replies-to-a-reply (a thread is one flat list). The limits live in memory per process, like the sign-in limits. An editor is needed to deal with reports; with none, the only protection is the four-report auto-hide. The Terms page does not yet mention user posts (the owner's call: it is another session's page).

Security review: `docs/forum-security-review.md`.
