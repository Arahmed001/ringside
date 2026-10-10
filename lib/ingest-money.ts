import type { DatabaseSync } from "node:sqlite";
import { todayIso } from "./clock";
import { sanitizeMoney, type MoneyRows } from "./validate-money";
import { countBySeverity, type Issue } from "./validate";

const num = (v: number | null | undefined) => (v === undefined || v === null || Number.isNaN(v) ? null : v);
export interface IdMaps { ev: Map<string, number>; bo: Map<string, number>; bx: Map<string, number> }

/**
 * Writes money rows (already validated) inside the caller's transaction. Rows are replaced per source: re-running a source
 * never duplicates its figures, and figures other sources gave for the same card or fighter are left alone.
 */
export function writeMoney(db: DatabaseSync, { ev, bo, bx }: IdMaps, rows: MoneyRows) {
  const { financials, purses, broadcasts, earnings } = rows, weighIns = rows.weighIns ?? [];
  const sourcesOf = (r: { source: string }[]) => [...new Set(r.map((x) => x.source))];
  if (financials.length) {
    for (const s of sourcesOf(financials)) db.prepare("DELETE FROM event_financials WHERE source = ?").run(s);
    const ins = db.prepare(`INSERT INTO event_financials (event_id, gate_usd, tickets_sold, capacity, site_fee_usd, ppv_buys, ppv_price_usd, ppv_revenue_usd, sponsorship_usd, basis, source, source_url, retrieved_at, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const f of financials) {
      const rev = f.ppvRevenueUsd ?? (f.ppvBuys !== undefined && f.ppvPriceUsd !== undefined ? Math.round(f.ppvBuys * f.ppvPriceUsd) : undefined);
      ins.run(ev.get(f.eventExternalId)!, num(f.gateUsd), num(f.ticketsSold), num(f.capacity), num(f.siteFeeUsd), num(f.ppvBuys), num(f.ppvPriceUsd), num(rev), num(f.sponsorshipUsd), f.basis, f.source, f.sourceUrl ?? null, f.retrievedAt ?? null, f.note ?? null);
    }
  }
  if (purses.length) {
    for (const s of sourcesOf(purses)) db.prepare("DELETE FROM purses WHERE source = ?").run(s);
    const ins = db.prepare("INSERT INTO purses (bout_id, boxer_id, guaranteed_usd, bonus_usd, total_usd, basis, source, source_url, retrieved_at, note) VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const p of purses) ins.run(bo.get(p.boutExternalId)!, bx.get(p.boxerExternalId)!, num(p.guaranteedUsd), num(p.bonusUsd), num(p.totalUsd ?? (p.guaranteedUsd ?? 0) + (p.bonusUsd ?? 0)), p.basis, p.source, p.sourceUrl ?? null, p.retrievedAt ?? null, p.note ?? null);
  }
  if (broadcasts.length) {
    for (const s of sourcesOf(broadcasts)) db.prepare("DELETE FROM event_broadcasts WHERE source = ?").run(s);
    const ins = db.prepare("INSERT INTO event_broadcasts (event_id, broadcaster, platform, region, viewers_avg, viewers_peak, basis, source, source_url, retrieved_at, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    for (const b of broadcasts) ins.run(ev.get(b.eventExternalId)!, b.broadcaster.trim(), b.platform, b.region?.trim() ?? "", num(b.viewersAvg), num(b.viewersPeak), b.basis, b.source, b.sourceUrl ?? null, b.retrievedAt ?? null, b.note ?? null);
  }
  if (weighIns.length) {
    // a researched weight is replaced per source and bout, and never overwrites a row another source (the vendor) holds for the same fighter and fight
    for (const s of sourcesOf(weighIns.map((w) => ({ source: w.source ?? "research" })))) db.prepare("DELETE FROM weigh_ins WHERE source = ?").run(s);
    const ins = db.prepare("INSERT OR IGNORE INTO weigh_ins (bout_id, boxer_id, official_lb, fight_night_lb, limit_lb, made_weight, source, source_url, basis, retrieved_at, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    for (const w of weighIns) {
      const made = w.madeWeight !== undefined ? w.madeWeight : w.officialLb !== undefined && w.limitLb !== undefined && w.limitLb !== null ? w.officialLb <= w.limitLb : undefined;
      ins.run(bo.get(w.boutExternalId)!, bx.get(w.boxerExternalId)!, num(w.officialLb), num(w.fightNightLb), num(w.limitLb ?? undefined), made === undefined ? null : made ? 1 : 0, w.source ?? "research", w.sourceUrl ?? null, w.basis ?? "reported", w.retrievedAt ?? null, w.note ?? null);
    }
  }
  if (earnings.length) {
    for (const s of sourcesOf(earnings)) db.prepare("DELETE FROM earnings WHERE source = ?").run(s);
    const ins = db.prepare("INSERT INTO earnings (boxer_id, year, total_usd, ring_usd, off_ring_usd, basis, source, source_url, retrieved_at, note) VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const e of earnings) ins.run(bx.get(e.boxerExternalId)!, e.year, e.totalUsd, num(e.ringUsd), num(e.offRingUsd), e.basis, e.source, e.sourceUrl ?? null, e.retrievedAt ?? null, e.note ?? null);
  }
}

/**
 * Adds money rows to a database that already has its fighters, cards and bouts (the research pipeline's output, or a vendor's
 * money-only file). References are the externalIds already in the database. Returns what was written and what was dropped.
 */
export function ingestMoney(db: DatabaseSync, rows: MoneyRows, opts: { label?: string } = {}): { written: Record<string, number>; dropped: Record<string, number>; issues: Issue[] } {
  const ids = (sql: string) => new Map((db.prepare(sql).all() as { external_id: string; id: number }[]).map((r) => [r.external_id, r.id]));
  const ev = ids("SELECT external_id, id FROM events"), bx = ids("SELECT external_id, id FROM boxers");
  const boutRows = db.prepare(`SELECT b.external_id, b.id, r.external_id red, u.external_id blue FROM bouts b JOIN boxers r ON r.id = b.red_id JOIN boxers u ON u.id = b.blue_id`).all() as { external_id: string; id: number; red: string; blue: string }[];
  const bo = new Map(boutRows.map((r) => [r.external_id, r.id]));
  const issues: Issue[] = [], dropped: Record<string, number> = {};
  const add = (severity: Issue["severity"], code: string, entity: string, ref: string, message: string) => issues.push({ severity, code, entity, ref, message });
  const clean = sanitizeMoney(rows, { eventIds: new Set(ev.keys()), boxerIds: new Set(bx.keys()), bouts: new Map(boutRows.map((r) => [r.external_id, { red: r.red, blue: r.blue }])), today: todayIso() }, add, (e) => { dropped[e] = (dropped[e] ?? 0) + 1; });
  db.exec("BEGIN");
  try { writeMoney(db, { ev, bo, bx }, clean); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
  const sev = countBySeverity(issues);
  const written = { financials: clean.financials.length, purses: clean.purses.length, broadcasts: clean.broadcasts.length, earnings: clean.earnings.length, weighIns: (clean.weighIns ?? []).length };
  db.prepare("INSERT INTO ingest_runs (at, provider, errors, warnings, infos, counts, dropped) VALUES (?,?,?,?,?,?,?)").run(new Date().toISOString(), opts.label ?? "money", sev.errors, sev.warnings, sev.infos, JSON.stringify(written), JSON.stringify(dropped));
  return { written, dropped, issues };
}
