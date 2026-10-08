/**
 * Bulk import of boxer biographies from Wikidata (CC0), plus enrichment of our own fighters from it.
 *
 * What Wikidata has for boxers (measured 2026-10): ~19.6k boxers; birth date for 17.4k; place of birth 12.2k;
 * citizenship 16.4k; BoxRec ID cross-reference 10.1k; image 3.5k; height 3.5k; weight 1.5k; "student of" ~25.
 * It has NO bout records, weigh-ins or reliable trainer data, so it enriches fighters we already know from a
 * results feed; it does not replace one. The BoxRec ID is only an identifier for matching: nothing is fetched from BoxRec.
 *
 * Quantities are read through Wikidata's normalised fields (psn:), because raw values mix units: the same
 * property returned 1.74 (m), 70.5 (inches) and 173 (cm) for different fighters.
 */
import type { DatabaseSync } from "node:sqlite";
import { userAgent } from "../media/wikimedia";

const WDQS = "https://query.wikidata.org/sparql";

export interface WikidataBoxer {
  qid: string;
  name: string;
  birthDate: string | null; // only when day-precision
  birthYear: number | null;
  birthPlace: string | null;
  country: string | null;
  heightCm: number | null;
  weightKg: number | null;
  imageFile: string | null;
  boxrecId: string | null;
  residence: string | null;
  deathDate: string | null;
  teachers: string[];
}

export type Binding = Record<string, { value: string } | undefined>;

export function batchQuery(qids: string[]): string {
  return `SELECT ?b ?bLabel ?dob ?dobPrec ?pobLabel ?ctzLabel ?h ?m ?img ?boxrec ?resLabel ?dod ?teacherLabel WHERE {
  VALUES ?b { ${qids.map((q) => `wd:${q}`).join(" ")} }
  OPTIONAL { ?b p:P569/psv:P569 [ wikibase:timeValue ?dob ; wikibase:timePrecision ?dobPrec ] }
  OPTIONAL { ?b wdt:P19 ?pob }
  OPTIONAL { ?b wdt:P27 ?ctz }
  OPTIONAL { ?b p:P2048/psn:P2048/wikibase:quantityAmount ?h }
  OPTIONAL { ?b p:P2067/psn:P2067/wikibase:quantityAmount ?m }
  OPTIONAL { ?b wdt:P18 ?img }
  OPTIONAL { ?b wdt:P1967 ?boxrec }
  OPTIONAL { ?b wdt:P551 ?res }
  OPTIONAL { ?b wdt:P570 ?dod }
  OPTIONAL { ?b wdt:P1066 ?teacher }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

/**
 * Honours and cross-reference IDs live in a second query: awards are multi-valued, and joining them to the main query's
 * other multi-valued fields (teachers) would multiply rows. IBHOF boxer ID is P4474 (value like "modern/leonardray");
 * Olympedia people ID is P8286; awards are P166 with the year from the P585 qualifier.
 */
export interface WikidataAward { qid: string; label: string; year: number | null; kind: HonourKind }
export type HonourKind = "hall_of_fame" | "title" | "award";
export interface WikidataExtras {
  qid: string; ibhofId: string | null; olympediaId: string | null; awards: WikidataAward[];
  /** The Arabic label, the nickname and the English Wikipedia article title, each only when it passes `cleanArabicName`, `cleanNickname` and `cleanWikiTitle`. */
  arabicName: string | null; nickname: string | null; enwiki: string | null;
}

const ARABIC_NAME = /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF](?:[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u200C\u200D .'’\-]{0,78}[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF])?$/u;
/** An Arabic label we are willing to show as a person's name: Arabic script only (no Latin letters, no digits, no markup), 80 characters at most, spacing tidied. Anything else is left out. */
export function cleanArabicName(v: string | undefined | null): string | null {
  const s = (v ?? "").replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e]/g, " ").replace(/\s+/g, " ").trim();
  return s.length <= 80 && ARABIC_NAME.test(s) && !/[\u0660-\u0669\u06F0-\u06F9]/.test(s) ? s : null; // no digits of either Arabic kind: the site uses 0-9 and a name has none
}
const NICK_OK = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .'’"\-]{0,39}$/u; // the same rule a person's own nickname correction must pass (lib/accounts/corrections.ts)
export function cleanNickname(v: string | undefined | null): string | null {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return NICK_OK.test(s) ? s : null;
}
/** An English Wikipedia article title: one line, no brackets, braces, pipes or angle brackets (it is only ever used inside a link, percent-encoded). */
export function cleanWikiTitle(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  return s.length >= 2 && s.length <= 200 && !/[\u0000-\u001f<>\[\]{}|#?]/.test(s) ? s : null;
}

export function extrasQuery(qids: string[]): string {
  return `SELECT ?b ?hof ?oly ?ar ?nick ?enwiki ?award ?awardLabel ?awardYear WHERE {
  VALUES ?b { ${qids.map((q) => `wd:${q}`).join(" ")} }
  OPTIONAL { ?b wdt:P4474 ?hof }
  OPTIONAL { ?b wdt:P8286 ?oly }
  OPTIONAL { ?b rdfs:label ?ar . FILTER(LANG(?ar) = "ar") }
  OPTIONAL { ?b wdt:P1449 ?nick . FILTER(LANG(?nick) = "en" || LANG(?nick) = "mul" || LANG(?nick) = "") }
  OPTIONAL { ?page schema:about ?b ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enwiki }
  OPTIONAL { ?b p:P166 ?st . ?st ps:P166 ?award . OPTIONAL { ?st pq:P585 ?awardYear } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

/** "WBC World Light Heavyweight Champion" is a title, not an honour in the Hall-of-Fame sense; keep both but tell them apart. */
export function honourKind(label: string): HonourKind {
  if (/hall of fame/i.test(label)) return "hall_of_fame";
  if (/champion\b/i.test(label) || /\btitle\b/i.test(label)) return "title";
  return "award";
}

export function parseExtras(bindings: Binding[]): Map<string, WikidataExtras> {
  const out = new Map<string, WikidataExtras>();
  const seenNicks = new Map<string, Set<string>>();
  for (const b of bindings) {
    const qid = b.b?.value.split("/").pop();
    if (!qid) continue;
    const e = out.get(qid) ?? out.set(qid, { qid, ibhofId: null, olympediaId: null, awards: [], arabicName: null, nickname: null, enwiki: null }).get(qid)!;
    const hof = b.hof?.value, oly = b.oly?.value;
    if (!e.arabicName) e.arabicName = cleanArabicName(b.ar?.value);
    if (!e.enwiki) e.enwiki = cleanWikiTitle(b.enwiki?.value);
    const nick = cleanNickname(b.nick?.value);
    if (nick) { const seen = seenNicks.get(qid) ?? new Set<string>(); seen.add(nick); seenNicks.set(qid, seen); }
    if (!e.ibhofId && hof && /^[\w-]+(\/[\w-]+)*$/.test(hof)) e.ibhofId = hof;
    if (!e.olympediaId && oly && /^\d+$/.test(oly)) e.olympediaId = oly;
    const aq = b.award?.value.split("/").pop(), al = label(b, "awardLabel");
    if (aq && al) {
      const y = b.awardYear?.value.match(/^(\d{4})-/);
      const year = y ? Number(y[1]) : null;
      // the same award can come back once per qualifier row; keep one per (award, year)
      if (!e.awards.some((a) => a.qid === aq && a.year === year)) e.awards.push({ qid: aq, label: al, year, kind: honourKind(al) });
    }
  }
  // a nickname is kept only when Wikidata gives exactly one: with several there is no telling which one a fighter goes by
  for (const [qid, nicks] of seenNicks) if (nicks.size === 1) out.get(qid)!.nickname = [...nicks][0];
  for (const e of out.values()) e.awards.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.label.localeCompare(b.label));
  return out;
}

const isQid = (s: string) => /^Q\d+$/.test(s); // unresolved labels come back as the bare Q-id
const label = (b: Binding, k: string) => { const v = b[k]?.value; return v && !isQid(v) ? v : null; };
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/** Collapses the many rows a multi-valued property produces into one record per boxer, with plausibility guards. */
export function parseBindings(bindings: Binding[]): Map<string, WikidataBoxer> {
  const by = new Map<string, Binding[]>();
  for (const b of bindings) {
    const qid = b.b?.value.split("/").pop();
    if (!qid) continue;
    (by.get(qid) ?? by.set(qid, []).get(qid)!).push(b);
  }
  const out = new Map<string, WikidataBoxer>();
  for (const [qid, rows] of by) {
    const dates = new Set<string>();
    let bestPrec = 0;
    for (const r of rows) {
      const v = r.dob?.value, prec = Number(r.dobPrec?.value ?? 0);
      if (v && /^\d{4}-/.test(v) && prec >= 9) { if (prec > bestPrec) { bestPrec = prec; dates.clear(); } if (prec === bestPrec) dates.add(v.slice(0, 10)); }
    }
    const dateList = [...dates];
    const year = dateList.length ? Number(dateList[0].slice(0, 4)) : null;
    // two conflicting exact dates: refuse to pick one
    const birthDate = bestPrec >= 11 && dateList.length === 1 ? dateList[0] : null;
    const heights = rows.map((r) => Number(r.h?.value) * 100).filter((x) => x >= 120 && x <= 230).map(Math.round);
    const weights = rows.map((r) => Number(r.m?.value)).filter((x) => x >= 35 && x <= 200);
    const img = rows.map((r) => r.img?.value).find(Boolean);
    const dod = rows.map((r) => r.dod?.value).find((v) => v && /^\d{4}-/.test(v));
    out.set(qid, {
      qid, name: rows.map((r) => label(r, "bLabel")).find(Boolean) ?? qid,
      birthDate, birthYear: year,
      birthPlace: rows.map((r) => label(r, "pobLabel")).find(Boolean) ?? null,
      country: rows.map((r) => label(r, "ctzLabel")).find(Boolean) ?? null,
      heightCm: heights.length ? median(heights) : null, weightKg: weights.length ? median(weights) : null,
      imageFile: img ? decodeURIComponent(img.split("Special:FilePath/").pop() ?? "") || null : null,
      boxrecId: rows.map((r) => r.boxrec?.value).find((v) => v && /^\d+$/.test(v)) ?? null,
      residence: rows.map((r) => label(r, "resLabel")).find(Boolean) ?? null,
      deathDate: dod ? dod.slice(0, 10) : null,
      teachers: [...new Set(rows.map((r) => label(r, "teacherLabel")).filter((x): x is string => !!x))],
    });
  }
  return out;
}

const GAP_MS = Number(process.env.WIKIDATA_GAP_MS ?? 1200); // tests set this to 0
let lastCall = 0;
export async function sparql(query: string): Promise<Binding[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastCall + GAP_MS - Date.now(); // one request at a time, ~1/s: well inside WDQS limits
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(WDQS, {
      method: "POST",
      headers: { "User-Agent": userAgent(), Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query, format: "json" }),
      signal: AbortSignal.timeout(70000),
    });
    if (res.status === 429 || res.status >= 500) {
      const retry = Number(res.headers.get("retry-after") ?? 0) * 1000 || 5000 * (attempt + 1);
      await new Promise((r) => setTimeout(r, retry));
      continue;
    }
    if (!res.ok) throw new Error(`WDQS ${res.status}`);
    return ((await res.json()) as { results: { bindings: Binding[] } }).results.bindings;
  }
  throw new Error("Wikidata Query Service unavailable after retries");
}

export async function listBoxerIds(limit = Infinity, pageSize = 5000): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ids.length < limit; offset += pageSize) {
    const rows = await sparql(`SELECT ?b WHERE { ?b wdt:P106 wd:Q11338576 } ORDER BY ?b LIMIT ${Math.min(pageSize, limit - ids.length)} OFFSET ${offset}`);
    for (const r of rows) { const q = r.b?.value.split("/").pop(); if (q) ids.push(q); }
    if (rows.length < pageSize) break;
  }
  return ids;
}

export interface ImportSummary { listed: number; stored: number; batches: number; skipped: number }
export interface ImportOptions {
  limit?: number;
  batch?: number;
  extras?: boolean; // also fetch Hall of Fame / Olympedia IDs and awards (a second query per batch)
  extrasOnly?: boolean; // fetch only the extras, for boxers already staged without them (no listing, no biography query)
  maxAgeDays?: number; // boxers fetched more recently than this are skipped, which is what makes an interrupted run resumable
  force?: boolean; // ignore maxAgeDays
  log?: (m: string) => void;
}

/**
 * Stages boxers from Wikidata. Each batch is committed on its own and boxers fetched in the last `maxAgeDays` are skipped,
 * so a full run (about 165 batches, 2 requests each, roughly 7 minutes) that is interrupted simply continues where it stopped.
 * Boxers staged before the extras existed are filled in with `extrasOnly`, without re-fetching their biographies.
 */
export async function importWikidata(db: DatabaseSync, opts: ImportOptions = {}): Promise<ImportSummary> {
  const { limit = Infinity, batch = 120, extras = true, extrasOnly = false, maxAgeDays = 30, force = false, log = () => {} } = opts;
  const setExtras = db.prepare("UPDATE wikidata_boxers SET ibhof_id = ?, olympedia_id = ?, awards = ?, ar_label = ?, nickname = ?, enwiki = ?, extras_at = ?, labels_at = ? WHERE qid = ?");
  const empty = (qid: string): WikidataExtras => ({ qid, ibhofId: null, olympediaId: null, awards: [], arabicName: null, nickname: null, enwiki: null });
  const store = (x: WikidataExtras, now: string) => setExtras.run(x.ibhofId, x.olympediaId, JSON.stringify(x.awards), x.arabicName, x.nickname, x.enwiki, now, now, x.qid);

  if (extrasOnly) {
    // boxers staged before the extras existed, and boxers staged before the Arabic names, nicknames and article titles were read (labels_at)
    const todo = (db.prepare("SELECT qid FROM wikidata_boxers WHERE extras_at IS NULL OR labels_at IS NULL ORDER BY qid LIMIT ?").all(Number.isFinite(limit) ? limit : -1) as { qid: string }[]).map((r) => r.qid);
    log(`${todo.length} staged boxers need their extras (honours, Arabic names, nicknames, article titles)`);
    let stored = 0, batches = 0;
    for (let i = 0; i < todo.length; i += batch) {
      const chunk = todo.slice(i, i + batch);
      const more = parseExtras(await sparql(extrasQuery(chunk)));
      const now = new Date().toISOString();
      db.exec("BEGIN");
      for (const q of chunk) { store(more.get(q) ?? empty(q), now); stored++; }
      db.exec("COMMIT");
      batches++;
      log(`extras batch ${batches}: ${Math.min(i + batch, todo.length)}/${todo.length}`);
    }
    return { listed: todo.length, stored, batches, skipped: 0 };
  }

  const listed = await listBoxerIds(limit);
  log(`listed ${listed.length} boxer ids`);
  const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
  const fresh = force ? new Set<string>() : new Set((db.prepare("SELECT qid FROM wikidata_boxers WHERE fetched_at > ?").all(cutoff) as { qid: string }[]).map((r) => r.qid));
  const ids = listed.filter((q) => !fresh.has(q));
  const skipped = listed.length - ids.length;
  if (skipped) log(`skipping ${skipped} boxers fetched in the last ${maxAgeDays} days (use --force to refetch)`);
  const up = db.prepare(`INSERT INTO wikidata_boxers (qid, name, birth_date, birth_year, birth_place, country, height_cm, weight_kg, image_file, boxrec_id, residence, death_date, teachers, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(qid) DO UPDATE SET name=excluded.name, birth_date=excluded.birth_date, birth_year=excluded.birth_year, birth_place=excluded.birth_place,
    country=excluded.country, height_cm=excluded.height_cm, weight_kg=excluded.weight_kg, image_file=excluded.image_file, boxrec_id=excluded.boxrec_id, residence=excluded.residence,
    death_date=excluded.death_date, teachers=excluded.teachers, fetched_at=excluded.fetched_at`);
  let stored = 0, batches = 0;
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    const parsed = parseBindings(await sparql(batchQuery(chunk)));
    const more = extras ? parseExtras(await sparql(extrasQuery(chunk))) : new Map<string, WikidataExtras>();
    const now = new Date().toISOString();
    db.exec("BEGIN");
    for (const b of parsed.values()) {
      up.run(b.qid, b.name, b.birthDate, b.birthYear, b.birthPlace, b.country, b.heightCm, b.weightKg, b.imageFile, b.boxrecId, b.residence, b.deathDate, JSON.stringify(b.teachers), now);
      // a boxer with no row in the extras answer simply has none: that is a result, so it is recorded as checked
      if (extras) store(more.get(b.qid) ?? empty(b.qid), now);
      stored++;
    }
    db.exec("COMMIT");
    batches++;
    log(`batch ${batches}: ${Math.min(i + batch, ids.length)}/${ids.length}`);
  }
  return { listed: listed.length, stored, batches, skipped };
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[łđðøı]/g, (c) => ({ ł: "l", đ: "d", ð: "d", ø: "o", ı: "i" })[c as "ł"]).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export interface EnrichSummary { linked: number; byBoxrecId: number; byNameYear: number; byNameCountry: number; ambiguous: number; names: { added: number; kept: number }; filled: { nickname: number; wikipedia: number; birthYear: number; birthDate: number; birthPlace: number; residence: number; boxrecId: number }; honours: { boxers: number; rows: number; hallOfFame: number; olympedia: number } }

/**
 * Links our fighters to Wikidata entities and fills ONLY fields we don't already have (a licensed feed always wins).
 * Match order: (1) BoxRec ID, if our feed supplies one; (2) normalised name + birth year when exactly one candidate exists; (3) a name unique on both sides in the same country, with a birth year and a career that fit.
 */
export function enrichFromWikidata(db: DatabaseSync): EnrichSummary {
  const staged = db.prepare("SELECT * FROM wikidata_boxers").all() as Record<string, unknown>[];
  const byBoxrec = new Map<string, Record<string, unknown>>();
  const byNameYear = new Map<string, Record<string, unknown>[]>();
  for (const r of staged) {
    if (r.boxrec_id) byBoxrec.set(r.boxrec_id as string, r);
    if (r.birth_year) { const k = `${norm(r.name as string)}|${r.birth_year}`; (byNameYear.get(k) ?? byNameYear.set(k, []).get(k)!).push(r); }
  }
  const mine = db.prepare("SELECT id, name, birth_year, boxrec_id, birth_date, birth_place, residence FROM boxers WHERE wikidata_id IS NULL").all() as
    { id: number; name: string; birth_year: number | null; boxrec_id: string | null; birth_date: string | null; birth_place: string | null; residence: string | null }[];
  const claimed = new Set<string>();
  const upd = db.prepare(`UPDATE boxers SET wikidata_id = ?, boxrec_id = COALESCE(boxrec_id, ?), birth_year = COALESCE(birth_year, ?), birth_date = COALESCE(birth_date, ?), birth_place = COALESCE(birth_place, ?), residence = COALESCE(residence, ?) WHERE id = ?`);
  const mark = db.prepare("UPDATE wikidata_boxers SET matched_boxer_id = ?, match_method = ? WHERE qid = ?");
  const s: EnrichSummary = { linked: 0, byBoxrecId: 0, byNameYear: 0, byNameCountry: 0, ambiguous: 0, names: { added: 0, kept: 0 }, filled: { nickname: 0, wikipedia: 0, birthYear: 0, birthDate: 0, birthPlace: 0, residence: 0, boxrecId: 0 }, honours: { boxers: 0, rows: 0, hallOfFame: 0, olympedia: 0 } };
  db.exec("BEGIN");
  for (const b of mine) {
    let hit: Record<string, unknown> | undefined, method = "";
    if (b.boxrec_id && byBoxrec.has(b.boxrec_id)) { hit = byBoxrec.get(b.boxrec_id); method = "boxrec_id"; }
    else {
      const c = byNameYear.get(`${norm(b.name)}|${b.birth_year}`) ?? [];
      if (c.length === 1) { hit = c[0]; method = "name+birth_year"; } else if (c.length > 1) s.ambiguous++;
    }
    if (!hit || claimed.has(hit.qid as string)) continue;
    claimed.add(hit.qid as string);
    // If our feed has a birth year and Wikidata disagrees by more than one, don't link: the match is wrong. (A fighter whose birth year is unknown has nothing to disagree with.)
    if (hit.birth_year && b.birth_year !== null && Math.abs((hit.birth_year as number) - b.birth_year) > 1) continue;
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    upd.run(hit.qid as string, b.boxrec_id ? null : str(hit.boxrec_id), typeof hit.birth_year === "number" ? hit.birth_year : null, str(hit.birth_date), str(hit.birth_place), str(hit.residence), b.id);
    mark.run(b.id, method, hit.qid as string);
    s.linked++; if (method === "boxrec_id") s.byBoxrecId++; else s.byNameYear++;
    if (b.birth_year === null && typeof hit.birth_year === "number") s.filled.birthYear++; // an unknown birth year is filled from the match, never overwritten
    if (!b.birth_date && hit.birth_date) s.filled.birthDate++;
    if (!b.birth_place && hit.birth_place) s.filled.birthPlace++;
    if (!b.residence && hit.residence) s.filled.residence++;
    if (!b.boxrec_id && hit.boxrec_id) s.filled.boxrecId++;
  }
  // Third pass, for the fighters the first two could not place (most of a real league: no BoxRec number, and a birth year for about half): a name that belongs to exactly one unlinked
  // fighter of ours and to exactly one staged entity, in the same country (the four home nations are one with the United Kingdom), with a birth year that does not disagree and a career
  // that fits the life (first fight at 14 or later, and before the entity's death). Two people with one name in one country are left alone: nothing is guessed.
  const nation = (c: unknown) => { const n = typeof c === "string" ? norm(c) : ""; return /^(england|scotland|wales|northern ireland|great britain)$/.test(n) ? "united kingdom" : n; };
  const era = db.prepare("SELECT b.id AS id, MIN(CAST(substr(e.date, 1, 4) AS INTEGER)) AS first FROM boxers b JOIN bouts x ON x.red_id = b.id OR x.blue_id = b.id JOIN events e ON e.id = x.event_id WHERE b.wikidata_id IS NULL GROUP BY b.id").all() as { id: number; first: number }[];
  const firstYear = new Map(era.map((r) => [r.id, r.first] as const));
  const left = db.prepare("SELECT id, name, birth_year, country, boxrec_id, birth_date, birth_place, residence FROM boxers WHERE wikidata_id IS NULL").all() as
    { id: number; name: string; birth_year: number | null; country: string; boxrec_id: string | null; birth_date: string | null; birth_place: string | null; residence: string | null }[];
  const stagedLeft = staged.filter((r) => !claimed.has(r.qid as string) && !r.matched_boxer_id);
  const wdByName = new Map<string, Record<string, unknown>[]>(), meByName = new Map<string, typeof left>();
  for (const r of stagedLeft) { const k = norm(r.name as string); (wdByName.get(k) ?? wdByName.set(k, []).get(k)!).push(r); }
  for (const b of left) { const k = norm(b.name); (meByName.get(k) ?? meByName.set(k, []).get(k)!).push(b); }
  for (const [k, ws] of wdByName) {
    const ms = meByName.get(k);
    if (ws.length !== 1 || !ms || ms.length !== 1) continue;
    const hit = ws[0], b = ms[0];
    if (!hit.country || nation(hit.country) !== nation(b.country)) continue;
    if (typeof hit.birth_year === "number") {
      if (b.birth_year !== null && Math.abs(hit.birth_year - b.birth_year) > 1) continue;
      const first = firstYear.get(b.id);
      if (first !== undefined && first < hit.birth_year + 14) continue;
    }
    const died = typeof hit.death_date === "string" ? parseInt(hit.death_date.slice(0, 4), 10) : NaN;
    const last = firstYear.get(b.id);
    if (Number.isFinite(died) && last !== undefined && last > died) continue;
    claimed.add(hit.qid as string);
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    upd.run(hit.qid as string, b.boxrec_id ? null : str(hit.boxrec_id), typeof hit.birth_year === "number" ? hit.birth_year : null, str(hit.birth_date), str(hit.birth_place), str(hit.residence), b.id);
    mark.run(b.id, "name+country", hit.qid as string);
    s.linked++; s.byNameCountry++;
    if (b.birth_year === null && typeof hit.birth_year === "number") s.filled.birthYear++;
    if (!b.birth_date && hit.birth_date) s.filled.birthDate++;
    if (!b.birth_place && hit.birth_place) s.filled.birthPlace++;
    if (!b.residence && hit.residence) s.filled.residence++;
    if (!b.boxrec_id && hit.boxrec_id) s.filled.boxrecId++;
  }
  db.exec("COMMIT");
  applyHonours(db, s);
  applyLabels(db, s);
  return s;
}

/**
 * Arabic names, nicknames and article titles, for fighters already linked to a Wikidata entity (so only ever a verified match). Each fills a blank and nothing else:
 *  - an Arabic name is stored as the translation of the fighter's name with source `wikidata` and not reviewed; a translation already there (a person's, a machine's) is kept;
 *  - a nickname is set only where the fighter has none (a feed's or a person's nickname is never replaced);
 *  - an article title is set only where there is none (the page links to it; no text is copied).
 * Re-running changes nothing that is already filled.
 */
function applyLabels(db: DatabaseSync, s: EnrichSummary) {
  const rows = db.prepare(`SELECT w.matched_boxer_id AS boxerId, b.name, w.ar_label, w.nickname, w.enwiki FROM wikidata_boxers w JOIN boxers b ON b.id = w.matched_boxer_id
    WHERE w.matched_boxer_id IS NOT NULL AND (w.ar_label IS NOT NULL OR w.nickname IS NOT NULL OR w.enwiki IS NOT NULL)`).all() as { boxerId: number; name: string; ar_label: string | null; nickname: string | null; enwiki: string | null }[];
  const has = db.prepare("SELECT 1 x FROM name_translations WHERE en = ? AND locale = 'ar'");
  const put = db.prepare("INSERT INTO name_translations (en, locale, text, source, reviewed) VALUES (?, 'ar', ?, 'wikidata', 0)");
  const nick = db.prepare("UPDATE boxers SET nickname = ? WHERE id = ? AND (nickname IS NULL OR nickname = '')");
  const wiki = db.prepare("UPDATE boxers SET wikipedia_title = ? WHERE id = ? AND (wikipedia_title IS NULL OR wikipedia_title = '')");
  db.exec("BEGIN");
  for (const r of rows) {
    const arabic = cleanArabicName(r.ar_label), nickname = cleanNickname(r.nickname), title = cleanWikiTitle(r.enwiki); // checked again: a staged cell is not trusted
    if (arabic) { if (has.get(r.name)) s.names.kept++; else { put.run(r.name, arabic); s.names.added++; } }
    if (nickname) s.filled.nickname += Number(nick.run(nickname, r.boxerId).changes);
    if (title) s.filled.wikipedia += Number(wiki.run(title, r.boxerId).changes);
  }
  db.exec("COMMIT");
}

/**
 * Copies Hall-of-Fame and Olympedia IDs and the award list from staged Wikidata rows onto every linked fighter, including
 * ones linked on an earlier run. Wikidata is the only author of rows with source 'wikidata', so they are replaced wholesale
 * each time (an award removed upstream disappears); honours from any other source are never touched. IDs fill blanks only.
 */
function applyHonours(db: DatabaseSync, s: EnrichSummary) {
  const rows = db.prepare("SELECT qid, matched_boxer_id AS boxerId, ibhof_id, olympedia_id, awards FROM wikidata_boxers WHERE matched_boxer_id IS NOT NULL").all() as
    { qid: string; boxerId: number; ibhof_id: string | null; olympedia_id: string | null; awards: string | null }[];
  const ids = db.prepare("UPDATE boxers SET ibhof_id = COALESCE(ibhof_id, ?), olympedia_id = COALESCE(olympedia_id, ?) WHERE id = ?");
  const clear = db.prepare("DELETE FROM honours WHERE boxer_id = ? AND source = 'wikidata'");
  const add = db.prepare("INSERT OR IGNORE INTO honours (boxer_id, kind, label, year, source, source_ref) VALUES (?,?,?,?,'wikidata',?)");
  db.exec("BEGIN");
  for (const r of rows) {
    ids.run(r.ibhof_id, r.olympedia_id, r.boxerId);
    clear.run(r.boxerId);
    let awards: WikidataAward[] = [];
    try { awards = r.awards ? (JSON.parse(r.awards) as WikidataAward[]) : []; } catch { /* a corrupt staging cell yields no honours */ }
    for (const a of awards) { add.run(r.boxerId, a.kind, a.label, a.year, a.qid); s.honours.rows++; }
    if (awards.length) s.honours.boxers++;
    if (r.ibhof_id) s.honours.hallOfFame++;
    if (r.olympedia_id) s.honours.olympedia++;
  }
  db.exec("COMMIT");
}
