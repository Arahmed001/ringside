import type { DatabaseSync } from "node:sqlite";
import { readChampionLists, type ChampionLists, type ParsedReign } from "../importers/wikipedia-champions";
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
type Snapshot = { key: string; org: string; division: string; row: Record<(typeof FIELDS)[number], string | number | boolean | null>; page: string; revision: string | null };

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
  const base = rows.map((r) => ({ org: r.org as string, division: r.division as string, row: { name: nul(r.name), status: nul(r.status), start: nul(r.start_date), end: nul(r.end_date), current: !!r.current, wonVs: nul(r.won_vs), defences: nul(r.defences), endNote: nul(r.end_note) } as Snapshot["row"], page, revision: nul(r.revision) as string | null }));
  return keyed(base, (_, i) => String(rows[i].wikidata_id ?? norm(rows[i].name as string)), (i) => String(rows[i].category ?? ""));
}

function fromFresh(reigns: ParsedReign[], page: string, revision: string, qids: Map<string, string>): Snapshot[] {
  const base = reigns.map((r) => ({ org: r.org, division: r.division, row: { name: nul(r.name), status: nul(r.status), start: nul(r.start), end: nul(r.end), current: r.current, wonVs: nul(r.wonVs), defences: nul(r.defences), endNote: nul(r.endNote) } as Snapshot["row"], page, revision }));
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
    if (!l) { out.push({ kind: "reign_added", targetKey: f.key, label: describe(f), old: null, new: f.row, evidence }); continue; }
    const changed = FIELDS.filter((k) => l.row[k] !== f.row[k]);
    if (changed.length) out.push({ kind: "reign_changed", targetKey: f.key, label: `${describe(f)}: ${changed.join(", ")}`, old: Object.fromEntries(changed.map((k) => [k, l.row[k]])), new: Object.fromEntries(changed.map((k) => [k, f.row[k]])), evidence: { ...evidence, held: describe(l) } });
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
};
