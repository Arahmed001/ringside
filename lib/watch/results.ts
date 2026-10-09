import type { DatabaseSync } from "node:sqlite";
import { fetchPage, plain, splitRows } from "../importers/wikipedia-champions";
import type { ApplyOutcome, Change, WatchContext, WatchResult, WatchSource } from "./types";

/**
 * Fight results from the "Professional boxing record" table on a fighter's Wikipedia article, for fights we hold with no result.
 * A result is the commission's and the sanctioning body's to state, so everything found here is proposed with the table row as the quote and marked
 * "single unofficial source"; nothing reaches a page until an admin approves it (lib/watch/decide.ts).
 */
export const RESULTS_SOURCE_ID = "wikipedia:results";

export interface RecordRow { result: "win" | "loss" | "draw" | "nc"; opponent: string; method: string; round: number | null; scheduled: number | null; date: string; quote: string }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase());
/** "1980-09-19", "19 September 1980" and "September 19, 1980" to ISO; null when it cannot be read. */
export function isoDate(raw: string): string | null {
  const s = plain(raw).replace(/ /g, " ");
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})/);
  if (m) { const i = monthIndex(m[2]); if (i > -1) return `${m[3]}-${String(i + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = s.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) { const i = monthIndex(m[1]); if (i > -1) return `${m[3]}-${String(i + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  return null;
}

const METHOD: Record<string, string> = { KO: "KO", TKO: "TKO", UD: "UD", MD: "MD", SD: "SD", DQ: "DQ", RTD: "RTD", TD: "TD", NC: "NC", DRAW: "DRAW", D: "DRAW" };
const cleanCell = (c: string) => plain(c.replace(/^[|!]/, "").replace(/\{\{\s*(?:yes2|no2|draw2|partial2|maybe2|nc2)\s*\|([^{}|]*)\}\}/gi, "$1").replace(/^\s*(?:[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s|]+)\s*)+\|(?!\|)/i, ""));

/** Rows of the professional record table. The columns are found from the header, so a table without the "No." or "Record" column still reads; a table that lacks the opponent, result, type, round or date column reads as nothing. */
export function parseRecordTable(wikitext: string): RecordRow[] {
  const h = wikitext.search(/==\s*Professional (?:boxing )?record\s*==/i);
  if (h < 0) return [];
  const start = wikitext.indexOf("{|", h);
  if (start < 0) return [];
  const end = wikitext.indexOf("\n|}", start);
  const rows = splitRows(wikitext.slice(start, end < 0 ? undefined : end));
  const header = rows.find((r) => r[0]?.startsWith("!"));
  if (!header) return [];
  const names = header.map((c) => cleanCell(c).toLowerCase());
  const col = (re: RegExp) => names.findIndex((n) => re.test(n));
  const ix = { result: col(/^res/), opponent: col(/^opponent/), type: col(/^type/), round: col(/^round/), date: col(/^date/) };
  if (Object.values(ix).some((i) => i < 0)) return [];
  const out: RecordRow[] = [];
  for (const r of rows) {
    if (r[0]?.startsWith("!") || r.length < names.length - 1) continue;
    const cells = r.map(cleanCell);
    const res = (cells[ix.result] ?? "").toLowerCase();
    const result = /^win/.test(res) ? "win" : /^loss/.test(res) ? "loss" : /^draw/.test(res) ? "draw" : /^(nc|no contest)/.test(res) ? "nc" : null;
    const date = isoDate(r[ix.date] ?? "");
    const type = (cells[ix.type] ?? "").toUpperCase().replace(/[^A-Z]/g, "");
    const method = type.startsWith("TKO") ? "TKO" : (METHOD[type] ?? (result === "draw" ? "DRAW" : ""));
    if (!result || !date || !method || !cells[ix.opponent]) continue;
    const rm = (cells[ix.round] ?? "").match(/^(\d+)(?::\d+)?\s*(?:\((\d+)\))?/);
    const round = rm ? Number(rm[1]) : null, scheduled = rm?.[2] ? Number(rm[2]) : rm ? Number(rm[1]) : null;
    out.push({ result, opponent: cells[ix.opponent], method, round, scheduled, date, quote: cells.join(" | ") });
  }
  return out;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const sameName = (a: string, b: string) => { const x = fold(a), y = fold(b); return !!x && x === y; };
const dayShift = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

interface Bout { id: number; date: string; rounds: number; red_id: number; blue_id: number; redName: string; blueName: string; card: string }
const OPEN = "(b.method IS NULL OR b.method = '') AND b.winner_id IS NULL AND b.status IS NOT 'cancelled'";

/** Fighters with a Wikipedia article and a past fight we hold with no result, most recent card first. */
export function fightersToLook(main: DatabaseSync, limit?: number): { id: number; name: string; title: string }[] {
  const sql = `SELECT x.id, x.name, x.wikipedia_title title FROM boxers x
    WHERE x.wikipedia_title IS NOT NULL AND x.wikipedia_title <> '' AND EXISTS (SELECT 1 FROM bouts b JOIN events e ON e.id = b.event_id WHERE (b.red_id = x.id OR b.blue_id = x.id) AND ${OPEN} AND e.date < date('now'))
    ORDER BY (SELECT MAX(e.date) FROM bouts b JOIN events e ON e.id = b.event_id WHERE (b.red_id = x.id OR b.blue_id = x.id) AND ${OPEN}) DESC, x.id${limit ? ` LIMIT ${Math.floor(limit)}` : ""}`;
  return main.prepare(sql).all() as { id: number; name: string; title: string }[];
}

/** One article's table against the fights we hold for that fighter. A row proposes a result only when the opponent's name and the date both agree with a fight that has no result. */
export function compareFighter(main: DatabaseSync, f: { id: number; name: string; title: string }, rows: RecordRow[], revision: string): { changes: Change[]; unmatched: number; looked: number[] } {
  const bouts = main.prepare(`SELECT b.id, e.date, b.rounds, b.red_id, b.blue_id, r.name redName, u.name blueName, e.name card FROM bouts b JOIN events e ON e.id = b.event_id JOIN boxers r ON r.id = b.red_id JOIN boxers u ON u.id = b.blue_id
    WHERE (b.red_id = ? OR b.blue_id = ?) AND ${OPEN} AND e.date < date('now')`).all(f.id, f.id) as unknown as Bout[];
  const changes: Change[] = [];
  let unmatched = 0;
  for (const b of bouts) {
    const oppId = b.red_id === f.id ? b.blue_id : b.red_id, oppName = b.red_id === f.id ? b.blueName : b.redName;
    const hits = rows.filter((r) => sameName(r.opponent, oppName) && [dayShift(b.date, -1), b.date, dayShift(b.date, 1)].includes(r.date));
    if (hits.length !== 1) { unmatched++; continue; }
    const r = hits[0];
    const winnerId = r.result === "win" ? f.id : r.result === "loss" ? oppId : null;
    const winnerName = r.result === "win" ? f.name : r.result === "loss" ? oppName : null;
    const distance = r.method === "UD" || r.method === "MD" || r.method === "SD" || r.method === "DRAW";
    const endRound = distance ? (r.scheduled ?? b.rounds) : r.round;
    const notes = r.scheduled && b.rounds && r.scheduled !== b.rounds ? `scheduled rounds differ: we hold ${b.rounds}, the article ${r.scheduled}` : undefined;
    changes.push({
      kind: "result_set", targetKey: `result|${b.id}|`,
      label: `${b.redName} v ${b.blueName}, ${b.date}: ${winnerName ? `${winnerName} won` : r.result === "nc" ? "no contest" : "draw"} by ${r.method}${endRound ? `, round ${endRound}` : ""} (${f.name}'s Wikipedia record)`,
      old: { method: null, winner: null, endRound: null },
      new: { method: r.method, winner: winnerName, endRound: endRound ?? null },
      evidence: { page: f.title.replace(/ /g, "_"), revision, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(f.title.replace(/ /g, "_"))}#Professional_boxing_record`, quote: r.quote, corroboration: "single unofficial source", ...(notes ? { notes } : {}), apply: { boutId: b.id, winnerId, method: r.method, endRound: endRound ?? null } },
    });
  }
  return { changes, unmatched, looked: bouts.map((b) => b.id) };
}

export const resultsSource: WatchSource = {
  id: RESULTS_SOURCE_ID,
  label: "Wikipedia boxing-record tables (results of fights held with no result)",
  kind: "results",
  terms: "Text CC BY-SA 4.0 (credit Wikipedia, link the article); read through the MediaWiki API with a contact header, cached, one request at a time. A single unofficial source: shown to the approver as such.",
  enabled: true,
  async run(ctx: WatchContext): Promise<WatchResult> {
    const res: WatchResult = { changes: [], scope: [], refused: [], compared: 0 };
    const list = fightersToLook(ctx.main, ctx.limit);
    for (const f of list) {
      let page;
      try { page = await fetchPage(f.title, { ...ctx.fetch, log: ctx.log }); } catch (e) { res.refused.push({ scope: f.name, reason: `could not read the article: ${(e as Error).message}` }); continue; }
      const rows = parseRecordTable(page.wikitext);
      if (!rows.length) { res.refused.push({ scope: f.name, reason: "no readable professional record table in the article" }); continue; }
      const { changes, looked } = compareFighter(ctx.main, f, rows, page.revision);
      res.changes.push(...changes);
      res.scope.push(...looked.map((id) => `result|${id}|`));
      res.compared += rows.length;
    }
    // a pending proposal is retired only for a fight looked at this run (a limited run must not retire the others)
    return res;
  },
  apply: (main, p) => applyResult(main, p),
};

/** Writes one approved result. It refuses (`stale`) when the fight has meanwhile got a result from the vendor, so an approval never overwrites a value nobody looked at. */
export function applyResult(main: DatabaseSync, p: { kind: string; targetKey: string; old: unknown; new: unknown; evidence: unknown }): ApplyOutcome {
  const a = ((p.evidence ?? {}) as { apply?: { boutId?: number; winnerId?: number | null; method?: string; endRound?: number | null } }).apply;
  if (p.kind !== "result_set" || !a?.boutId || !a.method || !Object.values(METHOD).includes(a.method)) return { ok: false, error: "bad_proposal" };
  const row = main.prepare("SELECT method, winner_id, status FROM bouts WHERE id = ?").get(a.boutId) as { method: string | null; winner_id: number | null; status: string | null } | undefined;
  if (!row) return { ok: false, error: "gone" };
  if (row.status === "cancelled" || (row.method && row.method !== "") || row.winner_id !== null) return { ok: false, error: "stale" };
  if (a.winnerId != null && !main.prepare("SELECT 1 x FROM bouts WHERE id = ? AND (red_id = ? OR blue_id = ?)").get(a.boutId, a.winnerId, a.winnerId)) return { ok: false, error: "bad_proposal" };
  main.prepare("UPDATE bouts SET method = ?, winner_id = ?, end_round = ? WHERE id = ?").run(a.method, a.winnerId ?? null, a.endRound ?? null, a.boutId);
  return { ok: true, changed: true, ratings: true };
}
