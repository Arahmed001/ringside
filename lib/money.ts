import type { World } from "./world";
import type { Broadcast, BoutRow, BoxerFull, EventFinancials, EventRow, Provenance, Purse } from "./types";
import { memo } from "./memo";

const RANK = { disclosed: 0, reported: 1, estimated: 2 } as const;

/** The strongest figure when several sources give one: official records beat press reports beat estimates; then the newest reading. */
export function best<T extends Provenance>(rows: T[] | undefined): T | undefined {
  if (!rows?.length) return undefined;
  return [...rows].sort((a, b) => RANK[a.basis] - RANK[b.basis] || (b.retrievedAt ?? "").localeCompare(a.retrievedAt ?? ""))[0];
}

export interface Sourced<V> { value: V; prov: Provenance }

export type FinField = "gateUsd" | "ticketsSold" | "capacity" | "siteFeeUsd" | "ppvBuys" | "ppvPriceUsd" | "ppvRevenueUsd" | "sponsorshipUsd";
const FIN_FIELDS: FinField[] = ["gateUsd", "ticketsSold", "capacity", "siteFeeUsd", "ppvBuys", "ppvPriceUsd", "ppvRevenueUsd", "sponsorshipUsd"];

/**
 * An event's money, field by field: each figure comes from the best source that has it, and keeps that source,
 * so a disclosed gate and a reported PPV count can sit side by side with their own provenance.
 */
export function eventMoney(w: World, eventId: number): { fields: Partial<Record<FinField, Sourced<number>>>; rows: EventFinancials[]; broadcasts: Broadcast[] } {
  const rows = w.financialsByEvent.get(eventId) ?? [];
  const ordered = [...rows].sort((a, b) => RANK[a.basis] - RANK[b.basis] || (b.retrievedAt ?? "").localeCompare(a.retrievedAt ?? ""));
  const fields: Partial<Record<FinField, Sourced<number>>> = {};
  for (const f of FIN_FIELDS) {
    const row = ordered.find((r) => r[f] !== null);
    if (row) fields[f] = { value: row[f] as number, prov: row };
  }
  const bc = [...(w.broadcastsByEvent.get(eventId) ?? [])].sort((a, b) => a.region.localeCompare(b.region) || RANK[a.basis] - RANK[b.basis]);
  // one row per broadcaster and region: the strongest source's
  const seen = new Set<string>();
  const broadcasts = bc.filter((b) => { const k = `${b.broadcaster}|${b.region}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { fields, rows, broadcasts };
}

/** What the event grossed from the sources that are known: gate + PPV + site fee + sponsorship. */
export const grossOf = (f: Partial<Record<FinField, Sourced<number>>>) =>
  (f.gateUsd?.value ?? 0) + (f.ppvRevenueUsd?.value ?? (f.ppvBuys && f.ppvPriceUsd ? Math.round(f.ppvBuys.value * f.ppvPriceUsd.value) : 0)) + (f.siteFeeUsd?.value ?? 0) + (f.sponsorshipUsd?.value ?? 0);

/** A bout's purses, one per fighter (the strongest source for each). */
export function boutPurses(w: World, boutId: number): Map<number, Purse> {
  const by = new Map<number, Purse[]>();
  for (const p of w.pursesByBout.get(boutId) ?? []) (by.get(p.boxerId) ?? by.set(p.boxerId, []).get(p.boxerId)!).push(p);
  return new Map([...by].map(([id, rows]) => [id, best(rows)!]));
}

export interface PurseLine { purse: Purse; bout: BoutRow; event: EventRow }

/** A fighter's pay per bout (strongest source each), newest first. */
export function fighterPurses(w: World, boxerId: number): PurseLine[] {
  const byBout = new Map<number, Purse[]>();
  for (const p of w.pursesByBoxer.get(boxerId) ?? []) (byBout.get(p.boutId) ?? byBout.set(p.boutId, []).get(p.boutId)!).push(p);
  const out: PurseLine[] = [];
  for (const [boutId, rows] of byBout) {
    const bout = w.boutById.get(boutId), purse = best(rows);
    const event = bout && w.eventById.get(bout.eventId);
    if (bout && purse && event) out.push({ purse, bout, event });
  }
  return out.sort((a, b) => b.event.date.localeCompare(a.event.date) || b.bout.id - a.bout.id);
}

export interface CareerMoney {
  total: number; fights: number; biggest: PurseLine | null;
  /** Share of the total that rests on official records rather than reports and estimates. */
  disclosedShare: number;
  byYear: { year: number; ring: number; offRing: number | null; basis: Provenance["basis"]; source: string; fromList: boolean }[];
}

/**
 * Career pay from purses, plus yearly earnings. A year's figure comes from a published earnings list when there is one
 * (it includes endorsements), otherwise from the purses that year; `fromList` says which.
 */
export function careerMoney(w: World, boxerId: number): CareerMoney | null {
  const lines = fighterPurses(w, boxerId);
  const lists = w.earningsByBoxer.get(boxerId) ?? [];
  if (!lines.length && !lists.length) return null;
  const total = lines.reduce((s, l) => s + l.purse.totalUsd, 0);
  const disclosed = lines.filter((l) => l.purse.basis === "disclosed").reduce((s, l) => s + l.purse.totalUsd, 0);
  const years = new Map<number, CareerMoney["byYear"][number]>();
  for (const l of lines) {
    const y = Number(l.event.date.slice(0, 4));
    const cur = years.get(y);
    years.set(y, { year: y, ring: (cur?.ring ?? 0) + l.purse.totalUsd, offRing: null, basis: cur && RANK[cur.basis] > RANK[l.purse.basis] ? cur.basis : l.purse.basis, source: "purses", fromList: false }); // a year is only as certain as its weakest purse
  }
  const listBy = new Map<number, typeof lists>();
  for (const e of lists) (listBy.get(e.year) ?? listBy.set(e.year, []).get(e.year)!).push(e);
  for (const [y, rows] of listBy) { const e = best(rows)!; years.set(y, { year: y, ring: e.ringUsd ?? e.totalUsd, offRing: e.offRingUsd, basis: e.basis, source: e.source, fromList: true }); }
  return {
    total, fights: lines.length, biggest: lines.reduce<PurseLine | null>((m, l) => (!m || l.purse.totalUsd > m.purse.totalUsd ? l : m), null),
    disclosedShare: total ? disclosed / total : 0, byYear: [...years.values()].sort((a, b) => a.year - b.year),
  };
}

export interface EventRank { event: EventRow; main: BoutRow | null; value: number; prov: Provenance; money: ReturnType<typeof eventMoney>["fields"] }

function rankedEvents(w: World, value: (f: ReturnType<typeof eventMoney>["fields"]) => Sourced<number> | undefined): EventRank[] {
  const out: EventRank[] = [];
  for (const id of w.financialsByEvent.keys()) {
    const event = w.eventById.get(id);
    if (!event || event.upcoming) continue;
    const { fields } = eventMoney(w, id);
    const v = value(fields);
    if (v && v.value > 0) out.push({ event, main: (w.boutsByEvent.get(id) ?? []).find((b) => b.status !== "cancelled") ?? null, value: v.value, prov: v.prov, money: fields });
  }
  return out.sort((a, b) => b.value - a.value);
}

export const topGates = (w: World, n = 10) => memo(w, `topGates:${n}`, () => rankedEvents(w, (f) => f.gateUsd).slice(0, n));
export const topPpv = (w: World, n = 10) => memo(w, `topPpv:${n}`, () => rankedEvents(w, (f) => f.ppvBuys).slice(0, n));
export const topGross = (w: World, n = 10) => memo(w, `topGross:${n}`, () => {
  const all = rankedEvents(w, (f) => { const g = grossOf(f); return g > 0 ? { value: g, prov: (f.gateUsd ?? f.ppvBuys ?? Object.values(f)[0])!.prov } : undefined; });
  return all.slice(0, n);
});

export interface PurseRank { purse: Purse; boxer: BoxerFull; bout: BoutRow; event: EventRow }

export const topPurses = (w: World, n = 10) => memo(w, `topPurses:${n}`, (): PurseRank[] => {
  const all: PurseRank[] = [];
  for (const [boxerId] of w.pursesByBoxer) {
    const boxer = w.byId.get(boxerId);
    if (!boxer) continue;
    for (const l of fighterPurses(w, boxerId)) all.push({ purse: l.purse, boxer, bout: l.bout, event: l.event });
  }
  return all.sort((a, b) => b.purse.totalUsd - a.purse.totalUsd).slice(0, n);
});

export interface EarnerRank { boxer: BoxerFull; total: number; fights: number; disclosedShare: number }

/** Biggest earners by purses, over a career or for one year. */
export const topEarners = (w: World, n = 10, year?: number) => memo(w, `topEarners:${n}:${year ?? "all"}`, (): EarnerRank[] => {
  const out: EarnerRank[] = [];
  for (const [boxerId] of w.pursesByBoxer) {
    const boxer = w.byId.get(boxerId);
    if (!boxer) continue;
    const lines = fighterPurses(w, boxerId).filter((l) => year === undefined || l.event.date.startsWith(String(year)));
    if (!lines.length) continue;
    const total = lines.reduce((s, l) => s + l.purse.totalUsd, 0);
    out.push({ boxer, total, fights: lines.length, disclosedShare: total ? lines.filter((l) => l.purse.basis === "disclosed").reduce((s, l) => s + l.purse.totalUsd, 0) / total : 0 });
  }
  return out.sort((a, b) => b.total - a.total).slice(0, n);
});

export interface BroadcasterRow { broadcaster: string; platform: Broadcast["platform"]; events: number; avgViewers: number | null; peakViewers: number | null; ppvBuys: number }

/** Broadcasters ranked by how many cards they showed, with their average audience where one is known. */
export const broadcasterTable = (w: World) => memo(w, "broadcasterTable", (): BroadcasterRow[] => {
  const acc = new Map<string, { platform: Broadcast["platform"]; events: Set<number>; aud: number[]; peak: number; ppv: number }>();
  for (const [eventId] of w.broadcastsByEvent) {
    const event = w.eventById.get(eventId);
    if (!event || event.upcoming) continue;
    const { broadcasts, fields } = eventMoney(w, eventId);
    for (const b of broadcasts) {
      const a = acc.get(b.broadcaster) ?? acc.set(b.broadcaster, { platform: b.platform, events: new Set(), aud: [], peak: 0, ppv: 0 }).get(b.broadcaster)!;
      if (!a.events.has(eventId)) { a.events.add(eventId); if (b.platform === "ppv") a.ppv += fields.ppvBuys?.value ?? 0; }
      if (b.viewersAvg) a.aud.push(b.viewersAvg);
      a.peak = Math.max(a.peak, b.viewersPeak ?? 0);
    }
  }
  return [...acc].map(([broadcaster, a]) => ({ broadcaster, platform: a.platform, events: a.events.size, avgViewers: a.aud.length ? Math.round(a.aud.reduce((s, v) => s + v, 0) / a.aud.length) : null, peakViewers: a.peak || null, ppvBuys: a.ppv }))
    .sort((x, y) => y.events - x.events || x.broadcaster.localeCompare(y.broadcaster));
});

export interface YearRevenue { year: number; events: number; gate: number; ppv: number; ppvBuys: number; tickets: number }

/** Money by calendar year across the cards that have figures. */
export const revenueByYear = (w: World) => memo(w, "revenueByYear", (): YearRevenue[] => {
  const by = new Map<number, YearRevenue>();
  for (const [eventId] of w.financialsByEvent) {
    const event = w.eventById.get(eventId);
    if (!event || event.upcoming) continue;
    const { fields } = eventMoney(w, eventId);
    const y = Number(event.date.slice(0, 4));
    const r = by.get(y) ?? by.set(y, { year: y, events: 0, gate: 0, ppv: 0, ppvBuys: 0, tickets: 0 }).get(y)!;
    r.events++; r.gate += fields.gateUsd?.value ?? 0; r.tickets += fields.ticketsSold?.value ?? 0;
    r.ppvBuys += fields.ppvBuys?.value ?? 0; r.ppv += fields.ppvRevenueUsd?.value ?? (fields.ppvBuys && fields.ppvPriceUsd ? fields.ppvBuys.value * fields.ppvPriceUsd.value : 0);
  }
  return [...by.values()].sort((a, b) => a.year - b.year);
});

/** How much of the league has money data at all, so every list can say what it is ranking. */
export const moneyCoverage = (w: World) => memo(w, "moneyCoverage", () => {
  const done = w.events.filter((e) => !e.upcoming && e.status !== "cancelled");
  const withFin = done.filter((e) => w.financialsByEvent.has(e.id)).length;
  const withPurses = new Set([...w.pursesByBout.keys()].map((id) => w.boutById.get(id)?.eventId)).size;
  const basis = { disclosed: 0, reported: 0, estimated: 0 };
  for (const rows of w.pursesByBout.values()) for (const p of rows) basis[p.basis]++;
  return { events: done.length, withFinancials: withFin, withPurses, purses: [...w.pursesByBout.values()].reduce((s, r) => s + r.length, 0), basis };
});

/** "$1.2M", "$840K", "$23" — compact US-dollar amounts; the digits are Western in every language. */
export function usd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(a >= 1e10 ? 0 : 2).replace(/\.?0+$/, "")}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (a >= 1e4) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
export const compact = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString("en-US"));
