import type { DatabaseSync } from "node:sqlite";
import type { FeedData } from "./feed";
import type { CareerRecord } from "./providers/boxing-data-api";

/**
 * What can be checked about a licensed feed, and what cannot. Nothing here can show the vendor's facts are TRUE: that needs a primary
 * source (a commission record, the fight itself). What it can show is whether the feed agrees with itself, and the one figure that
 * can contradict the loaded fights is each fighter's career record: the vendor states "19-0-1", and the fights we hold either add up
 * to that or they do not. A record that does not add up is a record Ringside would publish wrongly, so it is the check that gates a load.
 */
export type RecordStatus = "complete" | "partial" | "conflict";

/**
 * - complete: the fights we hold give exactly the vendor's wins, losses and draws.
 * - partial: they give fewer of at least one, and no more of any: fights are missing (the plan's window is shorter than the career, or a
 *   fighter could not be fetched). Expected on a limited window; the page then shows the vendor's career total, labelled, and builds the fight list, rating and rates from the fights held.
 * - conflict: they give MORE of something than the vendor's own career total: the feed contradicts itself (a duplicated fight, a wrong
 *   winner, a stale career record).
 */
export function classifyRecord(loaded: CareerRecord, vendor: CareerRecord): RecordStatus {
  if (loaded.wins > vendor.wins || loaded.losses > vendor.losses || loaded.draws > vendor.draws) return "conflict";
  return loaded.wins === vendor.wins && loaded.losses === vendor.losses && loaded.draws === vendor.draws ? "complete" : "partial";
}

export interface Mismatch { externalId: string; name: string; loaded: string; vendor: string }
export interface Reconciliation {
  /** fighters the vendor gave a career record for */
  checked: number;
  complete: number; partial: number; conflict: number;
  /** fighters in the data with no vendor record to check against (not counted in `share`) */
  noVendorRecord: number;
  /**
   * Daily update only (`reconcileDb` with `recent`): fighters whose loaded fights exceed the vendor's total, but only because of a fight in the last
   * few days. The vendor's career totals trail its results (seen: a fight on the 27th, the record updated on the 29th, still without it), so this is
   * "the total probably has not caught up", not a contradiction. Not counted as complete, and never counted as a conflict. Always 0 for a load.
   */
  lagging: number;
  /** complete / checked; 0 when nothing could be checked */
  share: number;
  conflicts: Mismatch[]; partials: Mismatch[]; laggards: Mismatch[];
}
const fmt = (r: CareerRecord) => `${r.wins}-${r.losses}-${r.draws}`;

function reconcile(fighters: { externalId: string; name: string }[], loaded: Map<string, CareerRecord>, vendor: Map<string, CareerRecord>, recent?: Map<string, CareerRecord>, longFights?: Set<string>): Reconciliation {
  const out: Reconciliation = { checked: 0, complete: 0, partial: 0, conflict: 0, noVendorRecord: 0, lagging: 0, share: 0, conflicts: [], partials: [], laggards: [] };
  for (const f of fighters) {
    const v = vendor.get(f.externalId);
    if (!v) { out.noVendorRecord++; continue; }
    const l = loaded.get(f.externalId) ?? { wins: 0, losses: 0, draws: 0 };
    // a supplier total of 0-0-0 beside a fight of more than three rounds (a professional fight) is an unfilled field, not a career of no fights (257 of the first full load's 1,030 "conflicts"):
    // there is no total to check against. Beside only short fights it stays what it was: an exhibition or amateur bout the professional total leaves out
    if (v.wins + v.losses + v.draws === 0 && l.wins + l.losses + l.draws > 0 && longFights?.has(f.externalId)) { out.noVendorRecord++; continue; }
    let status: RecordStatus | "lagging" = classifyRecord(l, v);
    // a conflict that disappears once the last few days' fights are set aside is explained by the vendor's total trailing them
    const r = recent?.get(f.externalId);
    if (status === "conflict" && r && classifyRecord({ wins: l.wins - r.wins, losses: l.losses - r.losses, draws: l.draws - r.draws }, v) !== "conflict") status = "lagging";
    out.checked++; out[status]++;
    const m = { externalId: f.externalId, name: f.name, loaded: fmt(l), vendor: fmt(v) };
    if (status === "conflict") out.conflicts.push(m); else if (status === "partial") out.partials.push(m); else if (status === "lagging") out.laggards.push(m);
  }
  out.share = out.checked ? out.complete / out.checked : 0;
  return out;
}

const add = (m: Map<string, CareerRecord>, id: string, k: keyof CareerRecord) => { const r = m.get(id) ?? { wins: 0, losses: 0, draws: 0 }; r[k]++; m.set(id, r); };

/** Reconciles a feed (before anything is written) against the vendor's career records. Fights with a winner count as a win and a loss, a DRAW as a draw each; cancelled fights and fights with no result count for nothing. */
export function reconcileFeed(feed: FeedData, vendor: Map<string, CareerRecord>, lag?: { today: string; days: number }): Reconciliation {
  const loaded = new Map<string, CareerRecord>();
  // with `lag`, the fights of the last `days` days are also counted apart: a conflict that goes away without them is the vendor's total trailing its results (`lagging`), not the feed contradicting itself
  const recent = lag ? new Map<string, CareerRecord>() : undefined;
  const dateOf = new Map(feed.events.map((e) => [e.externalId, e.date]));
  const longFights = new Set<string>();
  const cutoff = lag ? new Date(Date.parse(`${lag.today}T00:00:00Z`) - lag.days * 86_400_000).toISOString().slice(0, 10) : "";
  for (const b of feed.bouts) {
    if (b.status === "cancelled") continue;
    if ((b.rounds ?? 10) > 3) { longFights.add(b.redExternalId); longFights.add(b.blueExternalId); }
    const isRecent = !!recent && (dateOf.get(b.eventExternalId) ?? "") >= cutoff && !!dateOf.get(b.eventExternalId);
    const count = (id: string, k: keyof CareerRecord) => { add(loaded, id, k); if (isRecent) add(recent!, id, k); };
    if (b.winnerExternalId) {
      count(b.winnerExternalId, "wins");
      count(b.winnerExternalId === b.redExternalId ? b.blueExternalId : b.redExternalId, "losses");
    } else if (b.method === "DRAW") { count(b.redExternalId, "draws"); count(b.blueExternalId, "draws"); }
  }
  return reconcile(feed.boxers, loaded, vendor, recent, longFights);
}

/**
 * The same check against what is in the database now (the daily update: the feed holds only the recent fights, the database holds the careers). Optionally only for some fighters.
 * With `lag`, a conflict that only the fights of the last `days` days cause is reported as `lagging` instead (see `Reconciliation.lagging`). Without it the check is strict, as it is for a load.
 */
export function reconcileDb(db: DatabaseSync, vendor: Map<string, CareerRecord>, only?: Iterable<string>, lag?: { today: string; days: number }): Reconciliation {
  const boxers = db.prepare("SELECT id, external_id, name FROM boxers WHERE external_id IS NOT NULL").all() as { id: number; external_id: string; name: string }[];
  const wanted = only ? new Set(only) : null;
  const byId = new Map(boxers.map((b) => [b.id, b.external_id]));
  const loaded = new Map<string, CareerRecord>();
  const rows = db.prepare("SELECT b.red_id, b.blue_id, b.winner_id, b.method, b.status, b.rounds, e.date AS date FROM bouts b LEFT JOIN events e ON e.id = b.event_id").all() as { red_id: number; blue_id: number; winner_id: number | null; rounds: number | null; method: string | null; status: string | null; date: string | null }[];
  const recent = lag ? new Map<string, CareerRecord>() : undefined;
  const longFights = new Set<string>();
  const cutoff = lag ? new Date(Date.parse(`${lag.today}T00:00:00Z`) - lag.days * 86_400_000).toISOString().slice(0, 10) : "";
  for (const b of rows) {
    if (b.status === "cancelled") continue;
    const red = byId.get(b.red_id), blue = byId.get(b.blue_id);
    if ((b.rounds ?? 10) > 3) { if (red) longFights.add(red); if (blue) longFights.add(blue); }
    const isRecent = !!recent && !!b.date && b.date >= cutoff;
    const count = (id: string | undefined, k: keyof CareerRecord) => { if (!id) return; add(loaded, id, k); if (isRecent) add(recent!, id, k); };
    if (b.winner_id) {
      const l = b.winner_id === b.red_id ? blue : red;
      count(byId.get(b.winner_id), "wins"); count(l, "losses");
    } else if (b.method === "DRAW") { count(red, "draws"); count(blue, "draws"); }
  }
  return reconcile(boxers.filter((b) => !wanted || wanted.has(b.external_id)).map((b) => ({ externalId: b.external_id, name: b.name })), loaded, vendor, recent, longFights);
}

export interface Core {
  /** fighters whose loaded fights add up exactly to the vendor's career record AND whose opponents in those fights are in the core too */
  fighters: Set<string>;
  /** fighters whose record was complete on its own, before the opponents were considered */
  completeAlone: number;
}

/**
 * The part of a partial load that is right. A fighter's record is exactly the vendor's only if every fight that counts in it is loaded, which also needs the
 * opponent in each of them to be loaded; but an opponent whose own record falls short is not in the core, so the fight would not be loaded, and the record
 * would fall short again. So the core is the largest set of fighters that are complete AND whose opponents are all in it, found by taking out, again and
 * again, any fighter with a counted fight against someone who is out. Every record in it equals the vendor's total; nothing in it is a guess.
 * Fights that count for nothing (cancelled, no result yet) do not hold a fighter in or out.
 */
export function coherentCore(feed: Pick<FeedData, "boxers" | "bouts">, vendor: Map<string, CareerRecord>): Core {
  const rec = reconcileFeed({ ...feed } as FeedData, vendor);
  const bad = new Set([...rec.partials, ...rec.conflicts].map((m) => m.externalId));
  const alone = new Set(feed.boxers.map((b) => b.externalId).filter((id) => vendor.has(id) && !bad.has(id)));
  const completeAlone = alone.size;
  const foes = new Map<string, string[]>();
  const link = (a: string, b: string) => { const l = foes.get(a); if (l) l.push(b); else foes.set(a, [b]); };
  for (const b of feed.bouts) {
    if (b.status === "cancelled" || !(b.winnerExternalId || b.method === "DRAW")) continue;
    link(b.redExternalId, b.blueExternalId); link(b.blueExternalId, b.redExternalId);
  }
  const queue = [...alone].filter((id) => (foes.get(id) ?? []).some((o) => !alone.has(o)));
  while (queue.length) {
    const id = queue.pop()!;
    if (!alone.delete(id)) continue;
    for (const o of foes.get(id) ?? []) if (alone.has(o)) queue.push(o); // o has a counted fight against someone now out
  }
  return { fighters: alone, completeAlone };
}

/** A feed cut down to a set of fighters: those fighters, the fights between two of them, and the events that still have a fight. */
export function restrictFeed(feed: FeedData, keep: Set<string>): FeedData {
  const bouts = feed.bouts.filter((b) => keep.has(b.redExternalId) && keep.has(b.blueExternalId));
  const events = new Set(bouts.map((b) => b.eventExternalId));
  return { ...feed, boxers: feed.boxers.filter((b) => keep.has(b.externalId)), bouts, events: feed.events.filter((e) => events.has(e.externalId)) };
}

export interface GateOptions { minComplete: number; allowPartial: boolean; allowConflicts: boolean }
/** Whether a load may go ahead, and if not, why in plain words. Conflicts always need a deliberate override; partial records need either enough complete ones or an override. */
export function recordGate(r: Reconciliation, o: GateOptions): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.conflict > 0 && !o.allowConflicts) reasons.push(`${r.conflict} fighter(s) have MORE wins, losses or draws in the loaded fights than the vendor's own career total, so the feed contradicts itself (${r.conflicts.slice(0, 3).map((m) => `${m.name}: loaded ${m.loaded}, vendor ${m.vendor}`).join("; ")}). --allow-conflicts loads anyway.`);
  if (r.checked === 0 && !o.allowPartial) reasons.push("the feed gave no career records, so nothing can be checked. --allow-partial loads anyway.");
  else if (r.checked > 0 && r.share < o.minComplete && !o.allowPartial) reasons.push(`only ${(r.share * 100).toFixed(1)}% of fighters (${r.complete} of ${r.checked}) have loaded fights that add up to the vendor's career record; ${(o.minComplete * 100).toFixed(0)}% is required. The rest hold fewer fights than the vendor's career total (${r.partials.slice(0, 3).map((m) => `${m.name}: loaded ${m.loaded}, vendor ${m.vendor}`).join("; ")}). Their pages show the vendor's total, labelled, but their fight lists, ratings and rates come from the fights held. --allow-partial loads anyway; --min-complete changes the bar.`);
  return { ok: reasons.length === 0, reasons };
}

export function describeReconciliation(r: Reconciliation): string[] {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [`records: ${r.complete} of ${r.checked} fighters (${pct(r.share)}) have loaded fights that add up exactly to the vendor's career record`];
  if (r.partial) lines.push(`  ${r.partial} partial: fights are missing, so the page shows the vendor's career total with a note that fewer fights are held${r.partials.length ? ` (e.g. ${r.partials.slice(0, 3).map((m) => `${m.name} loaded ${m.loaded} vs vendor ${m.vendor}`).join("; ")})` : ""}`);
  if (r.conflict) lines.push(`  ${r.conflict} CONFLICT: more than the vendor's own career total, so the feed contradicts itself (e.g. ${r.conflicts.slice(0, 3).map((m) => `${m.name} loaded ${m.loaded} vs vendor ${m.vendor}`).join("; ")})`);
  if (r.lagging) lines.push(`  ${r.lagging} career total(s) probably lagging: the loaded fights exceed the vendor's total only because of a fight in the last few days, and the vendor's totals trail its results (e.g. ${r.laggards.slice(0, 3).map((m) => `${m.name} loaded ${m.loaded} vs vendor ${m.vendor}`).join("; ")}). Not a contradiction yet: the next day's update will show whether the total caught up.`);
  if (r.noVendorRecord) lines.push(`  ${r.noVendorRecord} fighter(s) came with no career record, so nothing can be checked for them`);
  return lines;
}

/**
 * Why a fighter's loaded fights come to MORE than the vendor's career record: the question a conflict leaves open. A conflict is the feed
 * contradicting itself, and the usual reasons can be told apart from the fights themselves, without the vendor:
 * - `draw`: more draws loaded than the vendor counts (a drawn fight the vendor never recorded);
 * - `wins` / `losses`: more of those than the vendor counts, with no other reason below to blame (a wrong winner, another fighter's fights under his id, a stale total);
 * - `repeat`: the same two fighters twice within 30 days, which is one fight listed twice;
 * - `same-day`: two fights on one date for one fighter;
 * - `recent`: the surplus disappears when the fights of the last 14 days are set aside, so the vendor's total probably trails its results;
 * - `short`: the surplus disappears when the fights scheduled for 3 rounds or fewer are set aside: probably an amateur or exhibition bout the vendor's career total leaves out (professional bouts are 4 rounds or more).
 * - `flipped` (alongside the others): reversing the winner of ONE counted fight would remove the conflict, so a winner flag in the fight list, or the vendor's total, may be the wrong way round (a fighter loaded 1-0-0 against a vendor 0-1-0). The fights cannot say which is right.
 * A fighter can have several. `unexplained` is a conflict none of these accounts for.
 */
export type ConflictCause = "draw" | "wins" | "losses" | "repeat" | "same-day" | "recent" | "short" | "flipped" | "unexplained";
export interface ConflictFight { date: string; opponent: string; opponentId: string; result: "W" | "L" | "D" | "NC"; method: string | null; /** scheduled rounds: an exhibition or an amateur bout the vendor's career total leaves out is often 3 */ rounds: number; boutId: string }
/** what the fights of the OPPONENT say about a one-fight reversal that would clear this fighter's conflict: see `explainConflicts` */
export type FlipEvidence = "mutual" | "open" | "contradicted";
export interface ConflictExplanation { externalId: string; name: string; loaded: string; vendor: string; causes: ConflictCause[]; fights: ConflictFight[]; flip?: FlipEvidence }
export interface ConflictReport { total: number; tally: Record<ConflictCause, number>; flipEvidence: Record<FlipEvidence, number>; fighters: ConflictExplanation[] }

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

export function explainConflicts(feed: FeedData, vendor: Map<string, CareerRecord>, today: string, lagDays?: number): ConflictReport {
  // with `lagDays` the fighters whose surplus is only the last days' fights are `lagging`, not conflicts (as in the records line), so the `recent` cause cannot arise
  const rec = reconcileFeed(feed, vendor, lagDays === undefined ? undefined : { today, days: lagDays });
  const name = new Map(feed.boxers.map((b) => [b.externalId, b.name]));
  const dateOf = new Map(feed.events.map((e) => [e.externalId, e.date]));
  const byFighter = new Map<string, ConflictFight[]>();
  const loadedAll = new Map<string, CareerRecord>(); // every fighter's loaded record, to ask what a reversed winner would do to the OTHER fighter
  for (const b of feed.bouts) {
    if (b.status === "cancelled") continue;
    if (b.winnerExternalId) { add(loadedAll, b.winnerExternalId, "wins"); add(loadedAll, b.winnerExternalId === b.redExternalId ? b.blueExternalId : b.redExternalId, "losses"); } else if (b.method === "DRAW") { add(loadedAll, b.redExternalId, "draws"); add(loadedAll, b.blueExternalId, "draws"); }
    const date = dateOf.get(b.eventExternalId) ?? "";
    for (const [me, opp] of [[b.redExternalId, b.blueExternalId], [b.blueExternalId, b.redExternalId]] as const) {
      const result = b.winnerExternalId ? (b.winnerExternalId === me ? "W" : "L") : b.method === "DRAW" ? "D" : "NC";
      const list = byFighter.get(me) ?? byFighter.set(me, []).get(me)!;
      list.push({ date, opponent: name.get(opp) ?? opp, opponentId: opp, result, method: b.method ?? null, rounds: b.rounds, boutId: b.externalId });
    }
  }
  const tally: Record<ConflictCause, number> = { draw: 0, wins: 0, losses: 0, repeat: 0, "same-day": 0, recent: 0, short: 0, flipped: 0, unexplained: 0 };
  const fighters: ConflictExplanation[] = [];
  const flipEvidence: Record<FlipEvidence, number> = { mutual: 0, open: 0, contradicted: 0 };
  const count = (fs: ConflictFight[]): CareerRecord => ({ wins: fs.filter((f) => f.result === "W").length, losses: fs.filter((f) => f.result === "L").length, draws: fs.filter((f) => f.result === "D").length });
  for (const c of rec.conflicts) {
    const v = vendor.get(c.externalId)!;
    const fights = (byFighter.get(c.externalId) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const l = count(fights), causes: ConflictCause[] = [];
    const counting = fights.filter((f) => f.result !== "NC");
    if (l.draws > v.draws) causes.push("draw");
    const dup = counting.some((f, i) => counting.some((g, j) => j > i && g.opponent === f.opponent && days(f.date, g.date) <= 30));
    if (dup) causes.push("repeat");
    if (counting.some((f, i) => counting.some((g, j) => j > i && g.date === f.date))) causes.push("same-day");
    if (classifyRecord(count(fights.filter((f) => days(f.date, today) > 14)), v) !== "conflict") causes.push("recent");
    if (classifyRecord(count(fights.filter((f) => f.rounds > 3)), v) !== "conflict") causes.push("short");
    // a surplus of wins or losses is blamed on the feed's winner only when nothing else accounts for it
    if (!causes.some((k) => k !== "draw")) { if (l.wins > v.wins) causes.push("wins"); if (l.losses > v.losses) causes.push("losses"); }
    // would reversing the winner of a single fight remove the conflict? And what would that do to the OTHER fighter in it: one reversed flag in the list moves a win and a loss in
    // opposite directions, so if it is the list that is wrong the opponent's record should improve too ("mutual"); if the opponent's record adds up exactly now, reversing it would
    // break him, so that winner looks right and the vendor's total is the odd one out ("contradicted"); a partial or unchecked opponent says nothing ("open")
    const flip = (f: ConflictFight): ConflictFight[] => fights.map((x) => (x === f ? { ...x, result: x.result === "W" ? "L" : "W" } : x));
    const candidates = fights.filter((f) => (f.result === "W" || f.result === "L") && classifyRecord(count(flip(f)), v) !== "conflict");
    let flipKind: FlipEvidence | undefined;
    if (candidates.length) {
      causes.push("flipped");
      const rank: Record<FlipEvidence, number> = { mutual: 2, open: 1, contradicted: 0 };
      for (const f of candidates) {
        const ov = vendor.get(f.opponentId), ol = loadedAll.get(f.opponentId) ?? { wins: 0, losses: 0, draws: 0 };
        const after = f.result === "W" ? { ...ol, wins: ol.wins + 1, losses: ol.losses - 1 } : { ...ol, wins: ol.wins - 1, losses: ol.losses + 1 };
        let kind: FlipEvidence = "open";
        if (ov) {
          const was = classifyRecord(ol, ov), now = classifyRecord(after, ov);
          if (was === "conflict" && now !== "conflict") kind = "mutual";
          else if (was === "complete" || (was === "partial" && now === "conflict")) kind = "contradicted";
        }
        if (flipKind === undefined || rank[kind] > rank[flipKind]) flipKind = kind;
      }
      flipEvidence[flipKind!]++;
    }
    if (!causes.length) causes.push("unexplained");
    for (const k of causes) tally[k]++;
    fighters.push({ externalId: c.externalId, name: c.name, loaded: c.loaded, vendor: c.vendor, causes, fights, ...(flipKind ? { flip: flipKind } : {}) });
  }
  return { total: rec.conflicts.length, tally, flipEvidence, fighters };
}

const CAUSE_TEXT: Record<ConflictCause, string> = {
  draw: "more draws loaded than the vendor counts (a drawn fight the vendor never recorded)",
  wins: "more wins loaded than the vendor counts, with no repeated fight to blame (wrong winner, another fighter's fights under his id, or a stale total)",
  losses: "more losses loaded than the vendor counts, with no repeated fight to blame",
  repeat: "the same two fighters twice within 30 days (one fight listed twice)",
  "same-day": "two fights on one date for one fighter",
  recent: "the surplus goes away without the last 14 days' fights: the vendor's total probably trails its results",
  flipped: "reversing the winner of one fight would remove the conflict: a winner flag in the fight list, or the vendor's total, may be the wrong way round (the fights cannot say which)",
  short: "the surplus goes away without the fights scheduled for 3 rounds or fewer: probably an amateur or exhibition bout the vendor's career total leaves out",
  unexplained: "no cause found in the fights",
};

/** The tally of causes (always worth printing when there are conflicts) and, with `show` above 0, the fights of that many conflicted fighters, so each can be checked by eye. */
export function describeConflictReport(r: ConflictReport, show = 0): string[] {
  if (!r.total) return [];
  const lines = [`why the ${r.total} conflict(s) (a fighter can have more than one reason):`];
  for (const k of Object.keys(CAUSE_TEXT) as ConflictCause[]) {
    if (!r.tally[k]) continue;
    lines.push(`  ${String(r.tally[k]).padStart(5)}  ${CAUSE_TEXT[k]}`);
    if (k === "flipped") {
      const e = r.flipEvidence;
      lines.push(`         of those: ${e.mutual} where the same reversal would also clear the OTHER fighter's conflict (the fight list's winner flag looks reversed),`);
      lines.push(`                   ${e.open} where it only touches an opponent with no record to check or a partial one (no evidence either way),`);
      lines.push(`                   ${e.contradicted} where every such reversal would break an opponent whose record adds up exactly (that winner looks right: the vendor's total is the odd one)`);
    }
  }
  for (const f of r.fighters.slice(0, show)) {
    lines.push(`  ${f.name}: loaded ${f.loaded}, vendor ${f.vendor}: ${f.causes.join(", ")}`);
    for (const x of f.fights) lines.push(`      ${x.date}  ${x.result}  ${(x.method ?? "no result").padEnd(9)} ${String(x.rounds).padStart(2)} rds  vs ${x.opponent}  (${x.boutId})`);
  }
  return lines;
}

/**
 * `--drop-conflicts`: the fighters whose loaded fights come to MORE than the vendor's own career total, taken out together with their fights, so the rest can be
 * loaded. A fighter's removal only takes fights from his opponents' counts, so it cannot turn anyone else into a conflict (a record can become shorter, and a
 * shorter record is a partial one, shown with the vendor's total). The dropped are returned so they can be listed: nobody leaves the league unannounced.
 */
export function dropConflicted(feed: FeedData, rec: Reconciliation): { feed: FeedData; dropped: Mismatch[]; fightsDropped: number } {
  const gone = new Set(rec.conflicts.map((m) => m.externalId));
  if (!gone.size) return { feed, dropped: [], fightsDropped: 0 };
  const cut = restrictFeed(feed, new Set(feed.boxers.map((b) => b.externalId).filter((id) => !gone.has(id))));
  return { feed: cut, dropped: rec.conflicts, fightsDropped: feed.bouts.length - cut.bouts.length };
}
