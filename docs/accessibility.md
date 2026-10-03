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
