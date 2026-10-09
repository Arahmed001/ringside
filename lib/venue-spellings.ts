import type { DatabaseSync } from "node:sqlite";

const key = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * One venue, one spelling. The feed writes the same hall several ways within one city ("AG Rec Centre" and "Ag-Rec Centre", "AT & T Stadium"
 * and "AT&T Stadium", "Casino de Montreal" and "Casino de Montréal"), which splits its card list, its map pin and its venue check in two. Venues
 * with the same city and the same name once case, accents, spaces and punctuation are ignored are one; every event takes the spelling most of
 * them use (on a tie the accented one, then the longer, then the first alphabetically). The unused spelling's venue-check row goes, since the
 * kept one carries the check. Returns how many spellings were folded and how many events were renamed; running it twice changes nothing.
 * Then the second repair, `fillCityFromSameHall`: the feed often puts the hall's own name in the city field ("Manchester Arena" in "Manchester
 * Arena"), which hides the hall from its city and from the map. Where the same hall appears in the same country with a real city, that city
 * (when it is at least 60% of the real ones) replaces the copy of the name.
 */
export function unifyVenueSpellings(db: DatabaseSync): { groups: number; spellings: number; events: number; cities: number } {
  const rows = db.prepare("SELECT venue, city, COUNT(*) n FROM events WHERE venue <> '' AND city <> '' GROUP BY venue, city").all() as { venue: string; city: string; n: number }[];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${key(r.city)}|${key(r.venue)}`;
    if (k.endsWith("|") || k.startsWith("|")) continue;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out = { groups: 0, spellings: 0, events: 0, cities: 0 };
  const rename = db.prepare("UPDATE events SET venue = ? WHERE venue = ? AND city = ?");
  const dropCheck = db.prepare("DELETE FROM venues WHERE name = ? AND city = ?");
  const moveCheck = db.prepare("UPDATE OR IGNORE venues SET name = ? WHERE name = ? AND city = ?");
  db.exec("BEGIN");
  try {
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const best = [...list].sort((a, b) => b.n - a.n || Number(/[^\x00-\x7f]/.test(b.venue)) - Number(/[^\x00-\x7f]/.test(a.venue)) || b.venue.length - a.venue.length || (a.venue < b.venue ? -1 : 1))[0];
      out.groups++;
      for (const r of list) {
        if (r.venue === best.venue) continue;
        out.spellings++; out.events += Number(rename.run(best.venue, r.venue, r.city).changes);
        moveCheck.run(best.venue, r.venue, r.city); // the check moves with the name when the kept spelling has none; otherwise the old row is dropped
        dropCheck.run(r.venue, r.city);
      }
    }
    out.cities = fillCityFromSameHall(db);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return out;
}

/** Events whose city field only repeats the venue name take the real city the same hall has elsewhere in the same country. Runs inside the caller's transaction; returns the events changed. */
function fillCityFromSameHall(db: DatabaseSync): number {
  const rows = db.prepare("SELECT venue, city, COALESCE(country, '') country, COUNT(*) n FROM events WHERE venue <> '' AND city <> '' GROUP BY venue, city, country").all() as { venue: string; city: string; country: string; n: number }[];
  const real = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (key(r.city) === key(r.venue)) continue;
    const k = `${key(r.venue)}|${key(r.country)}`, m = real.get(k) ?? new Map<string, number>();
    m.set(r.city, (m.get(r.city) ?? 0) + r.n); real.set(k, m);
  }
  const setCity = db.prepare("UPDATE events SET city = ? WHERE venue = ? AND city = ? AND COALESCE(country, '') = ?");
  const dropCheck = db.prepare("DELETE FROM venues WHERE name = ? AND city = ?");
  let changed = 0;
  for (const r of rows) {
    if (key(r.city) !== key(r.venue)) continue;
    const m = real.get(`${key(r.venue)}|${key(r.country)}`);
    if (!m) continue;
    const total = [...m.values()].reduce((a, b) => a + b, 0), [best, n] = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (n / total < 0.6) continue;
    changed += Number(setCity.run(best, r.venue, r.city, r.country).changes);
    dropCheck.run(r.venue, r.city);
  }
  return changed;
}
