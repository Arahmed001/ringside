# Filling the money, corners, gyms, promotions and broadcasters pages

The licensed vendor feed carries fights, fighters, cards (with a broadcaster name), belts and results. It carries no trainers, managers, gyms, promoters or money. These pages are filled from other, lawful sources, each with its own route and its own limits. Nothing here is BoxRec.

| Page | What fills it | Command | Coverage to expect |
|---|---|---|---|
| Broadcasters (on Gyms, promotions & bodies) | the cards' own broadcaster field: 81 spellings become about 40 channels, one page each with its cards | `npm run broadcasters:link` (also runs at the start of `venues:resolve`, so inside `vendor:enrich`) | every card that names a channel (2,509 of 10,364 in the first real load) |
| Corners: trainers and managers; Gyms; Promotions | sentences in a fighter's own Wikipedia article ("his trainer, X", "was trained by X", "trains out of the Y Gym", "signed with Z Promotions"), shown to an administrator with the sentence and a link, and written only on approval | `npm run watch -- --source team [--limit N]`, then approve at `/review/updates` | a few hundred fighters, the well-known ones; no dates (see below) |
| Money: card financials, purses, broadcasts, earnings | the researched claims in `data/research/` (two independent sites or one official record), matched to the cards and fighters held | `npm run research -- promote` then `npm run research -- apply` (offline; `check` re-reads the pages and needs `RESEARCH_CONTACT`) | the big cards only: in the first real load 81 cards, 86 purses, 2 broadcasts, 19 yearly earnings |

## Why the corners have no dates, and what that means
A sentence in an article says who a fighter's trainer *is*, not from when. A stint with no start and no end claims no fights (`boutsInWindow` returns nothing for it), so the Corners page can name the trainer and the trainer's fighters, while the **Trainer impact** figures (rating change during a tenure) stay empty: counting a whole career as one trainer's tenure would be false. Dated stints need a dated source (a commission licence list, the fighter's own announcement, a licensed dataset) and can be entered the same way, through a proposal or `team_stints` rows with `start_date`.

## After a reload
A reload replaces the sports database; approvals live in the accounts database. `npm run watch -- --replay` puts the approved results and the approved corners back. Run `npm run broadcasters:link` and `npm run research -- promote && npm run research -- apply` after a reload too.

## Limits worth knowing
- A sentence can be about someone else (an opponent's trainer, a former one): that is why nothing is written without a person's approval, and why the approval screen shows the sentence.
- Money claims need a card or fighter the database holds; a famous fight the vendor does not list (Alvarez vs Golovkin, in the first real load) is reported as "could not match", not guessed.
- On Fly, the new rows arrive with the next database ship (they are in `real.db`), and the news and pictures are fetched on Fly itself.
