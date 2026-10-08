/**
 * `npm run post-load` (task 24: "the first real look at the league, and speed at real size"): the pieces that need no server and no browser. The data checks (counts, completeness,
 * the sanity sample, the surprise heuristics), the verdict arithmetic, the redaction that makes the report safe to send, and the HTML and terminal renderers. The parts that start
 * a server, drive a browser and time pages are in lib/post-load-live.ts; scripts/post-load.ts runs them in order.
 *
 * Everything here reads a database opened READ-ONLY and prints only what it computed: a number in the report is a count or a measurement made in this run, never an estimate.
 * The functions that judge (duplicates, venue spellings, gaps in the years, the sample, the corners) take plain rows so a test can feed them a league made by hand.
 */
import type { DatabaseSync } from "node:sqlite";
import { careerView } from "./career";
import { canonicalCountry } from "./format";

export type Level = "pass" | "warn" | "fail" | "skip" | "info";
export interface Row { level: Level; label: string; detail: string }
export type Block =
  | { kind: "table"; caption?: string; head: string[]; rows: (string | number)[][] }
  | { kind: "bars"; caption: string; unit: string; data: { label: string; value: number; flag?: boolean }[]; note?: string }
  | { kind: "gallery"; items: { caption: string; src: string; alt: string }[] }
  | { kind: "examples"; title: string; lines: string[] }
  | { kind: "text"; text: string };
export interface Section { id: string; number: number; title: string; level: Level; summary: string; rows: Row[]; blocks: Block[] }

/** fail beats warn beats a section that could not run (skip) beats pass; notes (info) never colour a section. */
const ORDER: Level[] = ["fail", "warn", "skip", "pass", "info"];
export const worst = (levels: Level[]): Level => ORDER.find((l) => levels.includes(l)) ?? "info";
export const sectionLevel = (rows: Row[]): Level => worst(rows.map((r) => r.level));
export const n = (x: number): string => x.toLocaleString("en-US");
export const pctOf = (a: number, b: number, digits = 1): string => (b ? ((100 * a) / b).toFixed(digits) : "0.0") + "%";
export const shorten = (s: string, max = 70): string => (s.length > max ? s.slice(0, max - 1) + "…" : s);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// a small seeded generator: the same league and the same seed give the same sample, so two reports can be compared

export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffled<T>(xs: readonly T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// text normalisation shared by the duplicate heuristics

const deaccent = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** A name reduced to what two spellings of one person share: no accents, no case, no punctuation, words in alphabetical order ("Smith, John" and "John Smith" meet). */
export function normaliseName(name: string): string {
  return deaccent(name).toLowerCase().replace(/[^a-z0-9؀-ۿ\s]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
}
/** A venue or place reduced the same way, without word order (the order of a venue's words matters) and without the little words that vary. */
export function normalisePlace(s: string): string {
  return deaccent(s).toLowerCase().replace(/&/g, " and ").replace(/\bcentre\b/g, "center").replace(/[^a-z0-9؀-ۿ\s]/g, " ").split(/\s+/).filter((w) => w && !["the", "de", "of", "and", "la", "el"].includes(w)).join("");
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// surprises: the things that were wrong on earlier loads or are named in the runbook, each as a count and up to ten examples

export interface Surprise { id: string; title: string; level: Level; count: number; of?: number; note: string; examples: string[] }
export const MAX_EXAMPLES = 10;

export interface FighterRow { id: number; slug: string; name: string; birthYear: number | null }
/** Fighters who share a normalised name and a birth year. Two fighters with the same name and no birth year on either side are counted apart (`unknownYear`): that is far weaker evidence. */
export function findDuplicateFighters(rows: FighterRow[]): { strong: FighterRow[][]; unknownYear: number } {
  const byKey = new Map<string, FighterRow[]>(), byName = new Map<string, FighterRow[]>();
  for (const r of rows) {
    const nm = normaliseName(r.name);
    if (!nm) continue;
    if (r.birthYear === null) { byName.set(nm, [...(byName.get(nm) ?? []), r]); continue; }
    const k = `${nm}|${r.birthYear}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const strong = [...byKey.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length || a[0].name.localeCompare(b[0].name));
  return { strong, unknownYear: [...byName.values()].filter((g) => g.length > 1).length };
}

export interface PlaceCount { text: string; city: string; n: number }
/** A venue written two ways in one city ("Madison Square Garden" and "Madison Sq. Garden" are NOT caught: only spellings that differ in case, accents, punctuation, spacing or a little word meet). */
export function venueSpellings(rows: PlaceCount[]): { city: string; spellings: { text: string; n: number }[] }[] {
  const groups = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.text.trim()) continue;
    const k = `${normalisePlace(r.city)}|${normalisePlace(r.text)}`;
    const g = groups.get(k) ?? new Map<string, number>();
    g.set(r.text, (g.get(r.text) ?? 0) + r.n);
    groups.set(k, g);
  }
  const out: { city: string; spellings: { text: string; n: number }[] }[] = [];
  for (const [k, g] of groups) if (g.size > 1) out.push({ city: rows.find((r) => `${normalisePlace(r.city)}|${normalisePlace(r.text)}` === k)?.city ?? "", spellings: [...g].map(([text, c]) => ({ text, n: c })).sort((a, b) => b.n - a.n) });
  return out.sort((a, b) => b.spellings.reduce((s, x) => s + x.n, 0) - a.spellings.reduce((s, x) => s + x.n, 0));
}

/** A country written two ways: spellings that fold to the same text, or that the app itself reads as one country ("USA" and "United States"). Home nations are their own countries here, as in the app. */
export function countrySpellings(rows: { text: string; n: number }[]): { country: string; spellings: { text: string; n: number }[] }[] {
  const groups = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const t = r.text.trim();
    if (!t || t === "Unknown") continue;
    const k = normalisePlace(canonicalCountry(t));
    const g = groups.get(k) ?? new Map<string, number>();
    g.set(t, (g.get(t) ?? 0) + r.n);
    groups.set(k, g);
  }
  return [...groups.values()].filter((g) => g.size > 1).map((g) => {
    const spellings = [...g].map(([text, c]) => ({ text, n: c })).sort((a, b) => b.n - a.n);
    return { country: canonicalCountry(spellings[0].text), spellings };
  }).sort((a, b) => b.spellings.length - a.spellings.length);
}

/** Years inside the span of the data with far fewer rows than the years around them (or none): a hole in the history. The current year is left out: it is not over. */
export function findGaps(byYear: Map<number, number>, currentYear: number): { year: number; n: number; around: number }[] {
  const ys = [...byYear.keys()].filter((y) => y < currentYear);
  if (ys.length < 3) return [];
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
  const out: { year: number; n: number; around: number }[] = [];
  for (let y = lo + 1; y < hi; y++) {
    const around = median([-3, -2, -1, 1, 2, 3].filter((d) => y + d >= lo && y + d <= hi).map((d) => byYear.get(y + d) ?? 0));
    const have = byYear.get(y) ?? 0;
    if (around >= 50 && have < around * 0.2) out.push({ year: y, n: have, around });
  }
  return out;
}

/** Red's share of decided fights, overall and by year: a feed whose corners are swapped for a stretch of years shows as a year far from the rest. */
export function cornerShares(rows: { year: number; red: number; decided: number }[]): { overall: number; decided: number; odd: { year: number; share: number; decided: number }[] } {
  const decided = rows.reduce((s, r) => s + r.decided, 0), red = rows.reduce((s, r) => s + r.red, 0);
  const overall = decided ? red / decided : 0;
  const odd = rows.filter((r) => r.decided >= 200 && Math.abs(r.red / r.decided - overall) > 0.15).map((r) => ({ year: r.year, share: r.red / r.decided, decided: r.decided }));
  return { overall, decided, odd };
}

const lines = (xs: string[]): string[] => xs.slice(0, MAX_EXAMPLES);
const lvl = (count: number, warnAt = 1, failAt = Infinity): Level => (count >= failAt ? "fail" : count >= warnAt ? "warn" : "pass");

/** Every heuristic, run on a database. Read-only. */
export function gatherSurprises(db: DatabaseSync, today: string): Surprise[] {
  const out: Surprise[] = [];
  const all = <T,>(sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as T[];
  const one = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { c: number }).c;
  const fighters = one("SELECT COUNT(*) c FROM boxers");

  // duplicates
  const rows = all<{ id: number; slug: string; name: string; birth_year: number | null }>("SELECT id, slug, name, birth_year FROM boxers").map((r): FighterRow => ({ id: r.id, slug: r.slug, name: r.name, birthYear: r.birth_year && r.birth_year > 0 ? r.birth_year : null }));
  const dup = findDuplicateFighters(rows);
  const dupFighters = dup.strong.reduce((s, g) => s + g.length, 0);
  out.push({ id: "duplicate-fighters", title: "the same fighter twice (same name once spelling is normalised, same birth year)", level: lvl(dup.strong.length, 1, Math.max(5, fighters * 0.005)), count: dup.strong.length, of: fighters,
    note: `${n(dup.strong.length)} group(s) holding ${n(dupFighters)} fighters. ${n(dup.unknownYear)} more name(s) are shared by fighters with no birth year, which proves nothing and is not counted. Two real people can share a name and a birth year: look before merging.`,
    examples: lines(dup.strong.map((g) => `${g[0].name} (born ${g[0].birthYear}): ${g.map((r) => r.slug).join(", ")}`)) });

  // venues: one place spelled two ways within a city
  const venues = all<{ venue: string; city: string; c: number }>("SELECT venue, COALESCE(city,'') city, COUNT(*) c FROM events WHERE venue IS NOT NULL AND venue <> '' GROUP BY venue, city");
  const vs = venueSpellings(venues.map((v) => ({ text: v.venue, city: v.city, n: v.c })));
  out.push({ id: "venue-spellings", title: "one venue spelled two ways in the same city", level: lvl(vs.length), count: vs.length, of: new Set(venues.map((v) => v.venue)).size,
    note: "Spellings that differ only in case, accents, punctuation, spacing or a small word (the, de, of). Different words for one place are not caught.",
    examples: lines(vs.map((v) => `${v.city || "(no city)"}: ${v.spellings.map((s) => `"${s.text}" x${s.n}`).join(" / ")}`)) });

  // countries: fighters and events
  const cs = all<{ country: string; c: number }>("SELECT country, COUNT(*) c FROM (SELECT country FROM boxers UNION ALL SELECT country FROM events) WHERE country IS NOT NULL GROUP BY country");
  const cv = countrySpellings(cs.map((c) => ({ text: c.country, n: c.c })));
  out.push({ id: "country-spellings", title: "one country spelled two ways (fighters and events)", level: lvl(cv.length), count: cv.length, of: cs.length,
    note: "The audit checks fighters; this also reads the countries of events.",
    examples: lines(cv.map((c) => `${c.country}: ${c.spellings.map((s) => `"${s.text}" x${s.n}`).join(" / ")}`)) });

  // results for fights that have not been held
  const future = all<{ name: string; date: string; red: string; blue: string }>(`SELECT e.name, e.date, r.name red, bl.name blue FROM bouts b JOIN events e ON e.id = b.event_id JOIN boxers r ON r.id = b.red_id JOIN boxers bl ON bl.id = b.blue_id
    WHERE e.date > ? AND b.method IS NOT NULL AND COALESCE(b.status,'') <> 'cancelled' ORDER BY e.date LIMIT ${MAX_EXAMPLES}`, today);
  const futureN = one("SELECT COUNT(*) c FROM bouts b JOIN events e ON e.id = b.event_id WHERE e.date > ? AND b.method IS NOT NULL AND COALESCE(b.status,'') <> 'cancelled'", today);
  out.push({ id: "future-results", title: "fights dated after today that already have a result", level: lvl(futureN, 1, 1), count: futureN, note: `Today is ${today} by this machine's clock; if that is wrong, so is this count.`,
    examples: future.map((f) => `${f.date} ${shorten(f.name, 40)}: ${f.red} v ${f.blue}`) });

  // impossible careers
  const stray = all<{ id: number; name: string; event: string }>(`SELECT b.id, r.name || ' v ' || bl.name name, e.date event FROM bouts b JOIN events e ON e.id = b.event_id JOIN boxers r ON r.id = b.red_id JOIN boxers bl ON bl.id = b.blue_id
    WHERE b.winner_id IS NOT NULL AND b.winner_id <> b.red_id AND b.winner_id <> b.blue_id LIMIT 1000`);
  const strayN = one("SELECT COUNT(*) c FROM bouts WHERE winner_id IS NOT NULL AND winner_id <> red_id AND winner_id <> blue_id");
  const koOver = all<{ name: string; w: number; ko: number }>("SELECT name, vendor_wins w, vendor_ko_wins ko FROM boxers WHERE vendor_ko_wins > vendor_wins LIMIT 1000");
  const koOverN = one("SELECT COUNT(*) c FROM boxers WHERE vendor_ko_wins > vendor_wins");
  const stoppedOverN = one("SELECT COUNT(*) c FROM boxers WHERE vendor_stopped > vendor_losses");
  const selfN = one("SELECT COUNT(*) c FROM bouts WHERE red_id = blue_id");
  const impossible = strayN + koOverN + stoppedOverN + selfN;
  out.push({ id: "impossible-records", title: "records that cannot be true (more wins than fights)", level: lvl(impossible, 1, 1), count: impossible,
    note: `${n(strayN)} fight(s) name a winner who was in neither corner (that fighter would have a win with no fight), ${n(koOverN)} fighter(s) with more knockouts than wins, ${n(stoppedOverN)} with more times stopped than losses, ${n(selfN)} fight(s) of a fighter against himself.`,
    examples: lines([...stray.map((s) => `winner in neither corner: ${s.name} (${s.event})`), ...koOver.map((k) => `${k.name}: ${k.ko} knockouts in ${k.w} wins`)]) });

  // divisions with few fighters (men's and women's lists are separate)
  const small = all<{ w: string; sex: string | null; c: number }>("SELECT weight_class w, COALESCE(sex,'male') sex, COUNT(*) c FROM boxers GROUP BY weight_class, COALESCE(sex,'male') HAVING COUNT(*) < 10 ORDER BY c, w");
  out.push({ id: "small-divisions", title: "divisions with under 10 fighters", level: lvl(small.length), count: small.length, of: one("SELECT COUNT(*) c FROM (SELECT 1 FROM boxers GROUP BY weight_class, COALESCE(sex,'male'))"),
    note: "Men's and women's lists are counted apart. A women's division with a handful of fighters can be right; a men's one usually means a division name the app does not know.",
    examples: lines(small.map((s) => `${s.w || "(none)"} (${s.sex}): ${s.c}`)) });

  // events with one bout
  const withBouts = one("SELECT COUNT(*) c FROM (SELECT event_id FROM bouts GROUP BY event_id)");
  const singles = one("SELECT COUNT(*) c FROM (SELECT event_id FROM bouts GROUP BY event_id HAVING COUNT(*) = 1)");
  const singleEx = all<{ name: string; date: string }>("SELECT e.name, e.date FROM events e JOIN (SELECT event_id FROM bouts GROUP BY event_id HAVING COUNT(*) = 1) s ON s.event_id = e.id ORDER BY e.date DESC LIMIT 10");
  out.push({ id: "one-bout-events", title: "events with one bout", level: withBouts && singles / withBouts > 0.9 ? "warn" : "info", count: singles, of: withBouts,
    note: `${pctOf(singles, withBouts)} of the events that have any bout. Many are right in a league built from fighters' own fight lists (an opponent outside the loaded set leaves one bout on the card); a share over 90% is flagged.`,
    examples: singleEx.map((e) => `${e.date} ${shorten(e.name, 60)}`) });

  // corners
  const byYear = all<{ y: number; decided: number; red: number }>(`SELECT CAST(substr(e.date,1,4) AS INTEGER) y, COUNT(*) decided, SUM(CASE WHEN b.winner_id = b.red_id THEN 1 ELSE 0 END) red
    FROM bouts b JOIN events e ON e.id = b.event_id WHERE b.winner_id IS NOT NULL AND b.method IS NOT NULL AND b.method <> 'NC' AND e.date GLOB '[0-9][0-9][0-9][0-9]-*' GROUP BY y ORDER BY y`);
  const cornerStats = cornerShares(byYear.map((r) => ({ year: r.y, red: r.red, decided: r.decided })));
  const cornerLevel: Level = cornerStats.decided < 100 ? "info" : cornerStats.overall < 0.35 || cornerStats.overall > 0.75 || cornerStats.odd.length ? "warn" : "pass";
  out.push({ id: "swapped-corners", title: "corners that look swapped (the red corner's win share)", level: cornerLevel, count: cornerStats.odd.length, of: byYear.length,
    note: `The red corner won ${pctOf(cornerStats.overall * cornerStats.decided, cornerStats.decided)} of ${n(cornerStats.decided)} decided fights. A share outside 35-75%, or a year (200+ decided fights) more than 15 points from the whole, is flagged. Red is usually the favourite or the home fighter, so a share above 50% is normal.`,
    examples: lines(cornerStats.odd.map((o) => `${o.year}: red won ${pctOf(o.share * o.decided, o.decided)} of ${n(o.decided)} decided fights`)) });

  // dates and ages that cannot be true
  const badDates = one("SELECT COUNT(*) c FROM events WHERE date IS NULL OR date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR date < '1850-01-01' OR date > ?", `${Number(today.slice(0, 4)) + 3}-12-31`);
  const badDateEx = all<{ name: string; date: string | null }>("SELECT name, date FROM events WHERE date IS NULL OR date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR date < '1850-01-01' OR date > ? LIMIT 10", `${Number(today.slice(0, 4)) + 3}-12-31`);
  const badAge = one("SELECT COUNT(*) c FROM boxers WHERE birth_year IS NOT NULL AND birth_year > 0 AND (birth_year > ? OR birth_year < 1850 OR (debut_date IS NOT NULL AND debut_date <> '' AND CAST(substr(debut_date,1,4) AS INTEGER) - birth_year < 13))", Number(today.slice(0, 4)) - 13);
  const badAgeEx = all<{ name: string; birth_year: number; debut_date: string | null }>("SELECT name, birth_year, debut_date FROM boxers WHERE birth_year IS NOT NULL AND birth_year > 0 AND (birth_year > ? OR birth_year < 1850 OR (debut_date IS NOT NULL AND debut_date <> '' AND CAST(substr(debut_date,1,4) AS INTEGER) - birth_year < 13)) LIMIT 10", Number(today.slice(0, 4)) - 13);
  out.push({ id: "implausible-dates", title: "events with an impossible date, fighters who debuted before 13 or were born in the future", level: lvl(badDates + badAge), count: badDates + badAge,
    note: `${n(badDates)} event(s) with no date, a date that is not a date, before 1850 or more than 3 years ahead; ${n(badAge)} fighter(s) born before 1850, less than 13 years ago, or with a debut before they were 13.`,
    examples: lines([...badDateEx.map((e) => `event "${shorten(e.name, 40)}" dated ${e.date ?? "(none)"}`), ...badAgeEx.map((b) => `${b.name}: born ${b.birth_year}, debut ${b.debut_date ?? "?"}`)]) });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the loaded record of every fighter, as the app counts it, and the record the page must show

export interface Loaded { wins: number; losses: number; draws: number; fights: number }
/** A fight counts in a record when it has a result that is not "no contest" (lib/world.ts `countsInRecord`); a draw is a result with no winner. */
export function loadedRecords(db: DatabaseSync): Map<number, Loaded> {
  const rows = db.prepare(`WITH f AS (SELECT red_id id, winner_id w FROM bouts WHERE method IS NOT NULL AND method <> 'NC' UNION ALL SELECT blue_id, winner_id FROM bouts WHERE method IS NOT NULL AND method <> 'NC')
    SELECT id, SUM(CASE WHEN w = id THEN 1 ELSE 0 END) wins, SUM(CASE WHEN w IS NOT NULL AND w <> id THEN 1 ELSE 0 END) losses, SUM(CASE WHEN w IS NULL THEN 1 ELSE 0 END) draws, COUNT(*) fights FROM f GROUP BY id`).all() as { id: number; wins: number; losses: number; draws: number; fights: number }[];
  return new Map(rows.map((r) => [r.id, { wins: r.wins, losses: r.losses, draws: r.draws, fights: r.fights }]));
}
export interface Career { loaded: Loaded | undefined; vendor: { wins: number; losses: number; draws: number } | null; disputed: boolean }
/** The record a fighter's page must show, by the same rule the page uses (`careerView`). */
export function expectedRecord(c: Career): { text: string; source: "loaded" | "supplier" | "disputed" } {
  const l = c.loaded ?? { wins: 0, losses: 0, draws: 0, fights: 0 };
  const v = careerView({ wins: l.wins, losses: l.losses, draws: l.draws, vendorRecord: c.vendor, recordDisputed: c.disputed });
  return { text: `${v.wins}-${v.losses}-${v.draws}`, source: v.source };
}
const vendorOf = (r: { vendor_wins: number | null; vendor_losses: number | null; vendor_draws: number | null }) =>
  [r.vendor_wins, r.vendor_losses, r.vendor_draws].every((x) => typeof x === "number" && x >= 0) ? { wins: r.vendor_wins as number, losses: r.vendor_losses as number, draws: r.vendor_draws as number } : null;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// counts and completeness

export interface Counts {
  fighters: number; bouts: number; decided: number; cancelled: number; upcoming: number; noResult: number; events: number; divisions: number; countries: number; orgs: number; bodies: number;
  beltNames: number; titleBouts: number; people: number; withBout: number;
  photo: number; arabic: number; wikidata: number; female: number;
  record: { full: number; partial: number; disputed: number; ahead: number; noTotal: number; noFights: number };
  boutsByYear: Map<number, number>; eventsByYear: Map<number, number>;
}
export function gatherCounts(db: DatabaseSync, today: string): Counts {
  const one = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { c: number }).c;
  const tableExists = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const photo = one(`SELECT COUNT(*) c FROM boxers b WHERE (b.photo_url IS NOT NULL AND b.photo_url <> '')${tableExists("boxer_media") ? " OR EXISTS (SELECT 1 FROM boxer_media m WHERE m.boxer_id = b.id AND m.status = 'matched')" : ""}`);
  const arabic = one(`SELECT COUNT(*) c FROM boxers b WHERE 0${tableExists("name_translations") ? " OR EXISTS (SELECT 1 FROM name_translations t WHERE t.en = b.name AND t.locale = 'ar' AND t.text <> '')" : ""}${tableExists("wikidata_boxers") ? " OR EXISTS (SELECT 1 FROM wikidata_boxers w WHERE w.matched_boxer_id = b.id AND w.ar_label IS NOT NULL AND w.ar_label <> '')" : ""}`);
  const loaded = loadedRecords(db);
  const record = { full: 0, partial: 0, disputed: 0, ahead: 0, noTotal: 0, noFights: 0 };
  for (const r of db.prepare("SELECT id, vendor_wins, vendor_losses, vendor_draws, record_disputed FROM boxers").all() as { id: number; vendor_wins: number | null; vendor_losses: number | null; vendor_draws: number | null; record_disputed: number | null }[]) {
    const l = loaded.get(r.id), v = vendorOf(r);
    if (r.record_disputed === 1) { record.disputed++; continue; }
    if (!l && !v) { record.noFights++; continue; }
    if (!v) { record.noTotal++; continue; }
    const lw = l?.wins ?? 0, ll = l?.losses ?? 0, ld = l?.draws ?? 0;
    if (lw === v.wins && ll === v.losses && ld === v.draws) record.full++;
    else if (lw <= v.wins && ll <= v.losses && ld <= v.draws) record.partial++;
    else record.ahead++;
  }
  const yearRows = (sql: string) => new Map((db.prepare(sql).all() as { y: number; c: number }[]).filter((r) => r.y >= 1800).map((r) => [r.y, r.c]));
  return {
    fighters: one("SELECT COUNT(*) c FROM boxers"), bouts: one("SELECT COUNT(*) c FROM bouts"),
    decided: one("SELECT COUNT(*) c FROM bouts WHERE method IS NOT NULL AND method <> 'NC'"), cancelled: one("SELECT COUNT(*) c FROM bouts WHERE status = 'cancelled'"),
    upcoming: one("SELECT COUNT(*) c FROM bouts b JOIN events e ON e.id = b.event_id WHERE e.date > ? AND b.method IS NULL AND COALESCE(b.status,'') <> 'cancelled'", today),
    noResult: one("SELECT COUNT(*) c FROM bouts b JOIN events e ON e.id = b.event_id WHERE e.date <= ? AND b.method IS NULL AND COALESCE(b.status,'') <> 'cancelled'", today),
    events: one("SELECT COUNT(*) c FROM events"), divisions: one("SELECT COUNT(DISTINCT weight_class) c FROM boxers WHERE weight_class IS NOT NULL AND weight_class <> ''"),
    countries: one("SELECT COUNT(DISTINCT country) c FROM boxers WHERE country IS NOT NULL AND country <> '' AND country <> 'Unknown'"),
    orgs: one("SELECT COUNT(*) c FROM orgs"), bodies: one("SELECT COUNT(*) c FROM orgs WHERE kind = 'sanctioning_body'"),
    beltNames: one("SELECT COUNT(DISTINCT title) c FROM bouts WHERE title IS NOT NULL AND title <> ''"), titleBouts: one("SELECT COUNT(*) c FROM bouts WHERE title IS NOT NULL AND title <> '' AND COALESCE(status,'') <> 'cancelled'"),
    people: one("SELECT COUNT(*) c FROM people"), withBout: one("SELECT COUNT(*) c FROM boxers b WHERE EXISTS (SELECT 1 FROM bouts x WHERE x.red_id = b.id OR x.blue_id = b.id)"),
    photo, arabic, wikidata: one("SELECT COUNT(*) c FROM boxers WHERE wikidata_id IS NOT NULL AND wikidata_id <> ''"), female: one("SELECT COUNT(*) c FROM boxers WHERE sex = 'female'"),
    record,
    boutsByYear: yearRows("SELECT CAST(substr(e.date,1,4) AS INTEGER) y, COUNT(*) c FROM bouts b JOIN events e ON e.id = b.event_id WHERE COALESCE(b.status,'') <> 'cancelled' GROUP BY y"),
    eventsByYear: yearRows("SELECT CAST(substr(date,1,4) AS INTEGER) y, COUNT(*) c FROM events GROUP BY y"),
  };
}

const yearBars = (m: Map<number, number>, gaps: { year: number }[], caption: string, unit: string): Block => {
  const years = [...m.keys()].sort((a, b) => a - b);
  const data: { label: string; value: number; flag?: boolean }[] = [];
  if (years.length) for (let y = years[0]; y <= years[years.length - 1]; y++) data.push({ label: String(y), value: m.get(y) ?? 0, flag: gaps.some((g) => g.year === y) });
  return { kind: "bars", caption, unit, data, note: gaps.length ? `Flagged: ${gaps.map((g) => g.year).join(", ")} (under a fifth of the median of the three years either side, where that median is 50 or more).` : "No year is flagged (a flagged year has under a fifth of the median of the three years either side, where that median is 50 or more)." };
};

export function countsSection(c: Counts, today: string): { section: Section; gaps: { bouts: ReturnType<typeof findGaps>; events: ReturnType<typeof findGaps> } } {
  const cy = Number(today.slice(0, 4));
  const gb = findGaps(c.boutsByYear, cy), ge = findGaps(c.eventsByYear, cy);
  const rows: Row[] = [];
  const add = (level: Level, label: string, detail: string) => rows.push({ level, label, detail });
  add(c.fighters > 0 && c.bouts > 0 ? "info" : "fail", "size", `${n(c.fighters)} fighters (${n(c.withBout)} with at least one bout, ${n(c.female)} women), ${n(c.bouts)} bouts on ${n(c.events)} events`);
  add("info", "bouts", `${n(c.decided)} with a result, ${n(c.noResult)} past with no result, ${n(c.upcoming)} still to come, ${n(c.cancelled)} cancelled`);
  add(c.divisions >= 8 ? "info" : "warn", "divisions and countries", `${c.divisions} divisions, ${c.countries} countries`);
  add("info", "organisations and belts", `${n(c.orgs)} organisations (${c.bodies} sanctioning bodies), ${n(c.beltNames)} distinct belt names on ${n(c.titleBouts)} title bouts, ${n(c.people)} people (trainers, officials)`);
  add("info", "photos", `${n(c.photo)} of ${n(c.fighters)} fighters have a photo (${pctOf(c.photo, c.fighters)}); the rest show the silhouette. Photos come from vendor:enrich (load-day step 6), not from the load.`);
  add("info", "Arabic names", `${n(c.arabic)} of ${n(c.fighters)} have an Arabic name (${pctOf(c.arabic, c.fighters)}); the rest show the English name on the Arabic pages`);
  add("info", "Wikidata ids", `${n(c.wikidata)} of ${n(c.fighters)} (${pctOf(c.wikidata, c.fighters)})`);
  const r = c.record, withTotal = r.full + r.partial + r.disputed + r.ahead;
  add(r.ahead > 0 ? "warn" : "info", "records", `${n(r.full)} full (the loaded fights add up to the supplier's career total), ${n(r.partial)} partial (fewer fights loaded than the total: the page shows the total), ${n(r.disputed)} disputed (${pctOf(r.disputed, withTotal)} of fighters with a total), ${n(r.ahead)} ahead of the supplier's total but not marked (its total lags a recent fight), ${n(r.noTotal)} with no supplier total, ${n(r.noFights)} with neither`);
  add(gb.length ? "warn" : "pass", "bouts per year", gb.length ? `${gb.length} year(s) look like holes: ${gb.slice(0, 6).map((g) => `${g.year} has ${n(g.n)} (the years around it ${n(g.around)})`).join("; ")}` : "no year inside the span looks like a hole");
  add(ge.length ? "warn" : "pass", "events per year", ge.length ? `${ge.length} year(s) look like holes: ${ge.slice(0, 6).map((g) => `${g.year} has ${n(g.n)} (around ${n(g.around)})`).join("; ")}` : "no year inside the span looks like a hole");
  const section: Section = { id: "counts", number: 2, title: "Counts and completeness", level: sectionLevel(rows), summary: `${n(c.fighters)} fighters, ${n(c.bouts)} bouts, ${n(c.events)} events; ${gb.length + ge.length} year hole(s)`, rows,
    blocks: [
      { kind: "table", caption: "How complete each fighter's record is", head: ["kind", "fighters", "share", "what the page shows"], rows: [
        ["full", r.full, pctOf(r.full, c.fighters), "the record counted from the fights loaded (it equals the supplier's total)"],
        ["partial", r.partial, pctOf(r.partial, c.fighters), "the supplier's total, labelled (the fight list does not reach the early career)"],
        ["disputed", r.disputed, pctOf(r.disputed, c.fighters), "the supplier's total, with a note that the fights disagree"],
        ["ahead of the total, unmarked", r.ahead, pctOf(r.ahead, c.fighters), "the loaded record (the supplier's total lags)"],
        ["no supplier total", r.noTotal, pctOf(r.noTotal, c.fighters), "the loaded record"],
        ["no fights and no total", r.noFights, pctOf(r.noFights, c.fighters), "0-0-0"]] },
      yearBars(c.boutsByYear, gb, "Bouts per year", "bouts"), yearBars(c.eventsByYear, ge, "Events per year", "events")] };
  return { section, gaps: { bouts: gb, events: ge } };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the sanity sample: 60 fighters, picked from the data with a seeded generator

export interface FighterStat { id: number; slug: string; name: string; fights: number; first: string | null; last: string | null; titleWins: number; champion: boolean; disputed: boolean }
export const SAMPLE_GROUPS = [
  ["active", "10 most active (most fights)"], ["champion", "10 champions (official champions, then most title-fight wins)"], ["disputed", "10 disputed records"],
  ["career", "10 longest careers (first to last fight)"], ["few", "10 with the fewest fights"], ["random", "10 at random"],
] as const;
export type SampleGroup = (typeof SAMPLE_GROUPS)[number][0];
export interface SampleFighter extends FighterStat { group: SampleGroup }
const days = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);

/** Ten fighters for each group, never the same fighter twice: when a fighter is already taken the next one in that group's order is used. Ties are broken by the seeded shuffle, so the same league gives the same sample. */
export function selectSample(stats: FighterStat[], seed: number, per = 10): SampleFighter[] {
  const rng = seeded(seed), base = shuffled(stats, rng);
  const rank = (cmp: (a: FighterStat, b: FighterStat) => number, keep: (s: FighterStat) => boolean = () => true) => base.filter(keep).sort(cmp); // stable: ties keep the shuffled order
  const lists: Record<Exclude<SampleGroup, "random">, FighterStat[]> = {
    active: rank((a, b) => b.fights - a.fights),
    champion: rank((a, b) => Number(b.champion) - Number(a.champion) || b.titleWins - a.titleWins, (s) => s.champion || s.titleWins > 0),
    disputed: base.filter((s) => s.disputed),
    career: rank((a, b) => (b.first && b.last ? days(b.first, b.last) : -1) - (a.first && a.last ? days(a.first, a.last) : -1), (s) => !!s.first),
    few: rank((a, b) => a.fights - b.fights, (s) => s.fights > 0),
  };
  const taken = new Set<number>(), out: SampleFighter[] = [];
  for (const [g] of SAMPLE_GROUPS) {
    const list = g === "random" ? base : lists[g];
    let k = 0;
    for (const s of list) { if (k >= per) break; if (taken.has(s.id)) continue; taken.add(s.id); out.push({ ...s, group: g }); k++; }
  }
  // a league with no champions yet, or no disputed records, still gets its 60: the shortfall is made up at random, and the table says so by the group name
  for (const s of base) { if (out.length >= per * SAMPLE_GROUPS.length) break; if (!taken.has(s.id)) { taken.add(s.id); out.push({ ...s, group: "random" }); } }
  return out;
}

export function gatherSampleStats(db: DatabaseSync): FighterStat[] {
  const champs = new Set((db.prepare("SELECT DISTINCT boxer_id id FROM official_rankings WHERE kind = 'champion' AND boxer_id IS NOT NULL AND COALESCE(vacant,0) = 0").all() as { id: number }[]).map((r) => r.id));
  const rows = db.prepare(`WITH f AS (SELECT b.red_id id, e.date d, b.winner_id w, b.title t FROM bouts b JOIN events e ON e.id = b.event_id WHERE COALESCE(b.status,'') <> 'cancelled'
      UNION ALL SELECT b.blue_id, e.date, b.winner_id, b.title FROM bouts b JOIN events e ON e.id = b.event_id WHERE COALESCE(b.status,'') <> 'cancelled')
    SELECT x.id, x.slug, x.name, COALESCE(x.record_disputed,0) disputed, COUNT(f.id) fights, MIN(f.d) first, MAX(f.d) last,
      SUM(CASE WHEN f.w = x.id AND f.t IS NOT NULL AND f.t <> '' THEN 1 ELSE 0 END) titleWins FROM boxers x LEFT JOIN f ON f.id = x.id GROUP BY x.id ORDER BY x.id`).all() as
    { id: number; slug: string; name: string; disputed: number; fights: number; first: string | null; last: string | null; titleWins: number | null }[];
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, fights: r.fights, first: r.first, last: r.last, titleWins: r.titleWins ?? 0, champion: champs.has(r.id), disputed: r.disputed === 1 }));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// what one rendered page is checked for (the live part fetches the page; the judging is here so a test can feed it HTML)

/** The words that show up when a template was filled from a value that was not there. Looked for in the text a reader sees, not in markup or script data. */
export const BAD_WORDS = /\bundefined\b|\bNaN\b|\bnull\b|\[object\b/g;
export function visibleText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
}
export function badWords(html: string): string[] {
  const t = visibleText(html), out: string[] = [];
  for (const m of t.matchAll(BAD_WORDS)) out.push(`…${t.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25)}…`);
  return out;
}
/** The record a fighter page shows ("Record 18-4-0"), or null when the page has none. */
export function pageRecord(html: string): string | null {
  const m = /Record\s+(\d+-\d+-\d+)/.exec(visibleText(html));
  return m ? m[1] : null;
}
export function pageAge(html: string): number | null {
  const m = /\bAge\s+(\d{1,3})\b/.exec(visibleText(html));
  return m ? Number(m[1]) : null;
}
/** The last-fights strip ("Last 5 fights W W W L W", or "Last fight W" for one): the letters it shows, or null when the page has none. */
export function pageForm(html: string): string[] | null {
  const m = /Last (?:(\d+) fights|fight)((?:\s+[WLD]\b)+)/.exec(visibleText(html));
  if (!m) return null;
  return m[2].trim().split(/\s+/).slice(0, m[1] ? Number(m[1]) : 1);
}
/** Ages that cannot be true for a boxer on a page: under 14 or over 80. A fighter with no birth year shows no age, which is not a problem. */
export function sensibleAge(age: number | null): boolean { return age === null || (age >= 14 && age <= 80); }
/** The checks that need only the page's HTML and the database's own numbers. */
export function checkFighterHtml(html: string, status: number, expect: { record: string; fights: number; hasBirthYear: boolean }, opts: { arabic?: boolean } = {}): string[] {
  const p: string[] = [];
  if (status !== 200) return [`HTTP ${status}`];
  for (const b of badWords(html).slice(0, 3)) p.push(`shows a placeholder word: ${b}`);
  if (opts.arabic) return p;
  const rec = pageRecord(html);
  if (rec === null) p.push("no record on the page");
  else if (rec !== expect.record) p.push(`record ${rec} on the page, ${expect.record} by the database`);
  const age = pageAge(html);
  if (!sensibleAge(age)) p.push(`age ${age} is not plausible`);
  if (expect.hasBirthYear && age === null) p.push("has a birth year but the page shows no age");
  const form = pageForm(html);
  if (expect.fights > 0 && form === null) p.push("no last-fights strip");
  if (form !== null && form.length > Math.min(5, expect.fights)) p.push(`the form strip shows ${form.length} fights for a fighter with ${expect.fights}`);
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the verdict, the terminal summary, redaction and the HTML report

export interface Verdict { level: "pass" | "warn" | "fail"; line: string }
export function verdict(sections: Section[]): Verdict {
  const judged = sections.filter((s) => s.level !== "info");
  const name = (s: Section) => `${s.number} ${s.title.toLowerCase()}`;
  const failing = judged.filter((s) => s.level === "fail"), warning = judged.filter((s) => s.level === "warn" || s.level === "skip");
  if (failing.length) return { level: "fail", line: `VERDICT: FAIL - ${failing.length} section(s) failed (${failing.map(name).join("; ")}). Send the whole report back before using this load.` };
  if (warning.length) return { level: "warn", line: `VERDICT: WARN - nothing failed; ${warning.length} section(s) to read (${warning.map(name).join("; ")}).` };
  return { level: "pass", line: "VERDICT: PASS - every section passed: the league looks right and the pages answered within the limits on this machine." };
}
const TAG: Record<Level, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP", info: "NOTE" };
export const levelTag = (l: Level): string => TAG[l];
export function terminalSummary(sections: Section[], v: Verdict, head: string[], tail: string[]): string[] {
  const out = [...head, ""];
  for (const s of sections) out.push(`${TAG[s.level]}  ${s.number}. ${s.title.padEnd(28)} ${s.summary}`);
  out.push("", v.line, ...tail);
  return out;
}

/** Makes text safe to send: the home folder becomes `~`, the temporary folders go, and any value of a setting whose name suggests a secret is blanked wherever it appears. */
export function redactor(o: { home: string; tmp: string[]; env: Record<string, string | undefined> }): (s: string) => string {
  const secrets = Object.entries(o.env).filter(([k, v]) => /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i.test(k) && (v ?? "").trim().length >= 8).map(([, v]) => (v as string).trim());
  const lit = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (s) => {
    let t = s;
    for (const x of secrets) t = t.split(x).join("[hidden]");
    for (const d of o.tmp.filter(Boolean)) t = t.replace(new RegExp(lit(d.replace(/\/$/, "")) + "[^\\s\"'<>),;]*", "g"), "(temporary copy)");
    if (o.home && o.home !== "/") t = t.replace(new RegExp(lit(o.home.replace(/\/$/, "")) + "(?=[/\\s\"'<>)]|$)", "g"), "~");
    return t;
  };
}

export const esc = (s: unknown): string => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const CSS = `:root{--bg:#09090b;--panel:#131318;--panel-2:#1a1a21;--line:#26262f;--text:#ecebe6;--muted:#8d8d99;--red:#e5322d;--red-ink:#ff5a54;--blue:#4a8cff;--gold:#d9b25f;--green:#3ecf8e}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1,h2{font-family:"Barlow Condensed","Arial Narrow",Impact,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.02em;line-height:1}
h1{font-size:44px;margin:0 0 8px}h2{font-size:28px;margin:0}h3{font-size:16px;margin:24px 0 8px}p{margin:8px 0}.muted{color:var(--muted)}.tabular{font-variant-numeric:tabular-nums}
.verdict{border:1px solid var(--line);border-radius:18px;background:var(--panel);padding:16px 20px;margin:16px 0}.verdict p{font-size:18px;margin:0}
section{border:1px solid var(--line);border-radius:18px;background:var(--panel);padding:20px;margin:20px 0}section>header{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.tag{display:inline-block;min-width:3.6em;text-align:center;padding:1px 10px;border-radius:999px;border:1px solid var(--muted);font-size:12px;font-weight:700;letter-spacing:.06em;white-space:nowrap}
.tag.pass{color:var(--green);border-color:var(--green)}.tag.warn{color:var(--gold);border-color:var(--gold)}.tag.fail{color:var(--red-ink);border-color:var(--red-ink)}.tag.skip,.tag.info{color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-top:1px solid var(--line)}th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.rows td:first-child{white-space:nowrap}.scroll{overflow-x:auto}
pre{background:var(--panel-2);border:1px solid var(--line);border-radius:12px;padding:12px;overflow-x:auto;font-size:13px;line-height:1.45;margin:8px 0;white-space:pre-wrap;word-break:break-word}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.gallery figure{margin:0;background:var(--panel-2);border:1px solid var(--line);border-radius:12px;padding:8px}
.gallery img{width:100%;height:auto;display:block;border-radius:8px}.gallery figcaption{font-size:12px;color:var(--muted);margin-top:6px}
.bars{width:100%;height:auto;display:block}.bars rect{fill:var(--blue)}.bars rect.flag{fill:var(--red)}details{margin:8px 0}summary{cursor:pointer;color:var(--muted)}
.ex{margin:6px 0 0;padding-left:18px;font-size:13px;color:var(--muted)}a{color:var(--text)}@media(max-width:640px){h1{font-size:34px}.wrap{padding:16px 16px 48px}}`;

function renderBlock(b: Block): string {
  if (b.kind === "text") return `<p class="muted">${esc(b.text)}</p>`;
  if (b.kind === "examples") return `<h3>${esc(b.title)}</h3><ul class="ex">${b.lines.map((l) => `<li>${esc(l)}</li>`).join("") || "<li>none</li>"}</ul>`;
  if (b.kind === "table") {
    const num = (i: number) => b.rows.length > 0 && b.rows.every((r) => typeof r[i] === "number");
    return `${b.caption ? `<h3>${esc(b.caption)}</h3>` : ""}<div class="scroll"><table><thead><tr>${b.head.map((h, i) => `<th${num(i) ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => `<td${num(i) ? ' class="num"' : ""}>${typeof c === "number" ? esc(n(c)) : esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  if (b.kind === "gallery") return `<div class="gallery">${b.items.map((i) => `<figure><img src="${esc(i.src)}" alt="${esc(i.alt)}" loading="lazy"><figcaption>${esc(i.caption)}</figcaption></figure>`).join("")}</div>`;
  // bars: an inline SVG, one rect per year, the flagged ones in red; the numbers are also in a table underneath
  const W = 1000, H = 150, max = Math.max(1, ...b.data.map((d) => d.value)), bw = b.data.length ? W / b.data.length : W;
  const rects = b.data.map((d, i) => { const h = Math.round((d.value / max) * (H - 18)); return `<rect class="${d.flag ? "flag" : ""}" x="${(i * bw + bw * 0.12).toFixed(1)}" y="${H - h - 14}" width="${(bw * 0.76).toFixed(1)}" height="${Math.max(h, d.value > 0 ? 1 : 0)}"><title>${esc(d.label)}: ${esc(n(d.value))} ${esc(b.unit)}</title></rect>`; }).join("");
  const first = b.data[0]?.label ?? "", last = b.data[b.data.length - 1]?.label ?? "";
  return `<h3>${esc(b.caption)}</h3><svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${b.caption}, ${first} to ${last}, tallest bar ${n(max)} ${b.unit}${b.data.some((d) => d.flag) ? "; red bars are flagged years" : ""}`)}">${rects}<text x="0" y="${H - 1}" fill="#8d8d99" font-size="12">${esc(first)}</text><text x="${W}" y="${H - 1}" fill="#8d8d99" font-size="12" text-anchor="end">${esc(last)}</text></svg>`
    + (b.note ? `<p class="muted">${esc(b.note)}</p>` : "") + `<details><summary>the numbers</summary><div class="scroll"><table><thead><tr><th>year</th><th class="num">${esc(b.unit)}</th></tr></thead><tbody>${b.data.map((d) => `<tr><td>${esc(d.label)}${d.flag ? " (flagged)" : ""}</td><td class="num">${esc(n(d.value))}</td></tr>`).join("")}</tbody></table></div></details>`;
}

export interface ReportMeta { title: string; generated: string; headline: string[]; sourceLabel: string; notes: string[] }
/** One self-contained page: no script, no external file, no link out. Everything printed has been through `redact`. */
export function renderReport(sections: Section[], v: Verdict, meta: ReportMeta, redact: (s: string) => string = (s) => s, plain: string[] = []): string {
  const body = sections.map((s) => `<section id="${esc(s.id)}"><header><span class="tag ${s.level}">${esc(TAG[s.level])}</span><h2>${s.number}. ${esc(s.title)}</h2></header><p class="muted">${esc(s.summary)}</p>`
    + (s.rows.length ? `<div class="scroll"><table class="rows"><tbody>${s.rows.map((r) => `<tr><td><span class="tag ${r.level}">${esc(TAG[r.level])}</span></td><td>${esc(r.label)}</td><td>${esc(r.detail)}</td></tr>`).join("")}</tbody></table></div>` : "")
    + s.blocks.map(renderBlock).join("") + "</section>").join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(meta.title)}</title><style>${CSS}</style></head>
<body><div class="wrap"><h1>${esc(meta.title)}</h1><p class="muted">${esc(meta.generated)} · ${esc(meta.sourceLabel)}</p>
${meta.headline.map((h) => `<p class="muted">${esc(h)}</p>`).join("\n")}
<div class="verdict" role="status"><p><span class="tag ${v.level}">${esc(TAG[v.level])}</span> ${esc(v.line.replace(/^VERDICT: \w+ - /, ""))}</p></div>
<nav aria-label="Sections"><p class="muted">${sections.map((s) => `<a href="#${esc(s.id)}">${s.number}. ${esc(s.title)}</a> <span class="tag ${s.level}">${esc(TAG[s.level])}</span>`).join(" · ")}</p></nav>
${body}
<section id="paste"><header><h2>Plain text, to paste</h2></header><p class="muted">The same summary the terminal printed. Nothing in this page is a secret, but read it before you send it.</p><pre>${esc(plain.join("\n"))}</pre></section>
${meta.notes.length ? `<section id="how"><header><h2>How this was made</h2></header><ul class="ex">${meta.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>` : ""}
</div></body></html>
`;
  return redact(html);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// the surprises as a section, the next steps, and the doctor

export function surprisesSection(list: Surprise[]): Section {
  const rows: Row[] = list.map((s) => ({ level: s.level, label: s.title, detail: `${n(s.count)}${s.of !== undefined ? ` of ${n(s.of)}` : ""}. ${s.note}` }));
  const hit = list.filter((s) => s.level === "warn" || s.level === "fail");
  return { id: "surprises", number: 7, title: "Surprises", level: sectionLevel(rows), summary: hit.length ? `${hit.length} of ${list.length} heuristics found something: ${hit.map((s) => s.id).join(", ")}` : `${list.length} heuristics, nothing found`, rows,
    blocks: list.filter((s) => s.examples.length).map((s): Block => ({ kind: "examples", title: `${s.title}: ${n(s.count)} (up to ${MAX_EXAMPLES} examples)`, lines: s.examples })) };
}

export interface DoctorFinding { level: "fail" | "warn" | "info" | "ok"; id: string; message: string; fix?: string }
/** The doctor judges a public deployment (a key, a site address, a contact), which this report is not: a doctor FAIL becomes a WARN here, except for the database file itself. */
export function doctorRows(findings: DoctorFinding[]): Row[] {
  const dbIds = new Set(["sports-db", "data-dir"]);
  return findings.filter((f) => f.level !== "ok" || dbIds.has(f.id)).map((f): Row => ({
    level: f.level === "fail" ? (dbIds.has(f.id) ? "fail" : "warn") : f.level === "warn" ? "warn" : f.level === "ok" ? "pass" : "info",
    label: `doctor: ${f.id}`, detail: `${f.message}${f.fix ? ` -> ${f.fix}` : ""}${f.level === "fail" && !dbIds.has(f.id) ? " (the doctor calls this a failure for a public site; not a problem with the loaded league)" : ""}`,
  }));
}

export interface NextFacts { photoShare: number; arabicShare: number; wikidataShare: number; heaviest?: { division: string; top: string[] }; lightest?: { division: string; top: string[] }; disputedExample?: string; arabicExample?: string; knownGood?: string[] }
/** What to look at by hand, from what this run found (the list in section 4 of the runbook, with the names filled in). */
export const SKIPPED_BY_USER = "skipped by --skip";
export function nextSteps(sections: Section[], f: NextFacts): string[] {
  const out: string[] = [];
  for (const s of sections) if ((s.level === "fail" || s.level === "warn" || s.level === "skip") && s.summary !== SKIPPED_BY_USER) out.push(`Read section ${s.number} (${s.title}) first: it is ${levelTag(s.level)}. ${s.summary}.`);
  if (f.heaviest) out.push(`Open the top of ${f.heaviest.division}: ${f.heaviest.top.join(", ")}. Are these people you would expect? Then the top of ${f.lightest ? `${f.lightest.division} (${f.lightest.top.join(", ")})` : "the lightest division"}.`);
  if (f.disputedExample) out.push(`Open one fighter marked disputed (${f.disputedExample}): the note should say what disagrees, and the vendor's total should be the record shown.`);
  if (f.arabicExample) out.push(`Open one Arabic page (${f.arabicExample}): the layout mirrors, the record reads left to right, the corners stay red on the left.`);
  out.push("Open ten fighters you know and check record, age, division and last fight against what you remember (runbook section 4).");
  out.push("Open the Data page (/data): the credit to the vendor, the counts and the date of the last load should match section 2.");
  if (f.photoShare < 0.01 || f.arabicShare < 0.01 || f.wikidataShare < 0.01) out.push(`Photos, Arabic names and Wikidata ids are at ${(f.photoShare * 100).toFixed(1)}%, ${(f.arabicShare * 100).toFixed(1)}% and ${(f.wikidataShare * 100).toFixed(1)}%: if you have not run it yet, \`npm run vendor:enrich\` fills them (load-day step 6); run this report again after it.`);
  out.push("Run `npm run model:fit` and open the Track record page; then `npm run backup`.");
  out.push("Send the whole report (or the plain text at its end) back to Claude; it is safe to send.");
  return out;
}
