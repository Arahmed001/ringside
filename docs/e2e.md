# The browser suite: `npm run e2e`

What a unit test cannot see: that a button does something once the page has hydrated, that the focus ring is really on screen, that a message survives the re-render that follows it, that two people at two keyboards see each other's posts. `npm run e2e` drives the real production build in a real browser, in English and Arabic, at phone (375 px) and desktop (1280 px) width, through the flows people depend on and through the keyboard-only behaviour of the controls. It is **not** part of `npm test` (it needs a build and a browser), so CI time is unchanged.

## Running it

```
npm run build
npm run e2e                      # everything: about 2 minutes on 4 cores
npm run e2e -- --only forum,palette      # flows whose name contains one of these words
npm run e2e -- --list                    # every run it would make, then stop
npm run e2e -- --workers 4 --keep --headed --db FILE --port N
```

- It starts **its own** production server on a free port, with a **temporary** database (the demo league, clock pinned to 2026-10-03, seeded by the first request) and a throwaway accounts file (`ACCOUNTS_DB_PATH`), the way `npm run smoke` and `npm run a11y` do. `--db FILE` uses a *copy* of a league you name instead (`RINGSIDE_NO_SEED` is then set). Nothing else on the machine is touched; the temporary folder is deleted when everything passes (`--keep`, or any failure, keeps it, with a screenshot of every page of a failed run).
- `FORUM_AUTO_HIDE_REPORTS=2` is set for that server (the smallest value the setting allows) so the automatic hide can be reached with two aged accounts. No new setting was added to the site: `tests/config-docs.test.ts` and `npm run doctor` are unaffected.
- Playwright is found the way `scripts/a11y-run.ts` finds it: `PLAYWRIGHT_MODULE`, then `playwright`, then `/opt/node-tools/node_modules/playwright`; Chromium comes from `PLAYWRIGHT_BROWSERS_PATH` (`/opt/pw-browsers` here). The site does not depend on it, and the suite never runs `playwright install`.
- The server is stopped by process id: it is started with `node node_modules/next/dist/bin/next start` (so the process is the server itself, which renames itself `next-server (v16...)` in `ps`), and the runner ends that id and anything under it, on success, on failure and on Ctrl+C. It never kills by name or by port.
- `next start -H 127.0.0.1` is **not** used: with a host flag that differs from the `Host` header the proxy's rewrite to `/en/...` redirects forever. (Production runs behind a proxy with the real host, so this is not a site problem; it is why the runner binds the default.)

## How it is built

- `scripts/e2e.ts` is the runner; `e2e/harness.ts` what every flow gets; `e2e/keys.ts` the keyboard helpers; `e2e/flows/*.ts` the flows. A flow is `{ name, variants: [{lang, width}, ...], run(h, variant) }`; each variant is one run.
- **Independent and parallel.** Runs are pulled from a queue by 3 workers (`--workers`). Each run has its own browser context(s), its own accounts (random names, made through the real sign-up endpoint) and its own network address (an `x-forwarded-for` header, so the per-address limits on sign-ups and posts never meet between runs, and "reporters from one network area count as one" can be reached on purpose). Nothing in one run depends on another.
- **Deterministic, no sleeps.** Every wait is on a condition: a locator, a URL, a response, or `h.until(...)` polling a database row or an API answer. Two helpers carry most of it: `h.ready(page)` (the top bar's buttons carry React's props, then two frames have passed so effect-attached listeners such as the palette's shortcut exist; a click before hydration is silently lost) and `h.click(locator)` (the same check on the element itself). The only fixed wait is the negative one in the touch-screen test of the hover card (nothing may appear within twice the card's own delay). Animations are off through `reducedMotion`; the two short transitions that still run (the focus ring and the skip link's slide) are waited out frame by frame in `describeFocus`.
- **The clipboard is faked per page** (`h.copied(page)`), because the real one is shared by every context in the browser and flows run side by side.
- **Roles and ages** are set the way the unit tests and the operator's command do it: straight into the throwaway accounts file (`h.setRole`, `h.ageAccount`). No route sets a role, and none was added.
- **A watcher on every page** (`h.page`) turns these into a failure of the run, whatever the flow was checking: `console.error`, uncaught page errors, requests that fail (except `ERR_ABORTED`, the browser cancelling an image when a link is followed), responses of 400 or more (unless the flow declared them expected with `h.allow(pattern, status)`: the sign-in tests allow the account endpoints' 4xx, the 404 test allows its 404s), and content-security-policy violations (the `securitypolicyviolation` event and the browser's own console line). The watcher was checked by injecting each kind on purpose.

## The flows

Each of these runs in the variants listed (`en@1280`, `ar@375`, `en@375`, `ar@1280`; "2" means the first two).

| Flow | Variants | What it does |
|---|---|---|
| every page has one h1 and a skip link | 2 | ~45 routes (the whole menu, the off-menu pages, a fighter, event, bout, preview, compare, forum): exactly one visible h1, `lang` and `dir`, a title, `<main id="main">`, the skip link is the first Tab stop, is on screen with a ring when focused, and Enter moves focus into `<main>`; no `Invalid Date`, `NaN`, `undefined`, `[object Object]` or `{placeholder}` in what the browser built |
| 404 page with suggestions | 4 | a mistyped fighter address answers 404 with the page's own language, offers the real fighter, is `noindex`, its search box keeps the guess and works; an address naming nobody has no suggestions; the way home works |
| language switch keeps the page | 4 | a filtered list, a fighter page and a rankings tab: the switch goes to the same page in the other language with the filters kept, direction follows, and back |
| sign up, sign out, sign in, wrong password | 4 | mismatched passwords, a common password, sign-up with Enter, the cookie (HttpOnly, Lax, not readable by scripts), reload keeps it, sign out clears it, taken name, wrong password, unknown name (same words), sign in |
| change password | 4 | mismatch, wrong current password, change; this device stays signed in, **another device is signed out**; the old password fails, the new works |
| star a fighter: the watchlist persists | 4 | star from the fighter page signed out, reload, the watchlist page, add a second by its search; make an account (the browser's list moves onto it), sign in on a second device, un-star there, the first sees it gone |
| pick'em: a pick is recorded | 4 | pick, change the pick (still one), reload (kept in the browser), make an account (the picks moved, said on the page), `/picks` lists it, a second device sees it and a new pick is on the account |
| report a mistake reaches an editor's queue | 4 | signed out: sign-in prompt, no form; signed in: the form, thanks, the reporter's own list; an editor (role set in the accounts file) finds it in `/review/reports` with the reporter and the fighter, rejects it with a note; the reporter sees the note |
| forum: post, reply, report, hide, appeal, review | 4 | a link is refused as you type; post under a fighter; reload; a second account replies and the first sees it; a third reports (focus into the form, Enter sends, focus back); two established accounts (a week old, three posts) from other networks report: **the post is hidden for everyone**, the author is told and appeals once; the editors' queue shows it first marked *appeal*, **Keep hidden** settles it (the author is told); a second post goes the same way and **Restore** brings it back; a post an editor hides by hand has no appeal |
| deleting an account erases its forum words | 4 | wrong password is refused; after deleting, the words and the name are in no page, no API answer and **no table of the accounts file**; the reply under it still reads; the name cannot sign in |
| search palette finds a fighter and goes there | 4 | Ctrl+K, four quick links, an exact name chosen with ArrowDown and Enter; a query in the page's script (the Arabic spelling on the Arabic site, a last name on the English one); **a typo**; nonsense says so; a page name goes to the page |
| fighters list and rankings: filters, sort, tabs | 2 | sex and division links keep each other; the sort select and Apply; the order is by wins; Clear filters; the search box; rankings Men/Women; a division's sortable headings: one `aria-sort`, a second click reverses |
| fighter page: sections, jump strip, share | 4 | one h1; every strip link has its section; no sideways scrolling at 375; each jump lands below the sticky bars and writes the address; Share copies the address |
| compare two fighters | 4 | two pickers filled and chosen with the keyboard, Predict, both fighters and a probability on the result, a slider moves with the arrow keys, Share copies a link with both |

### Keyboard-only

| Flow | Variants | What it checks |
|---|---|---|
| tab order of the main pages | 4 | home, a fighter page, fighters, a division's rankings, account, watchlist, compare, forum: the whole tab walk. At every stop: a visible ring, `:focus-visible`, on screen, **not under a sticky bar**; the skip link first; no positive `tabindex`; the walk ends (nothing traps) and visits as many controls as there are; the top bar reads in the direction of the language; Shift+Tab goes back |
| jump strip on a fighter page | 2 | reached by Tab, links in page order one Tab apart, rows follow the direction (Arabic goes right to left); Enter jumps and the next Tab continues from that section, not from the top |
| fighters list, rankings tabs and sort headings | 2 | the filter chips are in the tab order; the sort choice by arrow key and Apply with Enter; Enter in the search box; the Men/Women links in reading order; a sort heading reached by Tab and sorted with Enter |
| the search palette is a dialog | 4 | focus goes to the box; Tab and Shift+Tab stay in it; ArrowDown/Up move the highlight; Escape closes and **focus returns to where it came from**, including when it was opened with the mouse from the search button; `/` opens it outside a text box |
| the phone menu is a modal drawer | en, ar @375 | Menu button reachable first; Enter opens; 40 Tabs and 5 Shift+Tabs never reach the page behind; it comes from the start edge (left, right in Arabic); Escape closes and focus returns to the button; a link inside goes there and the drawer is closed |
| hover preview card | en, ar @1280 | keyboard focus on a fighter's link shows the card (a tooltip tied to the link, no controls); Escape closes it and focus stays; moving focus on closes it; the pointer shows it, leaving and scrolling close it; **a touch screen never gets it** |
| forum compose, report and delete | 4 | from the strip's Discussion link into the box by Tab; Enter is a new line, not a send; rules link then Post; Enter posts and focus goes back to the box; Delete asks with Cancel focused, Cancel returns to Delete; Edit focuses the box; Report focuses the reason, an arrow key chooses it, Enter in the note sends it |
| arrow keys and tab order in both directions | en@1280, ar@1280, ar@375 | a slider's arrow moves the thumb the way the arrow points, in both directions of text, Home and End; the account tabs are reached in reading order and chosen with Space and Enter |

## Found and fixed

Each was found by this suite, fixed minimally, and has a test in the normal `npm test` suite as well as the browser assertion. Numbers 1 and 2 are behaviour tests, checked to fail on the old code; 3 to 6 are source checks (the browser is the real test of those, and only `npm run e2e` shows they work).

1. **The watchlist printed `Invalid Date` for every fighter's last fight** (`lib/watch.ts`). The server turned the fight's date into words ("Oct 3, 2026") and the page then formatted that string again. Since the commit that made the page format dates in the visitor's language, every watchlist card said Invalid Date. The server now sends the date as the data has it; the page does the formatting. Test: `tests/watchlist.test.ts`.
2. **A "something else" report blocked everyone else's report about the same fighter** (`lib/accounts/corrections.ts`). The duplicate check compares a report's field and proposed value; a free-text report has no value, so any open one made every other free-text report on that fighter fail with "Someone has already reported exactly this". It is the same report only if it says the same words now. Test: `tests/reports.test.ts`.
3. **The note that the browser's picks moved onto a new account was never shown** (`components/AccountPanel.tsx`). It was kept in the sign-up form's state, and the form is unmounted the moment the account is known. It is now passed up and shown on the signed-in page, in a status region. Test: `tests/accounts.test.ts` (source), and the pick'em flow.
4. **Escape from the search box, opened with the mouse from its button, dropped focus on the page** (`components/CommandPalette.tsx`). The button is replaced by the dialog while it is open, so the element remembered at opening was gone when the box closed. Focus now goes to the button that takes its place (or to what had focus, if that is still there). Test: `tests/a11y.test.ts` (source), and the palette flow.
5. **Tab left controls under the sticky bars** (`app/globals.css`, WCAG 2.4.11 Focus Not Obscured, which the site's own target includes). A control reached by keyboard was scrolled to the top edge, under the top bar and, on a fighter's page, the jump strip: the fight record's links were unreadable while focused. The page now has `scroll-padding-top` (5rem, 8rem with the strip), and the per-section `scroll-mt-*` classes that did the same job for links were removed (they would add up with it); a link's target and a focused control now stop in the same place. Test: `tests/jump-nav.test.ts` and `tests/a11y.test.ts` (source), and the tab-walk flow.
6. **After posting in the forum, keyboard focus fell to the top of the page** (`components/Discussion.tsx`). The Post button turns off when the box is emptied, and a button that turns off drops focus. Focus now goes back to the box. Test: `tests/forum-pages.test.ts` (source), and the compose flow.

## Found and left, needs a decision

- **The watchlist page replaces itself with "Loading your watchlist…" after every star or un-star** (`components/WatchlistPage.tsx`), so the "Add a fighter" search box is cleared after each add and a keyboard user's focus is dropped (the button they pressed is gone with the page). Fixing it means keeping the rows already on screen while the new list loads, and keeping the search box mounted when the first fighter is added (it is rendered in two places). A design choice about how the page should behave while loading; the flow works around it and does not assert on it.
- **The account page's sign-in / create-account / forgot-password buttons are marked `role="tab"` but have no arrow-key handling** (Tab, Enter and Space work, and every one is reachable). The ARIA tab pattern expects Left/Right (mirrored in Arabic) to move between them. Either give them the pattern's keys and roving tabindex, or drop the tab roles (the forum queue's two toggles already use `aria-pressed` instead, for this reason). The flow asserts what works today.
- **A 404 page's `<title>` is the site's generic title** ("Ringside — Boxing Intelligence"), not "Not found". Cosmetic; the page is `noindex`.
- **The English site does not match Arabic-script names in the search box** (the Arabic site matches both). By design (the name table is loaded for the Arabic site only); noted because the Arabic query is only tested on the Arabic pages.

## What it does not cover

Real touch gestures (the phone runs are a narrow desktop browser; the touch test only checks that the hover card never appears), a screen reader, other browsers than Chromium, drag or pinch, the data pages beyond "one h1, no console error, no broken text" (the axe sweep of `docs/accessibility.md` and `npm run smoke` cover those), and anything that needs the real data feed. The auto-hide rules themselves (reporter age, network areas, counts) are unit-tested (`tests/forum-policy.test.ts`); the browser suite only walks the path through the screens.

## Adding a flow

Copy a flow in `e2e/flows/`, give it variants (`ALL4`, `TWO`, or a list), and register it in `e2e/flows/index.ts`. Use `h.signUp(ctx)` for people, `h.fighter(n)` for the nth best-rated fighter with a record, `h.tr("English sentence")` for the words the page shows in the flow's language, and never a fixed sleep. Check a new flow by breaking the thing it tests.
