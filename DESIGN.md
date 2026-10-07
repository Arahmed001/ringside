# Design System: Ringside

> Status: **verified in a browser for accessibility (docs/accessibility.md); the visual direction is still a proposal.** It was written while the shell and dev server were unavailable, so it is based on the existing code and design principles, not on competitor screenshots, AI mockups or a live visual review. Run `/design-review` against the running app to check it.

## Product Context
- **What this is:** a boxing database with ratings, rankings, predictions and AI scouting, as a far more beautiful and analytical alternative to BoxRec.
- **Who it's for:** fight fans who look up fighters and cards, bettors and analysts who want numbers, and journalists who need quick context.
- **Space/industry:** combat-sports data (BoxRec, Tapology, Box.Live, Fight Matrix). The incumbents look like spreadsheets from 2005.
- **Project type:** data-heavy web app with an editorial front door.

## The one thing to remember
**"It looks like a fight-night program, and the numbers feel as dramatic as the fights."**
Every choice below serves that. The risk is turning drama into noise, so drama is reserved for headlines, posters and key numbers. Tables and charts stay calm.

## Aesthetic Direction
- **Direction:** Editorial / fight-night program with an industrial data layer. Posters and big condensed type up front, quiet, dense tables underneath.
- **Decoration level:** intentional. Soft radial spotlight behind the page, subtle card gradients, generated portraits and posters. No patterns, blobs or grain.
- **Mood:** arena lights on a dark canvas. Serious, a bit theatrical, never playful.

## Typography
- **Display / headlines:** Barlow Condensed 500–800, uppercase for headings, tracking +0.02em. The poster voice. It is tall and narrow, so long names and numbers fit.
- **Body / UI:** Geist. Neutral and highly legible, with tabular numerals. (Inter was replaced because it is the default every AI-built app converges on.)
- **Editorial accent:** Instrument Serif italic, used only for fighter nicknames and pull quotes, in gold. It gives the "ring announcer" touch and is the one deliberately unexpected choice.
- **Data / tables:** Geist with `font-variant-numeric: tabular-nums` (`.tabular`). Records, ratings and times must align in columns.
- **Loading:** `next/font/google` (self-hosted at build, no layout shift).
- **Scale (px):** 12 label · 14 body-sm · 16 body · 20 lead · 30 section title · 48 page title · 72–128 hero. Hero and page titles use display at leading 0.92–0.95.

## Color
- **Approach:** restrained with two semantic accents. Colour carries meaning, so it is rare.
- **Canvas / surface:** `--bg #09090b`, `--panel #131318`, `--panel-2 #1a1a21`, `--line #26262f`.
- **Text:** `--text #ecebe6` (warm off-white), `--muted #8d8d99`.
- **Red corner `#e5322d`** is the primary accent and also **always means the first-listed fighter / left side** (A in matchups, left on posters and bars). It is also the main call to action colour.
- **Blue corner `#4a8cff`** is **always the second fighter / right side**. Never use blue for anything else (links are text colour with an underline or gold on hover).
- **Gold `#d9b25f`** means *rating, rank, title, model pick*. Anything gold is something Ringside computed or an honour.
- **Semantic:** win `#3ecf8e`, loss uses red, draw/neutral uses muted.
- **Archetype colours** (style map and badges) are a separate categorical set in `lib/style.ts`. Do not reuse them elsewhere.
- **Dark mode:** the only mode for now. A light "newsprint" theme is a possible later addition and would need its own tuned palette, not an inversion.
- **Contrast (measured, tests/a11y.test.ts enforces it):** text `#ecebe6` 14.5-16.7:1, muted 5.3-6.1:1, gold 8.6-9.9:1, blue 5.3-6.2:1, green 8.7-10:1 on the three surfaces. The brand red `#e5322d` is only 4.0-4.6:1, so it is for fills, bars and large type; **small red text uses `--red-ink #ff5a54`** (`text-red-ink`, 5.6-6.5:1) and **a red button is `--red-btn #c9261f` with white text** (`bg-red-btn`, 5.5:1). Nothing under 12px.
- **Focus and keyboard:** one gold 2px ring (`:focus-visible`) on every control; a "Skip to content" link is the first tab stop; the current page in the header has `aria-current` and gold text. Never signal state by colour or opacity alone (legend toggles use `aria-pressed` and a strike-through).

## Spacing
- **Base unit:** 4px. **Density:** comfortable on content pages, compact in tables.
- **Scale:** 2xs 2 · xs 4 · sm 8 · md 16 · lg 24 · xl 32 · 2xl 48 · 3xl 64.
- Sections are separated by 48–64px. Cards use 16–24px padding. Table rows use 10px vertical padding.

## Layout
- **Approach:** hybrid. The home page and event pages are composition-led (a poster beside the headline). Rankings, fighters and analytics are grid-disciplined.
- **Grid:** 1 column phone, 2 at 640, 3 at 1024, 4 at 1536 for card lists (with the rail open, 1280 leaves about 1000 px of content: four fighter cards there are too tight). Detail pages use a 1.4fr / 1fr split.
- **Max content width:** 1280px (`max-w-7xl`), 20px side padding.
- **Border radius:** hierarchical. Chips full, cards 18px, inner panels 12–16px, bars full. Do not use one uniform radius.
- **Anti-patterns to avoid:** purple gradients, three-column icon feature grids, centred-everything pages, gradient buttons.

## Navigation
- **Desktop (1024 px and up):** a grouped left rail (Discover, Fights, Camps and money, Data and models), 15rem open and 4rem icons-only. It is open from 1280 px and icons-only below, unless the visitor chose; the choice is saved in this browser (`ringside-nav`) and applied before the first paint. In Arabic the rail is on the right. The top bar keeps only search, the language switch and, on phones, the menu button and logo.
- **Phones and small tablets:** a menu button opens the same list in a drawer (a native modal `<dialog>`: focus, Esc and the page behind are the browser's).
- A collapsed rail hides labels visually, never with `display:none`, so every link keeps its name; the current page has `aria-current` and gold text. Section list and groups live in `lib/nav.ts`; a test fails if a section with an index page is left out.

## Motion
- **Approach:** intentional. Things that *draw* or *grow* when data appears (rating line, bars), small lifts on hover, and live number transitions in the matchup lab.
- **Easing:** enter `cubic-bezier(.2,.8,.2,1)`, exit ease-in, move ease-in-out.
- **Duration:** micro 100ms · short 200–300ms (hover, probability bar) · medium 600ms (page rise) · long 900–1400ms (chart draw).
- Respect `prefers-reduced-motion` (already in `globals.css`). Do not animate on scroll (tests/motion.test.ts fails on scroll-driven CSS and on IntersectionObserver).
- **Between pages (2026-10-06):** `app/[locale]/template.tsx` wraps each page in React's `<ViewTransition>`: the old page leaves in 120 ms, the new one fades in over 200 ms with an 8px rise; the rail and top bar stay put. A thin gold bar (`components/NavProgress.tsx`) runs along the top while a page loads. Dialogs and the phone drawer slide or pop in (160-220 ms); buttons sink 3 % when pressed. On a desktop with a real pointer, a link to a fighter's page shows a small card (record, rating, rank, last fight) after the pointer rests on it for 0.45 s or keyboard focus does (`components/HoverPreview.tsx`; Esc, scrolling or leaving closes it; never on touch). A fighter's page, which is long, has a strip of jump links under the top bar (`components/JumpNav.tsx`; plain anchors, no script, so the current section is deliberately not highlighted). Every one of these is off under reduced motion (tests/motion.test.ts checks that each animated rule is listed there).

## Imagery
- **Headshots:** 4:5 portrait, `object-position: top`. Real photos only with a visible licence credit. Otherwise: the demo league's (fictional) fighters get the generated illustrated portrait; a real-data site gets a plain head-and-shoulders silhouette on one neutral `--panel-2` background (no division tint, so it never echoes the corner colours), which depends on nothing about the person (decided 2026-10-06).
- **Posters:** 5:7 portrait. Red fighter on the left, blue on the right, divided by a diagonal. A feed `posterUrl` always wins over the generated one.
- **Generated art is illustration, not photography,** and must never look like a real person's likeness. Demo fighters are fictional, which is why only they are drawn with faces.

## Components to keep consistent
- `ProbBar` and `MatchupLab` bars: red left, blue right, draw in grey.
- Rank movement: ▲ green, ▼ red, NEW gold chip.
- Every computed figure shows its basis ("Elo", "model", "unofficial") somewhere nearby.
- Chips: 12px text, full radius, muted border. Gold border means computed or honour.

## Decisions Log
| Date | Decision | Rationale |
|---|---|---|
| 2026-10-06 | Design review decisions (docs/design-review.md, O1-O10): blue and archetype colours are never reused for roles or fight methods (head trainer gold, other roles muted; KO family red, decisions gold, the rest grey); card titles and fighter names in the display face are uppercase; sortable headers carry a muted ▲▼; a chip that is a link or button is 44 px tall on touch; the greys and gold tints in charts are tokens (`--draw`, `--chart-grey`, `--chart-empty`, `--gold-2..4`) | The owner approved the review's recommended option for each; the card-list grid line and the silhouette background above were changed to match |
| 2026-10-06 | Weight classes are listed heaviest first everywhere they are shown as a list (`DIVISIONS_HEAVIEST_FIRST`) | The owner's call; the canonical order in `DIVISIONS` stays lightest to heaviest because the logic indexes it |
| 2026-10-03 | Dark editorial direction, red/blue corner semantics | Boxing's own visual language (corners, ring lights) doubles as a data encoding |
| 2026-10-03 | Replaced Inter with Geist for body text | Inter is the converged default; Geist is as legible, and has tabular numerals |
| 2026-10-03 | Arabic edition: mirrored layout, fixed red/blue corners, Plex Arabic + Tajawal + Amiri | Reading order flips, data encoding does not |
| 2026-10-03 | Dark scrim behind the poster header (black .72 to 0 over the top 112 units), sub-line 11px at 85% white | Measured over every poster (29 per language), the header lines were 2.4:1 on some colour schemes; now 5.3:1 or better, and `tests/a11y.test.ts` checks every scheme in `lib/poster-colors.ts` |
| 2026-10-03 | Added Instrument Serif italic for nicknames | One deliberate departure from category norms; gives the program/announcer feel |

**2026-10-03, home page: A and C combined (owner's choice).** Top to bottom: (1) the next main event as the page: poster at a large size beside the matchup as the `h1` (surnames, `VS` in gold between them), the full names and title or division, the win-probability bar with the two model chips, and "Read the preview" / "Full matchup breakdown"; (2) directly under it, "Ask the data": the question box at large size, five example questions, and a real answer computed from the database for the first example (the answer, the first table cut to five rows, and a link to the whole thing); (3) "Coming up" posters beside the pick'em; then the sections that were already there (pound for pound, divisions, recent main events, upset of the year, upset watch, fight of the year, watchlist). Between seasons (no fixture) the hero is the old brand line with a notice, no poster, and the page still has one `h1`. The fighter-search box that used to be in the hero is gone (the header and ⌘K search remain), and so is the separate "Next main event" card with headshots (its model chips moved into the hero).

## Arabic (RTL)
- **Mirrored, with fixed corners.** The page mirrors; charts, probability bars, posters, timelines and punch bars do not: red stays on the left and blue on the right in both languages, because the corners are a data encoding, not reading order. Text captions around them do flow right to left.
- **Type:** IBM Plex Sans Arabic for text, Tajawal 500-800 for the poster voice (compact and heavy like Barlow Condensed), Amiri for nicknames (Arabic has no italics, so the gold serif accent becomes a calligraphic face). No letter-spacing and no uppercase in Arabic; heading leading is loosened to 1.3 so marks above and below the line are not clipped; poster surnames are set smaller because Arabic glyphs run wider.
- **Numbers and dates:** Western digits (0-9) and the Gregorian calendar, as Saudi and Gulf sports media print them.

## Still to do
1. ~~Look at every page at 375, 768 and 1280px and fix whatever is off.~~ Done by measurement for reflow and accessibility (docs/accessibility.md, rounds 9 and 14); the visual review of desktop layouts is still partial (the screenshot tool letterboxes wide viewports).
2. ~~Generate alternative home-page directions.~~ Three are built from the real components at `/design/home?v=a|b|c` (a development-only lab, since deleted): **A Program cover** (the next fight is the page), **B Control room** (status row, pound-for-pound, main event and picks side by side), **C Ask first** (a live answer under the question box). **Chosen by the owner (2026-10-03): a combination of A and C**, built as the live home in round 30 (see the Decisions Log). **Approved as it stands by the owner (round 34); the lab (`app/[locale]/design`) and its `DESIGN_LAB` setting were deleted.**
3. Run `/design-review` and `/qa` and fix what they find.
4. ~~Check text contrast on generated posters over bright accent colours.~~ Done in round 19 (see the decision above). Not checked: a poster with a licensed photo background (the feed's own art is used as is).
