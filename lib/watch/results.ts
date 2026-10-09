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
    // a draw or a no contest has no winner whatever the type column says ("SD" on a split draw): the method is the result
    const method = result === "draw" ? "DRAW" : result === "nc" ? "NC" : type.startsWith("TKO") ? "TKO" : (METHOD[type] ?? "");
    if (!result || !date || !method || !cells[ix.opponent]) continue;
    const rm = (cells[ix.round] ?? "").match(/^(\d+)(?::\d+)?\s*(?:\((\d+)\))?/);
    const round = rm ? Number(rm[1]) : null, scheduled = rm?.[2] ? Number(rm[2]) : rm ? Number(rm[1]) : null;
    out.push({ result, opponent: cells[ix.opponent], method, round, scheduled, date, quote: cells.join(" | ") });
  }
  return out;
}

const STOPPAGES = new Set(["KO", "TKO", "RTD", "TD", "TD-U"]);
/** Does the vendor's outcome word agree with the method found? A stoppage called KO by one and TKO by the other agrees; a draw is the vendor's D. */
export function vendorAgrees(vendor: string, method: string): boolean {
  const v = vendor.toUpperCase();
  if (v === method || (v === "PTS" && method === "UD")) return true;
  if (STOPPAGES.has(v) && STOPPAGES.has(method)) return true;
  return method === "DRAW" && v === "D";
}
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const sameName = (a: string, b: string) => { const x = fold(a), y = fold(b); return !!x && x === y; };
const dayShift = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

interface Bout { id: number; extId: string; redExt: string; blueExt: string; date: string; rounds: number; red_id: number; blue_id: number; redName: string; blueName: string; card: string }
const OPEN = "(b.method IS NULL OR b.method = '') AND b.winner_id IS NULL AND b.status IS NOT 'cancelled'";

/** Fighters with a Wikipedia article and a past fight we hold with no result, most recent card first. */
export function fightersToLook(main: DatabaseSync, limit?: number): { id: number; name: string; title: string }[] {
  const sql = `SELECT x.id, x.name, x.wikipedia_title title FROM boxers x
    WHERE x.wikipedia_title IS NOT NULL AND x.wikipedia_title <> '' AND EXISTS (SELECT 1 FROM bouts b JOIN events e ON e.id = b.event_id WHERE (b.red_id = x.id OR b.blue_id = x.id) AND ${OPEN} AND e.date < date('now'))
    ORDER BY (SELECT MAX(e.date) FROM bouts b JOIN events e ON e.id = b.event_id WHERE (b.red_id = x.id OR b.blue_id = x.id) AND ${OPEN}) DESC, x.id${limit ? ` LIMIT ${Math.floor(limit)}` : ""}`;
  return main.prepare(sql).all() as { id: number; name: string; title: string }[];
}

/** One article's table against the fights we hold for that fighter. A row proposes a result only when the opponent's name and the date both agree with a fight that has no result. */
export function compareFighter(main: DatabaseSync, f: { id: number; name: string; title: string }, rows: RecordRow[], revision: string, vendorCheck?: WatchContext["vendorCheck"]): { changes: Change[]; unmatched: number; looked: string[] } {
  const bouts = main.prepare(`SELECT b.id, b.external_id extId, r.external_id redExt, u.external_id blueExt, e.date, b.rounds, b.red_id, b.blue_id, r.name redName, u.name blueName, e.name card FROM bouts b JOIN events e ON e.id = b.event_id JOIN boxers r ON r.id = b.red_id JOIN boxers u ON u.id = b.blue_id
    WHERE (b.red_id = ? OR b.blue_id = ?) AND ${OPEN} AND e.date < date('now')`).all(f.id, f.id) as unknown as Bout[];
  const changes: Change[] = [];
  let unmatched = 0;
  for (const b of bouts) {
    const oppId = b.red_id === f.id ? b.blue_id : b.red_id, oppName = b.red_id === f.id ? b.blueName : b.redName;
    const hits = rows.filter((r) => sameName(r.opponent, oppName) && [dayShift(b.date, -1), b.date, dayShift(b.date, 1)].includes(r.date));
    if (hits.length !== 1) { unmatched++; continue; }
    const r = hits[0];
    const winnerExt = r.result === "win" ? (b.red_id === f.id ? b.redExt : b.blueExt) : r.result === "loss" ? (b.red_id === f.id ? b.blueExt : b.redExt) : null;
    void oppId;
    const winnerName = r.result === "win" ? f.name : r.result === "loss" ? oppName : null;
    const distance = r.method === "UD" || r.method === "MD" || r.method === "SD" || r.method === "DRAW";
    // a decision whose scheduled distance the article gives differently from ours cannot be written: its end round is the distance, and one of the two is wrong
    if (distance && r.scheduled && b.rounds && r.scheduled !== b.rounds) { unmatched++; continue; }
    const endRound = distance ? (r.scheduled ?? b.rounds) : r.round;
    const notes = r.scheduled && b.rounds && r.scheduled !== b.rounds ? `scheduled rounds differ: we hold ${b.rounds}, the article ${r.scheduled}` : undefined;
    // against the vendor's own copy: the same way it ended (kind result_set), nothing there (result_set_alone: Wikipedia is the only source), or a different way (result_set_conflict)
    const said = vendorCheck?.(b.extId);
    const kind = said?.outcome ? (vendorAgrees(said.outcome, r.method) ? "result_set" : "result_set_conflict") : "result_set_alone";
    changes.push({
      kind, targetKey: `result|${b.extId}|`,
      label: `${b.redName} v ${b.blueName}, ${b.date}: ${winnerName ? `${winnerName} won` : r.result === "nc" ? "no contest" : "draw"} by ${r.method}${endRound ? `, round ${endRound}` : ""} (${f.name}'s Wikipedia record)`,
      old: { method: null, winner: null, endRound: null },
      new: { method: r.method, winner: winnerName, endRound: endRound ?? null },
      evidence: { page: f.title.replace(/ /g, "_"), revision, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(f.title.replace(/ /g, "_"))}#Professional_boxing_record`, quote: r.quote, corroboration: "single unofficial source", ...(said?.outcome ? { vendor: { outcome: said.outcome, status: said.status } } : {}), ...(notes ? { notes } : {}), apply: { boutExternalId: b.extId, winnerExternalId: winnerExt, method: r.method, endRound: endRound ?? null } },
    });
  }
  // every past fight of this fighter was looked at, with or without a result now: a pending proposal for one that has since got a result is retired
  const looked = (main.prepare("SELECT b.external_id x FROM bouts b JOIN events e ON e.id = b.event_id WHERE (b.red_id = ? OR b.blue_id = ?) AND e.date < date('now')").all(f.id, f.id) as { x: string }[]).map((r) => r.x);
  return { changes, unmatched, looked };
}

const main_ = (db: DatabaseSync) => db.prepare("SELECT method, winner_id, status FROM bouts WHERE external_id = ?");

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
      const { changes, looked } = compareFighter(ctx.main, f, rows, page.revision, ctx.vendorCheck);
      res.changes.push(...changes);
      res.scope.push(...looked.map((x) => `result|${x}|`));
      res.compared += rows.length;
    }
    // two articles (the two fighters') that tell one fight differently are believed by neither: nothing is proposed for it
    const byKey = new Map<string, Change[]>();
    for (const c of res.changes) (byKey.get(c.targetKey) ?? byKey.set(c.targetKey, []).get(c.targetKey)!).push(c);
    const conflicting = new Set([...byKey].filter(([, cs]) => new Set(cs.map((c) => JSON.stringify(c.new))).size > 1).map(([k]) => k));
    for (const k of conflicting) res.refused.push({ scope: byKey.get(k)![0].label.split(" (")[0], reason: "the two fighters' articles disagree on this result; nothing proposed" });
    res.changes = res.changes.filter((c) => !conflicting.has(c.targetKey));
    // a pending proposal is retired only for a fight looked at this run (a limited run must not retire the others)
    // a pending proposal for a fight that has a result now (the vendor filled it in, a reload brought it back) or that is gone is retired even when its fighters were not read
    const state = main_(ctx.main);
    res.retire = (key) => { const ext = key.split("|")[1] ?? ""; const row = state.get(ext) as { method: string | null; winner_id: number | null; status: string | null } | undefined; return !row || !!(row.method && row.method !== "") || row.winner_id !== null || row.status === "cancelled"; };
    return res;
  },
  apply: (main, p) => applyResult(main, p),
};

/** Writes one approved result. It refuses (`stale`) when the fight has meanwhile got a result from the vendor, so an approval never overwrites a value nobody looked at. */
export function applyResult(main: DatabaseSync, p: { kind: string; targetKey: string; old: unknown; new: unknown; evidence: unknown }): ApplyOutcome {
  const a = ((p.evidence ?? {}) as { apply?: { boutExternalId?: string; winnerExternalId?: string | null; method?: string; endRound?: number | null } }).apply;
  if (!/^result_set(_alone|_conflict)?$/.test(p.kind) || !a?.boutExternalId || !a.method || !Object.values(METHOD).includes(a.method)) return { ok: false, error: "bad_proposal" };
  // the fight and the winner are found by the vendor's own ids, which a reload does not change (row numbers do)
  const row = main.prepare("SELECT id, method, winner_id, status, red_id, blue_id FROM bouts WHERE external_id = ?").get(a.boutExternalId) as { id: number; method: string | null; winner_id: number | null; status: string | null; red_id: number; blue_id: number } | undefined;
  if (!row) return { ok: false, error: "gone" };
  if (row.status === "cancelled" || (row.method && row.method !== "") || row.winner_id !== null) return { ok: false, error: "stale" };
  let winnerId: number | null = null;
  if (a.winnerExternalId) {
    const w = main.prepare("SELECT id FROM boxers WHERE external_id = ?").get(a.winnerExternalId) as { id: number } | undefined;
    if (!w || (w.id !== row.red_id && w.id !== row.blue_id)) return { ok: false, error: "bad_proposal" };
    winnerId = w.id;
  }
  main.prepare("UPDATE bouts SET method = ?, winner_id = ?, end_round = ? WHERE id = ?").run(a.method, winnerId, a.endRound ?? null, row.id);
  markExcess(main, [row.red_id, row.blue_id]);
  return { ok: true, changed: true, ratings: true };
}

/**
 * A fighter whose held fights now come to more wins, losses or draws than the vendor's own career total is marked disputed, as the loader marks them (the page then shows the vendor's
 * total and says the two disagree, and the audit's "a record the fights contradict is marked disputed" holds). A vendor total of nothing beside a professional fight is no total.
 * Returns how many fighters were newly marked.
 */
export function markExcess(main: DatabaseSync, fighterIds: number[]): number {
  const count = main.prepare(`SELECT SUM(CASE WHEN b.winner_id = ? THEN 1 ELSE 0 END) w, SUM(CASE WHEN b.winner_id IS NOT NULL AND b.winner_id <> ? THEN 1 ELSE 0 END) l, SUM(CASE WHEN b.method = 'DRAW' THEN 1 ELSE 0 END) d
    FROM bouts b WHERE (b.red_id = ? OR b.blue_id = ?) AND COALESCE(b.status, '') <> 'cancelled' AND b.method IS NOT NULL`);
  const boxer = main.prepare("SELECT vendor_wins vw, vendor_losses vl, vendor_draws vd, COALESCE(record_disputed, 0) disp FROM boxers WHERE id = ?");
  const longFight = main.prepare("SELECT 1 x FROM bouts q WHERE (q.red_id = ? OR q.blue_id = ?) AND COALESCE(q.status, '') <> 'cancelled' AND COALESCE(q.rounds, 10) > 3 LIMIT 1");
  const mark = main.prepare("UPDATE boxers SET record_disputed = 1 WHERE id = ?");
  let n = 0;
  for (const id of new Set(fighterIds)) {
    const b = boxer.get(id) as { vw: number | null; vl: number | null; vd: number | null; disp: number } | undefined;
    if (!b || b.vw === null || b.disp === 1) continue;
    if (b.vw + (b.vl ?? 0) + (b.vd ?? 0) === 0 && longFight.get(id, id)) continue;
    const c = count.get(id, id, id, id) as { w: number | null; l: number | null; d: number | null };
    if ((c.w ?? 0) > b.vw || (c.l ?? 0) > (b.vl ?? 0) || (c.d ?? 0) > (b.vd ?? 0)) { mark.run(id); n++; }
  }
  return n;
}

/**
 * Puts every approved result back after the database was loaded again (a reload replaces the sports database; the approvals live in the accounts database). Safe to run twice and on a
 * database that has since got a result from the vendor: such a fight is left as the vendor has it (`stale`). Returns what happened to each approved proposal.
 */
export function replayApproved(main: DatabaseSync, acc: DatabaseSync): { applied: number; alreadyThere: number; skipped: number; marked: number } {
  const rows = acc.prepare("SELECT kind, target_key, old_json, new_json, evidence_json FROM proposals WHERE source = ? AND status = 'approved' AND kind LIKE 'result_set%'").all(RESULTS_SOURCE_ID) as { kind: string; target_key: string; old_json: string | null; new_json: string | null; evidence_json: string | null }[];
  const out = { applied: 0, alreadyThere: 0, skipped: 0, marked: 0 };
  const fighters: number[] = [];
  const find = main.prepare("SELECT id, red_id, blue_id, method, winner_id FROM bouts WHERE external_id = ?");
  for (const r of rows) {
    const ev = JSON.parse(r.evidence_json ?? "{}") as { apply?: { boutExternalId?: string; method?: string; winnerExternalId?: string | null } };
    const bout = ev.apply?.boutExternalId ? (find.get(ev.apply.boutExternalId) as { id: number; red_id: number; blue_id: number; method: string | null; winner_id: number | null } | undefined) : undefined;
    const res = applyResult(main, { kind: r.kind, targetKey: r.target_key, old: JSON.parse(r.old_json ?? "null"), new: JSON.parse(r.new_json ?? "null"), evidence: ev });
    if (bout) fighters.push(bout.red_id, bout.blue_id);
    if (res.ok) out.applied++; else if (res.error === "stale" && bout?.method === ev.apply?.method) out.alreadyThere++; else out.skipped++;
  }
  out.marked = markExcess(main, fighters);
  return out;
}
