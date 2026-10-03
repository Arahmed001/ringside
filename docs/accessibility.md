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

## Re-running the sweep
Serve `node_modules/axe-core/axe.min.js` with CORS on a local port, then in the browser console of any Ringside page: fetch it, `eval` it inside an iframe of each path, call `axe.run(iframe.contentDocument)`. Allow about 1 s per page after load. `axe-core` is already installed (a dependency of another package; add it as a devDependency before relying on it).

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
