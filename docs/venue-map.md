# The country map and where fights are held

**What it is.** `/countries` is a world map, each country shaded by its number of fighters (five shades, with the ranges printed under it) and each one a link to its page; a white dot marks a venue that has held fights. Under the map is the list of the busiest venues. A country's own page has a map zoomed to that country with its venue dots, and a table of its venues: name, city, kind of place (Arena, Stadium, Casino hotel...), street address, capacity, how many cards it has held, and a plain link "Open in Google Maps". The old grid of countries is still there, behind "All countries as a list".

**Where the data comes from, and why it is not Google's.**

| Thing | Source | Licence and how it is kept |
|---|---|---|
| Country outlines | Natural Earth 1:110m (naturalearthdata.com) | public domain; built once into `lib/geo/world-110m.json` by `npm run map:build`; drawn by this site as plain SVG, so no map library, no tiles and no request to anyone while a page is viewed |
| A venue's place, capacity and Wikidata id | Wikidata (`npm run venues:resolve`) | CC0; 583 venues so far |
| A venue's address, kind of place and, where Wikidata did not place it, its coordinates | OpenStreetMap through Nominatim (`npm run venues:osm`, also the `places` step of `vendor:enrich`) | ODbL: "© OpenStreetMap contributors" is printed wherever it is used; every answer is stored, so a venue is asked about once |
| "Open in Google Maps" | a plain link to Google's own search for the venue's name, city and country | nothing is requested from Google until someone presses it; nothing of Google's is stored |

Google Maps Platform's terms do not allow what the attached table needed: its place data may not be copied into our database (only the place ID may be kept, coordinates for 30 days), scraping is forbidden, and its data may only be shown on a Google map. So none of Google's data is stored here. If you later want Google's own map, it needs your Google key with billing on, and is a different build.

## How a venue is placed (the rules, `lib/importers/osm-venues.ts`)

**A wrong stadium is worse than none**, so a result from OpenStreetMap is accepted only if all of these hold: it is a kind of place a fight is held in (stadium, arena, sports hall, theatre, events venue, casino, hotel, club, convention or arts centre; or a building whose own name says arena, stadium, theatre...); it is in our country; its name is our venue's name (or a close variant: every word of ours is in theirs); it is in our city, or its name is exactly ours and it was filed under a district (the MGM Grand Garden Arena is under Paradise, not Las Vegas); and no other accepted result is more than 2 km away. A merely similar name in another place is not enough. A venue that does not pass stays on the list, just not on the map. A match accepted on the exact name alone, with the city not in its address, is stored with that note in `venue_places.reason`.

**Known limit:** a city name shared by several towns in one country (Springfield) can be placed in the wrong one when only one such venue is in OpenStreetMap, because the feed gives no state. Read a surprising dot's coordinates before trusting it.

Tried on the real service (9 October 2026): Madison Square Garden (4 Pennsylvania Plaza, New York, NY 10001), T-Mobile Arena (3780 South Las Vegas Boulevard, Las Vegas, NV 89109) and Caesars Palace (3570 Jay Sarno Way, Las Vegas, NV 89109) were placed with an address; Wembley Arena, which OpenStreetMap files as "OVO Arena Wembley", was refused (the city is not confirmed), which is the cautious outcome.

## Running it

```
npm run venues:osm -- --name "Wembley Stadium" --city London --country "United Kingdom"   a dry run for one venue: shows the decision, writes nothing
npm run venues:osm                                                                         the next 100 venues not yet asked about, busiest first (about 2 minutes)
npm run venues:osm -- --limit 500
```

One request a second (OpenStreetMap's rule), identified by `WIKIMEDIA_CONTACT`, and it stops at once if OpenStreetMap answers 403 or 429. In the weekly enrichment it runs 100 venues a week, so a big league is placed over a few weeks. The running site picks the places up at its next restart or reload.

## What it deliberately does not do

It does not guess an address, a capacity or a position; it does not show a pin for a venue that failed the rules; it does not fetch tiles or scripts from a map service; and it does not store anything from Google.
