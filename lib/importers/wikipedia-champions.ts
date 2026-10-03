/**
 * Title reigns from Wikipedia's "List of <body> world champions" pages (text CC BY-SA 4.0: credit "Wikipedia (CC BY-SA 4.0)" and link the page).
 *
 * What a row gives us: who held a belt, from which date to which date, who they beat for it ("def."), how many defences, and a short note when the
 * reign ended in a vacancy or a stripping. It is facts from a table, never prose: the note is kept short and the page is linked for the rest.
 * Wikipedia is a crowd-edited reference, not a primary source: every row carries the page and revision it came from, and a reign is linked to one of
 * our fighters only through the fighter's Wikidata ID (the article the list links to), never by guessing at a name.
 *
 * Dates are partial more often than not ("11 Jan – 28 Dec 1991": the start year is the end's; "Mar 1995": no day). They are stored as ISO prefixes
 * ("1991-01-11", "1995-03", "1990") and never padded to a day that was not stated.
 */
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { normalizeDivision } from "../divisions";
import { userAgent } from "../media/wikimedia";

export interface ChampionSource { org: string; page: string; sex: "male" | "female" }
/** The men's lists of the four major bodies. Women's lists are added by name once their page titles are confirmed (`--page`). */
export const CHAMPION_SOURCES: ChampionSource[] = [
  { org: "WBA", page: "List_of_WBA_world_champions", sex: "male" },
  { org: "WBC", page: "List_of_WBC_world_champions", sex: "male" },
  { org: "IBF", page: "List_of_IBF_world_champions", sex: "male" },
  { org: "WBO", page: "List_of_WBO_world_champions", sex: "male" },
];

export interface ParsedReign {
  org: string;
  division: string;
  /** a sub-table of the division's page ("Super champion", "Regular champion", "Interim"), lower-cased; null for the main line */
  category: string | null;
  /** the row's position in its table (the key: the page's own numbers have typos, e.g. two reigns both numbered 4) */
  seq: number;
  /** the number the page gives the reign (null on a row that has none) */
  n: number | null;
  name: string;
  /** the article the name links to: the key to a Wikidata ID */
  wikiTitle: string | null;
  /** the label the page puts beside the name when the holder was more than the ordinary champion ("Super champion", "Unified champion", "Undisputed champion"); null otherwise */
  status: string | null;
  /** ISO prefix: "1991-01-11", "1995-03" or "1990" */
  start: string | null;
  /** null while the reign runs (`current`) or when it could not be read */
  end: string | null;
  current: boolean;
  wonVs: string | null;
  wonVsTitle: string | null;
  /** what the "def." cell said when it was not an opponent ("awarded inaugural title", "vacant") */
  wonNote: string | null;
  defences: number | null;
  /** why it ended, from the note row under the reign (short, citations removed) */
  endNote: string | null;
}

export type ParseNotes = { rowsSkipped: number; divisionUnknown: number; datesUnread: number; examples?: string[] };

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

interface Part { day: number | null; month: string | null; year: number | null }
function datePart(raw: string): Part | null {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return null;
  const us = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/); // "Sep 7, 1998", "Feb 26" (the year is the end's)
  if (us && MONTHS[us[1].slice(0, 3).toLowerCase()]) return { day: Number(us[2]), month: MONTHS[us[1].slice(0, 3).toLowerCase()], year: us[3] ? Number(us[3]) : null };
  if (/^\d{1,2}$/.test(t)) return { day: Number(t), month: null, year: null }; // "5 – 12 Jun 1990": the day only, the rest is the end's
  const m = t.match(/^(?:(\d{1,2})\s+)?(?:([A-Za-z]{3,9})\.?\s*)?(?:(\d{4}))?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const month = m[2] ? MONTHS[m[2].slice(0, 3).toLowerCase()] ?? null : null;
  if (m[2] && !month) return null;
  if (m[1] && !month && !m[3]) return null; // a bare number is not a date
  return { day: m[1] ? Number(m[1]) : null, month, year: m[3] ? Number(m[3]) : null };
}
const iso = (y: number, mo: string | null, d: number | null) => (mo ? (d ? `${y}-${mo}-${String(d).padStart(2, "0")}` : `${y}-${mo}`) : `${y}`);

/**
 * "6 May 1989 – 11 Jan 1991", "11 Jan – 28 Dec 1991" (the start's year is the end's), "30 May – 1 Aug 1987", "17 Dec 1994 – Mar 1995", "9 May 2026 – present",
 * "17 May 1990 – 1991". Returns null for anything else (a reign whose dates cannot be read is not stored with invented ones).
 */
export function parseReignDates(raw: string): { start: string | null; end: string | null; current: boolean } | null {
  const text = raw.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\[\[[^\]|]*\|?([^\]]*)\]\]/g, "$1").trim();
  const sides = text.split(/\s*[–—-]\s*/).filter((s) => s.length);
  if (sides.length === 1 && /^\d/.test(sides[0]) === false) return null;
  const [a, b] = sides;
  if (!a) return null;
  const current = !!b && /^(present|incumbent|current|now)$/i.test(b.trim());
  const start = datePart(a);
  const end = current || !b ? null : datePart(b);
  if (!start) return null;
  if (!current && (!b || !end)) return null; // a reign has an end or is current: a lone date is not one
  let sy = start.year, sm = start.month;
  if (sy === null && end?.year) sy = end.year; // "11 Jan – 28 Dec 1991"
  if (sy === null) return null;
  if (sm === null && start.day !== null) sm = end?.month ?? null; // "5 – 12 Jun 1990"
  if (start.day !== null && sm === null) return null;
  const real = (y: number, mo: string | null, d: number | null) => !mo || !d || d <= new Date(Date.UTC(y, Number(mo), 0)).getUTCDate();
  if (!real(sy, sm, start.day) || (end && !real(end.year ?? sy, end.month, end.day))) return null; // 31 Feb
  const startIso = iso(sy, sm, start.day);
  let endIso: string | null = null;
  if (end) { const ey = end.year ?? sy; endIso = iso(ey, end.month, end.day); }
  if (endIso && startIso.slice(0, endIso.length) > endIso && startIso.length === endIso.length) return null; // an end before its start is a misreading, not a reign
  return { start: startIso, end: endIso, current };
}

const stripAttrs = (cell: string) => cell.replace(/^\s*(?:[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s|]+)\s*)+\|(?!\|)/i, "");

/** Wikitext to the plain words it shows: references, comments and templates removed, links reduced to their text. */
export function plain(w: string): string {
  let s = w.replace(/<!--[\s\S]*?-->/g, "").replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  for (let i = 0; i < 3; i++) s = s.replace(/\{\{\s*small\s*\|([^{}]*)\}\}/gi, "$1").replace(/\{\{[^{}]*\}\}/g, "");
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/'''?/g, "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

const linkOf = (w: string): { text: string; title: string } | null => {
  const m = w.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/);
  return m ? { title: m[1].trim().replace(/_/g, " "), text: (m[2] ?? m[1]).trim() } : null;
};

/** Open braces and open <ref> tags in a stretch of wikitext: a line that starts with | inside one of them continues the cell instead of starting another (citation templates run over several lines). */
const openDepth = (t: string) => (t.match(/\{\{/g)?.length ?? 0) - (t.match(/\}\}/g)?.length ?? 0) + (t.match(/<ref(?![^>]*\/>)[^>]*>/gi)?.length ?? 0) - (t.match(/<\/ref>/gi)?.length ?? 0);

function splitRows(table: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] | null = null;
  for (const line of table.split("\n")) {
    const inside = cur && cur.length ? openDepth(cur[cur.length - 1]) > 0 : false;
    if (!inside && /^\|-/.test(line)) { if (cur) rows.push(cur); cur = []; continue; }
    if (!cur) continue;
    if (!inside && /^[|!]/.test(line) && !/^\|\}/.test(line)) {
      const body = line.slice(1);
      const parts = line[0] === "!" ? body.split("!!") : body.split("||");
      for (const p of parts) cur.push(line[0] === "!" ? "!" + p : p);
    } else if (cur.length) cur[cur.length - 1] += "\n" + line;
  }
  if (cur) rows.push(cur);
  return rows.filter((r) => r.length);
}

/** One list page's wikitext to reigns. Divisions are the level-2 headings; level-3 headings inside a division name a sub-table (Super, Regular, Interim). */
export function parseChampionList(wikitext: string, org: string, notes: ParseNotes = { rowsSkipped: 0, divisionUnknown: 0, datesUnread: 0 }): ParsedReign[] {
  const out: ParsedReign[] = [];
  const lines = wikitext.split("\n");
  let division: string | null = null, category: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(={2,3})\s*([^=].*?)\s*\1\s*$/);
    if (h) {
      const text = plain(h[2]);
      if (h[1] === "==") {
        category = null;
        const d = normalizeDivision(text);
        if (d) division = d;
        else if (/weight$/i.test(text)) { division = text.replace(/^./, (c) => c.toUpperCase()); notes.divisionUnknown++; } // a division we do not list yet (Bridgerweight): kept under the page's name, counted
        else division = null;
      } else category = text.toLowerCase();
      continue;
    }
    if (!/^\{\|/.test(lines[i]) || !division) continue;
    let j = i; const buf: string[] = [];
    while (j < lines.length && !/^\|\}/.test(lines[j])) buf.push(lines[j++]);
    i = j;
    const table = buf.join("\n");
    if (!/!\s*Reign/i.test(table)) continue; // the colour key and other tables are not reign lists
    let last: ParsedReign | null = null;
    let seq = 0;
    for (const row of splitRows(table)) {
      const cells = row.map((c) => stripAttrs(c.replace(/^!/, "").trimEnd()));
      const raw = row.map((c) => c.replace(/^!/, ""));
      if (row.length === 1 && /colspan/i.test(raw[0])) { // the note row: why the previous reign ended
        if (last) { const t = plain(stripAttrs(raw[0])); if (t) last.endNote = t.slice(0, 300); }
        continue;
      }
      if (row.length < 3) continue;
      // most rows lead with their number; some (a second row under a number that spans rows) do not: then the dates are in the second cell
      let off = 0, n: number | null = parseInt(plain(cells[0]), 10);
      if (!Number.isFinite(n)) {
        if (row.length === 3 && parseReignDates(plain(cells[1]).replace(/^style="[^"]*"\s*\|?/i, ""))) { off = -1; n = null; }
        else { if (!/^(No\.?|#)?$/i.test(plain(cells[0]))) { notes.rowsSkipped++; notes.examples?.push(`${org} ${division}: ${raw.join(" | ").slice(0, 160)}`); } continue; }
      }
      const nameParts = cells[1 + off].split(/<br\s*\/?>/i);
      const link = linkOf(nameParts[0]);
      // "Wladimir Klitschko &ndash; {{small|Super champion}}": the part after the dash is the label of the reign, not the name
      const dash = nameParts[0].search(/&ndash;|&mdash;|\s[–—]\s/);
      const nameWikitext = dash > -1 ? nameParts[0].slice(0, dash) : nameParts[0];
      const status = dash > -1 ? plain(nameParts[0].slice(dash).replace(/^(&ndash;|&mdash;|\s[–—]\s)/, "")).slice(0, 60) || null : null;
      const name = plain(nameWikitext).replace(/\s*\(\d+\)\s*$/, "").trim();
      const rest = nameParts.slice(1).join(" ");
      const dates = parseReignDates(plain(cells[2 + off]).replace(/^style="[^"]*"\s*\|?/i, ""));
      if (!name || !dates) { if (!dates) notes.examples?.push(`${org} ${division} #${n} ${name}: ${plain(cells[2 + off])}`); notes.datesUnread += dates ? 0 : 1; if (!name) notes.rowsSkipped++; if (!dates) { last = null; } continue; }
      let wonVs: string | null = null, wonVsTitle: string | null = null, wonNote: string | null = null;
      const pr = plain(rest).replace(/^\(|\)$/g, "").trim();
      if (pr) {
        const def = pr.match(/^def\.?\s+(.+)$/i);
        if (def) { const l = linkOf(rest); wonVs = def[1].trim(); wonVsTitle = l?.title ?? null; } else wonNote = pr.slice(0, 120);
      }
      const defences = cells[3 + off] === undefined ? null : (() => { const d = parseInt(plain(cells[3 + off]), 10); return Number.isFinite(d) ? d : null; })();
      last = { org, division, category, seq: ++seq, n, name, wikiTitle: link?.title ?? null, status, start: dates.start, end: dates.end, current: dates.current, wonVs, wonVsTitle, wonNote, defences, endNote: null };
      out.push(last);
    }
  }
  return out;
}

// ---- fetching: polite, cached, resumable -------------------------------------------------------------------------------------------------------

const API = process.env.WIKIPEDIA_API_URL || "https://en.wikipedia.org/w/api.php"; // the override is for the tests, which serve a local copy
export interface FetchOptions { cacheDir?: string; gapMs?: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; log?: (m: string) => void; refresh?: boolean }

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function call<T>(params: Record<string, string>, o: FetchOptions): Promise<T> {
  const f = o.fetchImpl ?? fetch, sleep = o.sleep ?? pause;
  const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", redirects: "1", ...params })}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (o.gapMs) await sleep(o.gapMs);
    const res = await f(url, { headers: { "User-Agent": userAgent(), "Accept-Encoding": "gzip" }, signal: AbortSignal.timeout(60_000) });
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(120_000, (Number(res.headers.get("retry-after")) || 10 * 2 ** attempt) * 1000);
      o.log?.(`Wikipedia said ${res.status}; waiting ${Math.round(wait / 1000)} s`);
      await sleep(wait); continue;
    }
    if (!res.ok) throw new Error(`Wikipedia ${res.status} for ${params.action ?? ""}`);
    return (await res.json()) as T;
  }
  throw new Error("Wikipedia kept refusing (rate limit): run again later, from a machine with its own address; what was fetched is cached");
}

export interface PageText { page: string; revision: string; wikitext: string }
export async function fetchPage(page: string, o: FetchOptions = {}): Promise<PageText> {
  const file = o.cacheDir ? path.join(o.cacheDir, `${page.replace(/[^A-Za-z0-9_-]/g, "_")}.json`) : undefined;
  if (file && !o.refresh) { try { return JSON.parse(fs.readFileSync(file, "utf8")) as PageText; } catch { /* fetch it */ } }
  const j = await call<{ parse?: { title: string; revid: number; wikitext: string } }>({ action: "parse", page, prop: "wikitext|revid" }, o);
  if (!j.parse?.wikitext) throw new Error(`Wikipedia has no page ${page}`);
  const r: PageText = { page: j.parse.title.replace(/ /g, "_"), revision: String(j.parse.revid), wikitext: j.parse.wikitext };
  if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(r)); fs.renameSync(tmp, file); }
  return r;
}

/** Article titles to Wikidata IDs, 50 per request (the article's own `wikibase_item`; redirects are followed). Titles with no item are absent. */
export async function resolveQids(titles: string[], o: FetchOptions = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(titles)];
  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50);
    const j = await call<{ query?: { pages?: { title: string; pageprops?: { wikibase_item?: string }; missing?: boolean }[]; normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[] } }>(
      { action: "query", prop: "pageprops", ppprop: "wikibase_item", titles: batch.join("|") }, o);
    const byTitle = new Map((j.query?.pages ?? []).filter((p) => p.pageprops?.wikibase_item).map((p) => [p.title, p.pageprops!.wikibase_item!]));
    const hop = (t: string) => { let x = t; for (const n of j.query?.normalized ?? []) if (n.from === x) x = n.to; for (const r of j.query?.redirects ?? []) if (r.from === x) x = r.to; return x; };
    for (const t of batch) { const q = byTitle.get(hop(t)); if (q) out.set(t, q); }
  }
  return out;
}

// ---- storing -----------------------------------------------------------------------------------------------------------------------------------

/** The table's SQL, shared with lib/db.ts so the app and the importer agree on it. */
export const REIGN_SCHEMA = `CREATE TABLE IF NOT EXISTS title_reigns (
    id INTEGER PRIMARY KEY, org TEXT NOT NULL, division TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL, n INTEGER, name TEXT NOT NULL, status TEXT,
    wiki_title TEXT, wikidata_id TEXT, boxer_id INTEGER, start_date TEXT, end_date TEXT, current INTEGER NOT NULL DEFAULT 0,
    won_vs TEXT, won_vs_wikidata_id TEXT, won_note TEXT, defences INTEGER, end_note TEXT, source TEXT NOT NULL, revision TEXT, fetched_at TEXT,
    UNIQUE (source, division, category, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_reigns_boxer ON title_reigns(boxer_id);
  CREATE INDEX IF NOT EXISTS idx_reigns_div ON title_reigns(org, division);`;

export function ensureReignTable(db: DatabaseSync) { db.exec(REIGN_SCHEMA); }

export interface ImportSummary { pages: number; reigns: number; skipped: number; qidsResolved: number; linked: number; notes: ParseNotes }

/** Fetches the lists, replaces each page's rows (re-running never duplicates; a row removed upstream disappears), then links reigns to our fighters. */
export async function importChampions(db: DatabaseSync, o: FetchOptions & { sources?: ChampionSource[]; now?: string } = {}): Promise<ImportSummary> {
  ensureReignTable(db);
  const notes: ParseNotes = { rowsSkipped: 0, divisionUnknown: 0, datesUnread: 0 };
  const sources = o.sources ?? CHAMPION_SOURCES;
  const parsed: { src: ChampionSource; page: PageText; reigns: ParsedReign[] }[] = [];
  for (const src of sources) {
    const page = await fetchPage(src.page, o);
    const reigns = parseChampionList(page.wikitext, src.org, notes);
    o.log?.(`${src.org}: ${reigns.length} reigns from revision ${page.revision}`);
    parsed.push({ src, page, reigns });
  }
  const titles = parsed.flatMap((p) => p.reigns.flatMap((r) => [r.wikiTitle, r.wonVsTitle].filter((t): t is string => !!t)));
  const qids = await resolveQids(titles, o);
  const now = o.now ?? new Date().toISOString();
  const del = db.prepare("DELETE FROM title_reigns WHERE source = ?");
  const ins = db.prepare(`INSERT INTO title_reigns (org, division, category, seq, n, name, status, wiki_title, wikidata_id, start_date, end_date, current, won_vs, won_vs_wikidata_id, won_note, defences, end_note, source, revision, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let reigns = 0;
  db.exec("BEGIN");
  try {
    for (const { page, reigns: rs } of parsed) {
      del.run(page.page);
      for (const r of rs) {
        ins.run(r.org, r.division, r.category ?? "", r.seq, r.n, r.name, r.status, r.wikiTitle, r.wikiTitle ? qids.get(r.wikiTitle) ?? null : null, r.start, r.end, r.current ? 1 : 0, r.wonVs,
          r.wonVsTitle ? qids.get(r.wonVsTitle) ?? null : null, r.wonNote, r.defences, r.endNote, page.page, page.revision, now);
        reigns++;
      }
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return { pages: parsed.length, reigns, skipped: notes.rowsSkipped + notes.datesUnread, qidsResolved: qids.size, linked: linkReigns(db), notes };
}

/** Links each reign to our fighter through the Wikidata ID, and only when exactly one of our fighters carries it. Returns how many reigns are linked. */
export function linkReigns(db: DatabaseSync): number {
  ensureReignTable(db);
  db.exec(`UPDATE title_reigns SET boxer_id = NULL`);
  const hasStaging = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wikidata_boxers'").get() as unknown) !== undefined;
  if (!hasStaging) return 0;
  db.exec(`UPDATE title_reigns SET boxer_id = (
      SELECT w.matched_boxer_id FROM wikidata_boxers w WHERE w.qid = title_reigns.wikidata_id AND w.matched_boxer_id IS NOT NULL
        AND (SELECT COUNT(*) FROM wikidata_boxers w2 WHERE w2.matched_boxer_id = w.matched_boxer_id) = 1)
    WHERE wikidata_id IS NOT NULL`);
  return (db.prepare("SELECT COUNT(*) c FROM title_reigns WHERE boxer_id IS NOT NULL").get() as { c: number }).c;
}
