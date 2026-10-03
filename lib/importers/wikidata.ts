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

type Binding = Record<string, { value: string } | undefined>;

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

let lastCall = 0;
async function sparql(query: string): Promise<Binding[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastCall + 1200 - Date.now(); // one request at a time, ~1/s: well inside WDQS limits
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

export interface ImportSummary { listed: number; stored: number; batches: number }

export async function importWikidata(db: DatabaseSync, opts: { limit?: number; batch?: number; log?: (m: string) => void } = {}): Promise<ImportSummary> {
  const { limit = Infinity, batch = 120, log = () => {} } = opts;
  const ids = await listBoxerIds(limit);
  log(`listed ${ids.length} boxer ids`);
  const up = db.prepare(`INSERT INTO wikidata_boxers (qid, name, birth_date, birth_year, birth_place, country, height_cm, weight_kg, image_file, boxrec_id, residence, death_date, teachers, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(qid) DO UPDATE SET name=excluded.name, birth_date=excluded.birth_date, birth_year=excluded.birth_year, birth_place=excluded.birth_place,
    country=excluded.country, height_cm=excluded.height_cm, weight_kg=excluded.weight_kg, image_file=excluded.image_file, boxrec_id=excluded.boxrec_id, residence=excluded.residence,
    death_date=excluded.death_date, teachers=excluded.teachers, fetched_at=excluded.fetched_at`);
  let stored = 0, batches = 0;
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    const parsed = parseBindings(await sparql(batchQuery(chunk)));
    const now = new Date().toISOString();
    db.exec("BEGIN");
    for (const b of parsed.values()) { up.run(b.qid, b.name, b.birthDate, b.birthYear, b.birthPlace, b.country, b.heightCm, b.weightKg, b.imageFile, b.boxrecId, b.residence, b.deathDate, JSON.stringify(b.teachers), now); stored++; }
    db.exec("COMMIT");
    batches++;
    log(`batch ${batches}: ${Math.min(i + batch, ids.length)}/${ids.length}`);
  }
  return { listed: ids.length, stored, batches };
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export interface EnrichSummary { linked: number; byBoxrecId: number; byNameYear: number; ambiguous: number; filled: { birthDate: number; birthPlace: number; residence: number; boxrecId: number } }

/**
 * Links our fighters to Wikidata entities and fills ONLY fields we don't already have (a licensed feed always wins).
 * Match order: (1) BoxRec ID, if our feed supplies one; (2) normalised name + birth year when exactly one candidate exists.
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
    { id: number; name: string; birth_year: number; boxrec_id: string | null; birth_date: string | null; birth_place: string | null; residence: string | null }[];
  const claimed = new Set<string>();
  const upd = db.prepare(`UPDATE boxers SET wikidata_id = ?, boxrec_id = COALESCE(boxrec_id, ?), birth_date = COALESCE(birth_date, ?), birth_place = COALESCE(birth_place, ?), residence = COALESCE(residence, ?) WHERE id = ?`);
  const mark = db.prepare("UPDATE wikidata_boxers SET matched_boxer_id = ?, match_method = ? WHERE qid = ?");
  const s: EnrichSummary = { linked: 0, byBoxrecId: 0, byNameYear: 0, ambiguous: 0, filled: { birthDate: 0, birthPlace: 0, residence: 0, boxrecId: 0 } };
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
    // If our feed has an exact birth date and Wikidata disagrees on the year, don't link: the match is wrong.
    if (hit.birth_year && Math.abs((hit.birth_year as number) - b.birth_year) > 1) continue;
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    upd.run(hit.qid as string, b.boxrec_id ? null : str(hit.boxrec_id), str(hit.birth_date), str(hit.birth_place), str(hit.residence), b.id);
    mark.run(b.id, method, hit.qid as string);
    s.linked++; if (method === "boxrec_id") s.byBoxrecId++; else s.byNameYear++;
    if (!b.birth_date && hit.birth_date) s.filled.birthDate++;
    if (!b.birth_place && hit.birth_place) s.filled.birthPlace++;
    if (!b.residence && hit.residence) s.filled.residence++;
    if (!b.boxrec_id && hit.boxrec_id) s.filled.boxrecId++;
  }
  db.exec("COMMIT");
  return s;
}
