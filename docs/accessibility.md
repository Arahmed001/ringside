# Accessibility (round 9, 2026-10-03)

Target: WCAG 2.2 AA, English and Arabic. This is what was measured, what changed, and what is still unproven.

## Method
- **axe-core 4.13** run against 23 pages x 2 languages (46 pages) in a real browser: home, rankings (+ division), fighters (+ profile), compare, analytics, money, titles (+ belt), matchmaking, previews (+ one preview), events (+ one event), a bout, corners (+ one person), organisations (+ one), style map, weigh-ins, data.
- Before: 9 rule failures (red button text 3.6:1, small red text 4.0:1, a dimmed legend at 1.6:1, 465 unnamed links and a nested control on the map, an empty table header, no `<h1>` on events and bout pages). After: **0 violations on all 46 pages.**
- Checked by hand in the browser: skip link (appears on focus, moves focus to `<main>`), `aria-current` in the header, the search palette (Tab stays in the box, Esc closes, results announced), reflow at 320 and 768 px on every page in both languages (no sideways scroll), the phone layout of a fight card, and the Arabic list view of the style map.
- `tests/a11y.test.ts` keeps the rules that need no browser: contrast of every text token on every surface, no text under 12px, red text/button rules, an `<h1>` on every page, the skip link and focus ring, reduced motion, Arabic for the new labels. Each rule was broken on purpose to confirm the test fails.

## What changed
- **Colour:** `--red-ink` for small red text, `--red-btn` behind white button text; the brand red stays for fills and large type. Placeholders use the full muted colour.
- **Keyboard:** skip link, one focus ring, `aria-current`, palette Tab trap + live result count + `aria-keyshortcuts`.
- **Structure:** `<h1>` on `/events` and bout pages, `<main id="main">`, heatmap with row/column headers and readable cells.
- **Charts:** rating line, radar and column chart now carry their numbers in the accessible name ("Rating over time. From 1500 to 1710, peak 1730"); the donut is hidden from assistive tech because its legend lists the same values.
- **Style map:** the 2,000 dots are hidden from assistive tech and keyboard order; **"Show as a list"** gives the same fighters as a sortable-by-style table with links (also useful to everyone). Legend toggles use `aria-pressed`.
- **Small screens:** single-column grids can shrink (`minmax(0,1fr)`), poster headings scale down under 480 px, fight cards stack the two fighters on phones.
- **Motion:** reduced-motion also removes hover lift, transitions and smooth scrolling. Forced-colours mode keeps card borders.
- **Text size:** 60 uses of 10-11px text raised to 12px.

## Not done / not proven
- **No screen reader was run** (VoiceOver/NVDA). axe finds roughly a third of real problems; the chart names, the palette and the Arabic reading order need a human listening to them.
- **Target size:** standalone "More ... →" links now meet 24px. Links inside dense lists and tables are 20px tall but spaced apart, which WCAG 2.2 allows; not every one was measured.
- **Weigh-in chart and Poster/Portrait** have names but no data summary. Pick'em and the matchup lab sliders were not re-tested with a keyboard beyond axe.
- **Arabic strings** added here (skip link, list view, chart summary) are machine translations awaiting native review, like the rest.
- Colour contrast was measured on the dark theme only; there is no light theme.

> The keyboard-only checks (tab order and visible focus on the main pages, the palette, the phone drawer, the forum form, the hover cards, arrow keys in Arabic and English) and the end-to-end flows are in `docs/e2e.md` and run with `npm run e2e`; they found that Tab could leave a focused control under the sticky bars and that Escape from the search box could drop focus (PLAN 235).

## Running the sweep for every page: `npm run a11y`
`npm run build`, then `npm run a11y`. It starts its own production server on a throwaway demo league (or `--db FILE`), opens every page in a real browser in both languages at 375 and 1280 px, injects axe-core and `scripts/a11y-sweep.js`, and prints `BAD` with the details for any page that is not clean (exit 1). Options: `--paths /a,/b`, `--widths 375`, `--langs ar`, `--port N`, `--headed`. It needs Playwright with a browser (`npm i -g playwright && npx playwright install chromium`, or `PLAYWRIGHT_MODULE=/path/to/playwright`); the site does not depend on it. A full run is about eight minutes.
- A leftover server on the port stops the run with a message (it would otherwise answer with an older build's pages): stop it first.
- Counted as accepted, not as failures: text cut by `.truncate` or a two-line `line-clamp` (long fighter and fight names in dense lists). With WCAG 1.4.12 text spacing forced on, a clamped name loses its last words; the full name is the link's destination and its page title. If that is ever judged not enough, remove the exemption in `a11y-sweep.js` and the sweep will list every clamp.
- Only headings that are rendered count towards "exactly one h1" (the print-only summary has its own, hidden on screen).

## Re-running the sweep
The iframe method this section used to describe stopped working in round 22 (the security headers forbid framing the site), so pages are checked one at a time:

```
npm run build && npm start                      # a production server, with the demo league
cd node_modules/axe-core && cp ../../scripts/a11y-sweep.js . && python3 -m http.server 8766
```

Then, for each page, in the Browser pane (or a browser console) on that page, with the window at the width you want (375 and 1280, both languages):

```js
await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "http://localhost:8766/a11y-sweep.js"; s.nonce = document.querySelector("script[nonce]")?.nonce || ""; s.onload = res; s.onerror = () => rej(new Error("blocked")); document.head.appendChild(s); }); await __check()
```

The `nonce` is what lets the page's content security policy accept the script. The result is `ok /path w375` for a clean page, or the details (axe rules, overflow, clipped text, small chart text, overlapping text). The script waits 1.2 s first so entrance animations have finished: axe reads colours mid-fade otherwise and reports contrast failures that are not there. `axe-core` is installed (a dependency of the lint config); add it as a devDependency before relying on it.

---

# Round 14: a second pass over everything built since (2026-10-03)

Since round 9 the site gained all-time lists, fight of the year, upset watch, trainer impact, ask the data, the track record and ledger, the side navigation and a post-fight recap, so every route was swept again.

## Method
- **axe-core 4.13** on 36 routes (including filtered, query and 404 variants) in both languages, with the side rail both open and collapsed: 0 violations.
- **Reflow** at 320, 768, 1024, 1280 and 1920 px on every route in both languages (about 400 page loads), and at 390 for target size, unlabelled SVGs, unnamed tables and heading levels.
- **WCAG 1.4.12 text spacing** (line height 1.5, letter spacing 0.12em, word spacing 0.16em forced on every page at 390 and 1280 px): no overflow and no clipped text.
- **Keyboard and screen-reader behaviour by script:** the what-if sliders and odds, the fighter picker (combobox), the palette, the drawer.
- **Source rules** (`tests/a11y.test.ts`, now 8 tests): every table has a name, every text input a label, every svg is described or hidden, the heatmap cell clips its hidden text, sliders keep a 24 px hit area. Each was broken on purpose to confirm a test fails.

## Found and fixed
- **A regression from round 9:** the screen-reader text I added to every heatmap cell is absolutely positioned, so with no positioned ancestor it escaped the scroll container and stretched `/analytics` to 423 px at a 320 px screen. The cell is now its own containing block.
- A long Arabic fighter name pushed the bout page 1 px wide at 320 px (it now wraps).
- 16 tables had no name for screen-reader table navigation; they are named from their headings (Ask results use `aria-labelledby`, the heatmap takes a label).
- The home and fighter-search inputs relied on placeholder text; both now have an `aria-label`.
- The what-if sliders had a 6 px hit area and read out only a bare number: 24 px control and thumb, and `aria-valuetext` ("3.00×", "35 mo").
- Changing a slider or preset changed the odds silently for screen-reader users: the odds are now announced through a polite live region.
- Small targets: breadcrumb links, the "VS" link on event cards, the year links on fight of the year, and the "How this was answered" and defences disclosures now have at least 24 px of height.
- Two routes returned errors during the sweep (`/bouts/[id]`, `/accountability`): not a code fault, the dev server held a database opened before the ledger tables were added; a restart fixed it.

## Checked and fine
No unlabelled SVG on any page; no skipped heading levels; the calibration chart is named, described and has a table beside it; the fighter picker works by keyboard (arrows, Enter, Escape, `aria-activedescendant`).

## Still not proven
- **No real screen reader** (VoiceOver, NVDA) was run. Chart names, the live odds announcements and the Arabic reading order need a person listening.
- **Target size:** the bars on a belt's reign timeline can be narrower than 24 px (a short reign); the same reigns are listed as links under it, which is the equivalent control. Links inside dense lists and tables are 18-20 px tall but spaced apart, which WCAG 2.2 allows; not every one was measured by hand.
- **Visual design review:** the screenshot tool letterboxes wide viewports, so desktop layouts were checked by measurement and at 1100 px, and mobile at 390 px for the new pages. The DESIGN.md items "alternative home directions" and a full `/design-review` were not run. Contrast of text on generated posters over bright accent colours was not measured.
- The Arabic strings added in this round (a handful) are machine translations like the rest.

## Round 18: accounts, leaderboard, contribute, review
Axe (WCAG 2.0 to 2.2 A/AA) over `/account`, `/leaderboard`, `/contribute`, `/review`, `/picks` and `/`, in English and Arabic, signed in, with a populated leaderboard: 0 violations. Forms use one `Field` (label tied by `for`/`id`, hint tied by `aria-describedby`), tabs are real `role="tab"` buttons, every result message is in a `role="status"` live region, the leaderboard table has a name, column and row headers. Reflow: the new header link made every page 7 px (English) and 28 px (Arabic) wider than a 320 px screen; it is an icon below `sm` now, with a `aria-label`, and the header spacing tightens on small screens. Not tested: a screen reader, and the account forms with browser autofill and password managers (the fields carry the standard `autocomplete` values).

## Round 19: poster contrast and the home directions
**Posters, measured.** Each generated poster was rasterised in the browser without its text (portraits inlined), and every text element's box was compared pixel by pixel with its fill: 29 posters in each language. Result before the fix: the event/title line (13px accent) 2.4:1 and the weight line (10px grey) 2.5:1 on some colour schemes, the postponed notice down to 2.2:1; surnames and record lines were fine (4.1:1 at 38-46px, 6:1). A dark band behind the header (and the weight line at 11px, 85% white) brought the worst case to 5.3:1 for the title line, 9.7:1 for the weight line and 6.4:1 for the red-corner surname; the Arabic posters measure the same. The measurement cannot run in CI (it needs a browser), so `tests/a11y.test.ts` carries an analytic version: the same gradient, spotlight and band maths for each scheme in `lib/poster-colors.ts`, which gives 2.46:1 without the band (matching the measured 2.43-2.46) and fails if the band goes. Not covered: posters built on a licensed photo, and the portrait art's own colours behind the surname.
**Home directions** (`/design/home`, a development-only lab, deleted in round 34 once the owner approved the combined home): all three pass axe in both languages at 1280, and none overflows at 320 or 390 px. Findings that apply to the live home too: the pick'em panel needs about 19rem or its fighter names wrap to three lines (it is 22rem there, fine), and Arabic display headings need about 25% less size and a 1.25 line height than the Latin ones to keep the same composition.

Round 20: the paging links are a `nav` named "Pages" with `rel=prev/next`, the year chips a `nav` named "Browse by year" with `aria-current` on the current one; arrows flip in Arabic.

Round 26: text that is English by nature on the Arabic site (a data source's name, a validator message, the wordmark) is now marked `lang="en"`, so a screen reader pronounces it as English rather than reading Latin letters with Arabic rules; the smoke run checks the Arabic pages for any other English.

## Round 29: On this day
`/on-this-day` in both languages: today, a crowded day, an empty day and 29 February at 375 px: axe-core 4.13 reported 0 violations on all eight and nothing overflowed. The left rail still scrolls with the extra item at 640 px high and marks the page `aria-current`. The previous and next day links carry a visually hidden "Previous day:" / "Next day:" so the date alone is not the whole link text out of context. Not tested: a screen reader, and text spacing (1.4.12) on this page.

## Round 30: the combined home page
`/` in both languages at 375 px: axe-core 4.13 reported 0 violations, nothing overflowed at 375 or 320 px, and there is exactly one `h1` (the matchup, or the brand line when no fight is booked). "Ask the data" is a labelled section (`aria-labelledby`) with the question box labelled by name; the hero's three-line `h1` ("Morishita / VS / Hartmann") reads as one heading. Not tested: a screen reader, text spacing (1.4.12) on the new layout, and the desktop Arabic layout beyond a look.

## Round 32: a sweep of everything since round 20
Every route in both languages at 1280 and 375 px (and the signed-in pages with a test account on a local server), with axe, forced text spacing, overflow, clipped text, rendered chart text size and overlapping text. What it found, all fixed:
- **Chart text far below 12 px as rendered.** SVG text scales with its picture. Measured in the browser: the weigh-in chart's labels were **3 px** on a phone, the rating chart's 5 px, the matchup radar's 6-9 px, the calibration chart's 10 px, and the profile and analytics pages' donut caption 9.6 px. The sparkline's and weigh-in chart's labels are now HTML (real 12 px text); the radar is drawn at its own size (never scaled) with 12 px labels, and wraps instead of shrinking when two sit side by side; the calibration chart and donut text were enlarged. A new test forbids SVG `fontSize` under 12 (the poster is the exception).
- **Scroll boxes a keyboard could not scroll.** Seven tables inside `overflow-x-auto` boxes (on six pages) had no focusable content, so a keyboard user could not scroll them (axe `scrollable-region-focusable`, seen only at 375 px, and on the leaderboard only once a player existed). `components/ScrollRegion.tsx` is a focusable, named group; every table wrapper that is not made of links uses it, and a test fails if a new `overflow-x-auto` appears outside the few files where every cell is a link. It is a *group*, not a region: a region named like its section failed `landmark-unique` on an Ask answer (found in the last pass), and a dozen region landmarks would clutter the landmark list.
- **Text laid over text.** The "% match" chip covered the fighter's name on every "Fighters like him" card; now a badge inside the card (the name gives way). The team timeline's year axis ran together on a phone ("20132015201720192021"): every other year is dropped below 640 px. The belt timeline's first label sat on the second (a label for a year that began before the strip was clamped to the edge): `lib/timeline.ts` labels only years whose 1 January is inside the strip, with tests.
- **A false alarm worth recording:** axe reported five colour-contrast failures on the new home page at 1280 px (colours like `#3e3421` on near-black). They were the entrance animation mid-fade; waiting for it to finish gives none. My round-30 check had been at 375 px only, which is why the 1280 result surprised me.
- **Left as it is:** champion names inside the belt timeline's narrow bars are clipped by design (the bar is a link with the full name and dates in its tooltip, and every reign is listed under "Every reign"); the poster's own 11 px text is the round-19 decision.
- **Not tested:** a screen reader; the signed-in graded-picks recap (picks only open on upcoming fights, so it cannot be reached in a live session; round 27's tests build it by hand); and the sweep covers a sample of dynamic pages (one fighter, event, bout, preview, belt), not every one.

