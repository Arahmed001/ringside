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
| `PATCH` / `DELETE /api/forum/posts/<id>` | the author | edit (15 minutes) / withdraw (the words are wiped) |
| `POST /api/forum/posts/<id>/report` `{reason, note?}` | signed in | report; `spam`, `abuse`, `off_topic`, `other` |
| `POST /api/forum/posts/<id>/moderate` `{action: hide \| restore, reason?}` | editor, admin | hide or restore |
| `POST /api/forum/threads/<id>/moderate` `{action: lock \| unlock \| hide \| show}` | editor, admin | |
| `GET /api/forum/reports` | editor, admin | posts with open reports, most reported first |

Every state-changing call needs a matching `Origin` (the same guard as the rest of the accounts), a signed-in session, and answers with the status for what went wrong (401 not signed in, 403 not allowed or account too new, 404 not found, 409 locked or already said, 429 too often).

## The rules (all numbers live in `lib/forum/rules.ts`)

- **Plain text, 2 to 2,000 characters.** No HTML, no markdown; the words are only ever shown as text. Invisible and control characters are removed; line endings are made one way.
- **No links of any kind**, no ten-digit numbers (phone numbers; dates are fine), no run of twelve of one character. Links are where nearly all forum spam is; they can be allowed later, tightening after a flood is harder.
- **Who may write:** a signed-in account at least five minutes old; accounts under a day old at most ten posts a day; a disabled account never. Ten posts in ten minutes per person, thirty per address. A refused post uses none of the allowance. Three new threads a day.
- **The same words twice in a day** (ignoring case, accents, spacing and punctuation) are refused; only a hash of the words is kept for this, wiped with the post.
- **Reports:** not your own post, once per person, one of four reasons. **Four different people hide a post** until an editor looks (hidden: the place stays, the words and the name do not). An editor can hide, restore or lock; every action is in the activity log with the editor's reason.
- **Your own words:** editable for 15 minutes; withdrawable at any time; withdrawing (or deleting your account) wipes the words and leaves an empty place so replies still read. The data export includes everything you wrote and reported.

## Known limits, said plainly

No notifications, no mentions, no search of posts, no pictures, no replies-to-a-reply (a thread is one flat list). The limits live in memory per process, like the sign-in limits. An editor is needed to deal with reports; with none, the only protection is the four-report auto-hide. The Terms page does not yet mention user posts (the owner's call: it is another session's page).


## Round 127: the editors' side, the rules, and opening it

- **`/review/forum`** (editors and admins; linked from the other review pages): *Reported posts* (most reported first, with the reasons) and *Newest posts* (hidden ones included, with their words, so an editor can judge), Hide / Restore / Dismiss the reports on each, a link to where the post is (the fighter, the fight or the thread), and the threads that are hidden with a *Show again* button. `GET /api/forum/recent` feeds the second tab.
- **On a general thread's page** editors see *Lock / Unlock / Hide the thread*.
- **`/forum/rules`** states the rules in words; every number on it is read from `lib/forum/rules.ts`, so it cannot drift from what the server enforces (a test fails if one is written into the page).
- **Privacy:** the three tables are declared on the privacy page (with what deleting an account does), and the data export includes everything a person wrote and reported.

## Opening it to the public: the owner's decisions

1. **A clause for the Terms page** (the Terms page is another session's; this is a draft for the owner or a lawyer, not legal advice): *"Posts in the forum are written by their authors. You are responsible for what you write, and you must not post anything unlawful, abusive, or that you have no right to post. By posting you allow Ringside to show your post on the site for as long as it is there. Editors may hide or remove posts. You can delete your own posts at any time, and deleting your account removes them."*
2. **The menu.** The forum is reachable (from every fighter and fight page, which end with its discussion, and by address) but is off the menu and the footer. To put it in the menu, move `"/forum"` from `OFF_NAV` into a group of `NAV_GROUPS` in `lib/nav.ts` (a test keeps menu entries and the smoke list in step).
3. **Search engines.** Every forum page and answer is `noindex`. Leave it until the forum has some history and an editor has used the queue; indexing would be a deliberate change in `generateMetadata` of the forum pages and the answers' header in `lib/forum/http.ts`.
4. **Who moderates.** `npm run accounts -- role <name> editor` (the existing command for making an editor). With no editor, the only protection is the automatic hiding at four reports.
5. **Links.** Not allowed at all for now. If you want them, the change is the `LINK` rule in `lib/forum/rules.ts` (and the sentence on the rules page); nothing else.
