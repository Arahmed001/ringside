# Pictures: where they come from, and what is never taken

Ringside shows a picture only when its licence allows it and the credit travels with it. Nothing is copied: the database keeps the address of Wikimedia Commons' own thumbnail, the licence and the author, and the visitor's browser loads the image from Commons.

| What | Where from | Command | Shown on |
|---|---|---|---|
| Fighter headshot | Wikidata image (P18) of the fighter, once the fighter is identified (name, "is a boxer", birth year; or a Wikidata link already made) | `npm run media:resolve` | Fighter page, cards |
| Belt photo | Wikidata image (P18) of WBA, WBC, IBF or WBO: four items checked by hand (`BODIES` in `lib/media/entities.ts`), refused if the item is no longer labelled as that body | `npm run media:resolve -- --entities` | Title pages, the body's page |
| Organisation logo | Wikidata logo (P154) of an organisation in the organisations table, once linked: its name must be the item's label or an alias exactly, the item must be about boxing, and there must be only one | `-- --entities` | The organisation's page |
| Venue photo | Wikidata image (P18) of a venue already matched to Wikidata (`npm run venues:resolve`) | `-- --entities` | Event page, under the poster |
| Event poster | Only what the data feed supplies; otherwise the site draws one | (feed) | Event page |

`--entities` takes `--kind belt,org_logo,venue` and `--limit N` (per kind). Run it with `WIKIMEDIA_CONTACT` set, as for headshots. A "no match" is looked at again after 45 days, since Wikidata changes.

## The rules every file passes

A Commons file is accepted only if its licence is free (CC0, CC BY, CC BY-SA, public domain, with an optional port such as "CC BY 3.0 DE"), it is not marked non-free, it is a real image (a photo must be a raster; a logo may be SVG, served as Commons' PNG thumbnail) and a photo is not tiny. Anything non-commercial, no-derivatives or fair-use is refused outright; an unknown licence string is refused by default. A file Commons marks as a **trademark** keeps "(trademark of its owner)" on its credit.

## What the first live look found (2026-10-03)

- **Belts:** WBA, WBC, IBF and WBO each have a belt photo on Wikidata, all CC BY-SA (2.0 or 3.0), so the four bodies get a photo with credit.
- **Promotion logos: none.** Top Rank, Matchroom, Golden Boy, Queensberry, MVP and Zuffa Boxing have no logo on Wikidata (no P154 on any of the items found). A promotion's logo is a trademark and not free, so Commons does not hold it. They get the name in text. Do not fill the gap by copying logos from their websites; the right routes are the promoter's own press kit with their permission (their email to answer), or nothing.
- "Top Rank" alone is also a British record label, a Finnish band and a Game Boy game: that is why an organisation is linked only on an exact name **and** a boxing item **and** a single candidate.
- Matchroom Boxing and Queensberry Promotions did not come up in Wikidata's search at all.

## Not done, on purpose

- Fighters' other photos (action shots, weigh-ins) and event photos: no free source that can be tied to the right fight automatically.
- Belt images per title and division: Wikidata has one per body, not per belt.
- Any image from a vendor or a promoter without their written permission. BoxRec images are never used. With permission, an editor records the picture at /review/photos: see [photo-permissions.md](photo-permissions.md).
