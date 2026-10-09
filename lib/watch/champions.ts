import type { DatabaseSync } from "node:sqlite";
import { linkReigns, readChampionLists, type ChampionLists, type ParsedReign } from "../importers/wikipedia-champions";
import type { Change, WatchContext, WatchResult, WatchSource } from "./types";

/**
 * The watcher for Wikipedia's lists of world champions. It reads the lists exactly as the importer does, compares them with the reigns we hold, and returns the
 * differences; it never writes to `title_reigns`.
 *
 * A reign's identity cannot be the page's own row number (one row inserted upstream shifts every later number and would look like hundreds of changes). It is
 * (body, division, sub-table, who, start): "who" is the Wikidata ID of the holder when the list's link resolves to one, else the name as written. A second reign
 * with the same identity (two spells on the same day) gets a counter. A reign whose start date is corrected upstream therefore shows as one removed and one
 * added, which the approver sees side by side; pairing them up is left out on purpose, so that nothing is guessed to be "the same reign".
 */
export const CHAMPIONS_SOURCE_ID = "wikipedia:champions";

const FIELDS = ["name", "status", "start", "end", "current", "wonVs", "defences", "endNote"] as const;
type Snapshot = { key: string; org: string; division: string; row: Record<(typeof FIELDS)[number], string | number | boolean | null>; page: string; revision: string | null; rowId?: number; cols?: Record<string, string | number | null> };

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const nul = (v: unknown) => (v === undefined || v === "" ? null : (v as string | number | boolean | null));

function keyed(rows: Omit<Snapshot, "key">[], who: (r: Omit<Snapshot, "key">, i: number) => string, cat: (i: number) => string): Snapshot[] {
  const count = new Map<string, number>();
  return rows.map((r, i) => {
    const base = `reign|${r.org}|${r.division}|${cat(i)}|${who(r, i)}|${r.row.start ?? ""}`;
    const n = (count.get(base) ?? 0) + 1; count.set(base, n);
    return { ...r, key: n > 1 ? `${base}#${n}` : base };
  });
}

function fromLive(db: DatabaseSync, page: string): Snapshot[] {
  const rows = db.prepare("SELECT * FROM title_reigns WHERE source = ? ORDER BY seq").all(page) as Record<string, unknown>[];
  const base = rows.map((r) => ({ org: r.org as string, division: r.division as string, row: { name: nul(r.name), status: nul(r.status), start: nul(r.start_date), end: nul(r.end_date), current: !!r.current, wonVs: nul(r.won_vs), defences: nul(r.defences), endNote: nul(r.end_note) } as Snapshot["row"], page, revision: nul(r.revision) as string | null, rowId: r.id as number }));
  return keyed(base, (_, i) => String(rows[i].wikidata_id ?? norm(rows[i].name as string)), (i) => String(rows[i].category ?? ""));
}

function fromFresh(reigns: ParsedReign[], page: string, revision: string, qids: Map<string, string>): Snapshot[] {
  const q = (t: string | null) => (t ? qids.get(t) ?? null : null);
  const base = reigns.map((r) => ({
    org: r.org, division: r.division, page, revision,
    row: { name: nul(r.name), status: nul(r.status), start: nul(r.start), end: nul(r.end), current: r.current, wonVs: nul(r.wonVs), defences: nul(r.defences), endNote: nul(r.endNote) } as Snapshot["row"],
    // everything the stored row holds, so that approving the change needs nothing but the proposal
    cols: { org: r.org, division: r.division, category: r.category ?? "", seq: r.seq, n: r.n, name: r.name, status: r.status, wiki_title: r.wikiTitle, wikidata_id: q(r.wikiTitle), start_date: r.start, end_date: r.end, current: r.current ? 1 : 0, won_vs: r.wonVs, won_vs_wikidata_id: q(r.wonVsTitle), won_note: r.wonNote, defences: r.defences, end_note: r.endNote, source: page, revision, fetched_at: null } as Snapshot["cols"],
  }));
  return keyed(base, (_, i) => String((reigns[i].wikiTitle && qids.get(reigns[i].wikiTitle!)) ?? norm(reigns[i].name)), (i) => reigns[i].category ?? "");
}

const describe = (s: Snapshot) => `${s.org} ${s.division}: ${s.row.name}, from ${s.row.start ?? "a date not stated"}${s.row.current ? " (current)" : s.row.end ? ` to ${s.row.end}` : ""}`;

/** The differences between the reigns we hold for one page and the page as it reads now. Pure: no network, no writes. */
export function diffPage(live: Snapshot[], fresh: Snapshot[]): Change[] {
  const out: Change[] = [];
  const liveBy = new Map(live.map((s) => [s.key, s])), freshBy = new Map(fresh.map((s) => [s.key, s]));
  for (const f of fresh) {
    const l = liveBy.get(f.key);
    const evidence = { page: f.page, revision: f.revision, seen: describe(f) };
    if (!l) { out.push({ kind: "reign_added", targetKey: f.key, label: describe(f), old: null, new: f.row, evidence: { ...evidence, apply: f.cols } }); continue; }
    const changed = FIELDS.filter((k) => l.row[k] !== f.row[k]);
    if (changed.length) out.push({ kind: "reign_changed", targetKey: f.key, label: `${describe(f)}: ${changed.join(", ")}`, old: Object.fromEntries(changed.map((k) => [k, l.row[k]])), new: Object.fromEntries(changed.map((k) => [k, f.row[k]])), evidence: { ...evidence, held: describe(l), apply: f.cols } });
  }
  for (const l of live) if (!freshBy.has(l.key)) out.push({ kind: "reign_removed", targetKey: l.key, label: describe(l), old: l.row, new: null, evidence: { page: l.page, revision: l.revision, note: "no longer on the page as read now" } });
  return out;
}

/** Compares already-read lists with the database (split from `run` so it can be tested on saved pages). */
export function compareLists(main: DatabaseSync, lists: ChampionLists, floodShare = 0.05, minFlood = 10): WatchResult {
  const res: WatchResult = { changes: [], scope: [], refused: [], compared: 0 };
  for (const { src, page, reigns } of lists.parsed) {
    const scope = `reign|${src.org}|`;
    const live = fromLive(main, page.page);
    const fresh = fromFresh(reigns, page.page, page.revision, lists.qids);
    if (!live.length) { res.refused.push({ scope: src.org, reason: "nothing held yet for this list: run the importer once (champions:import); there is nothing to approve over" }); continue; }
    if (!fresh.length) { res.refused.push({ scope: src.org, reason: "the page read as empty: layout change, a failed fetch or a blanked page; nothing proposed" }); continue; }
    const diffs = diffPage(live, fresh);
    const share = diffs.length / Math.max(live.length, fresh.length);
    if (diffs.length >= minFlood && share > floodShare) { res.refused.push({ scope: src.org, reason: `${diffs.length} changes in ${Math.max(live.length, fresh.length)} rows (${Math.round(share * 100)}%): the page changed shape or was vandalised; the parser or the page needs a look before anything is proposed` }); continue; }
    res.compared += fresh.length;
    res.scope.push(scope);
    res.changes.push(...diffs);
  }
  return res;
}

export const championsSource: WatchSource = {
  id: CHAMPIONS_SOURCE_ID,
  label: "Wikipedia lists of world champions (WBA, WBC, IBF, WBO)",
  kind: "titles",
  terms: "Text CC BY-SA 4.0 (credit Wikipedia, link the page); read through the MediaWiki API with a contact header, cached, one request at a time.",
  enabled: true,
  async run(ctx: WatchContext): Promise<WatchResult> {
    const lists = await readChampionLists({ ...ctx.fetch, log: ctx.log, sources: ctx.championSources });
    return compareLists(ctx.main, lists, ctx.floodShare);
  },
  apply: (main, p) => applyReignChange(main, p),
};

// ---- applying an approved change ---------------------------------------------------------------------------------------------------------------

const COLUMN_OF: Record<(typeof FIELDS)[number], string> = { name: "name", status: "status", start: "start_date", end: "end_date", current: "current", wonVs: "won_vs", defences: "defences", endNote: "end_note" };
export type ApplyResult = { ok: true; changed: boolean } | { ok: false; error: "stale" | "gone" | "bad_proposal" };

/**
 * Writes one approved change to `title_reigns`. Only an admin's approval reaches this (lib/watch/decide.ts). It is safe to run twice, and it refuses a change that no longer
 * fits what is held (`stale`: the reigns changed since the proposal was made, for example by a re-import), because approving a change to something that has moved
 * on would write a value nobody looked at. Fighters are linked again afterwards, since a holder's Wikidata ID may be new.
 */
export function applyReignChange(main: DatabaseSync, p: { kind: string; targetKey: string; old: unknown; new: unknown; evidence: unknown }): ApplyResult {
  const ev = (p.evidence ?? {}) as { page?: string; apply?: Record<string, string | number | null> };
  if (!ev.page) return { ok: false, error: "bad_proposal" };
  const live = fromLive(main, ev.page).find((s) => s.key === p.targetKey);
  const same = (row: Snapshot["row"] | undefined, want: Record<string, unknown> | null, only?: readonly string[]) =>
    !!row && !!want && (only ?? FIELDS).every((k) => (row as Record<string, unknown>)[k] === (want as Record<string, unknown>)[k]);
  main.exec("BEGIN");
  try {
    let changed = false;
    if (p.kind === "reign_added") {
      if (live) { if (!same(live.row, p.new as Snapshot["row"])) { main.exec("ROLLBACK"); return { ok: false, error: "stale" }; } }
      else {
        const c = ev.apply; if (!c) { main.exec("ROLLBACK"); return { ok: false, error: "bad_proposal" }; }
        const seq = (main.prepare("SELECT COALESCE(MAX(seq), 0) + 1 s FROM title_reigns WHERE source = ? AND division = ? AND category = ?").get(ev.page, c.division, c.category) as { s: number }).s;
        const cols = { ...c, seq, fetched_at: new Date().toISOString() };
        main.prepare(`INSERT INTO title_reigns (${Object.keys(cols).join(", ")}) VALUES (${Object.keys(cols).map(() => "?").join(", ")})`).run(...Object.values(cols));
        changed = true;
      }
    } else if (p.kind === "reign_changed") {
      if (!live) { main.exec("ROLLBACK"); return { ok: false, error: "gone" }; }
      const fields = Object.keys((p.new ?? {}) as object).filter((k): k is (typeof FIELDS)[number] => (FIELDS as readonly string[]).includes(k));
      if (!fields.length || !ev.apply) { main.exec("ROLLBACK"); return { ok: false, error: "bad_proposal" }; }
      if (!same(live.row, p.new as Record<string, unknown>, fields)) {
        if (!same(live.row, p.old as Record<string, unknown>, fields)) { main.exec("ROLLBACK"); return { ok: false, error: "stale" }; }
        const c = ev.apply, set: Record<string, unknown> = { fetched_at: new Date().toISOString(), revision: c.revision };
        for (const f of fields) set[COLUMN_OF[f]] = c[COLUMN_OF[f]];
        if (fields.includes("name")) { set.wiki_title = c.wiki_title; set.wikidata_id = c.wikidata_id; }
        if (fields.includes("wonVs")) { set.won_vs_wikidata_id = c.won_vs_wikidata_id; set.won_note = c.won_note; }
        main.prepare(`UPDATE title_reigns SET ${Object.keys(set).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(Object.values(set) as (string | number | null)[]), live.rowId!);
        changed = true;
      }
    } else if (p.kind === "reign_removed") {
      if (live) {
        if (!same(live.row, p.old as Snapshot["row"])) { main.exec("ROLLBACK"); return { ok: false, error: "stale" }; }
        main.prepare("DELETE FROM title_reigns WHERE id = ?").run(live.rowId!);
        changed = true;
      }
    } else { main.exec("ROLLBACK"); return { ok: false, error: "bad_proposal" }; }
    main.exec("COMMIT");
    if (changed) linkReigns(main);
    return { ok: true, changed };
  } catch (e) { main.exec("ROLLBACK"); throw e; }
}
