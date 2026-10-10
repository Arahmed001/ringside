import type { ProviderBroadcast, ProviderEarning, ProviderEventFinancials, ProviderPurse, ProviderWeighIn } from "./providers";

export interface MoneyRows { financials: ProviderEventFinancials[]; purses: ProviderPurse[]; broadcasts: ProviderBroadcast[]; earnings: ProviderEarning[]; /** researched weigh-in weights (absent in a feed written before they existed) */ weighIns?: ProviderWeighIn[] }
/** What the money rows may point at: the events, bouts and fighters that exist (in the feed being checked, or already in the database). */
export interface MoneyRefs { eventIds: Set<string>; boxerIds: Set<string>; bouts: Map<string, { red: string; blue: string }>; today: string }
type Add = (severity: "error" | "warning" | "info", code: string, entity: string, ref: string, message: string) => void;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const validDate = (s: string | null | undefined) => !!s && ISO.test(s) && !Number.isNaN(Date.parse(s + "T12:00:00Z")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;

/**
 * Checks money rows: every figure needs a basis and a named source; references must exist; implausible figures are
 * flagged, never "corrected". Errors drop the row (reported through `drop`), warnings keep it.
 */
export function sanitizeMoney(input: MoneyRows, refs: MoneyRefs, add: Add, drop: (entity: string) => void): MoneyRows {
  const BASES = new Set(["disclosed", "reported", "estimated"]);
  const PLATFORMS = new Set(["ppv", "streaming", "subscription", "free-tv"]);
  const MAX_EVENT_USD = 2_000_000_000, MAX_PURSE_USD = 600_000_000;
  const noUrl = new Map<string, number>(); // reported once per kind, not per row: a feed without links would otherwise bury every other message
  const nonNeg = (...xs: (number | undefined)[]) => xs.every((x) => x === undefined || (Number.isFinite(x) && x >= 0));
  const provenance = (r: { basis: string; source?: string; sourceUrl?: string; retrievedAt?: string }, entity: string, ref: string): boolean => {
    if (!BASES.has(r.basis)) { add("error", "bad_basis", entity, ref, `basis "${r.basis}" must be disclosed, reported or estimated`); drop(entity); return false; }
    if (!r.source || !String(r.source).trim()) { add("error", "missing_source", entity, ref, "a money figure without a named source is not published"); drop(entity); return false; }
    if (r.retrievedAt && !validDate(r.retrievedAt)) add("warning", "bad_retrieved_at", entity, ref, `retrievedAt "${r.retrievedAt}"`);
    if (!r.sourceUrl) noUrl.set(entity, (noUrl.get(entity) ?? 0) + 1);
    else if (!/^https?:\/\//.test(r.sourceUrl)) add("warning", "bad_source_url", entity, ref, `sourceUrl "${r.sourceUrl}" is not an http(s) link`);
    return true;
  };
  const financials = input.financials.filter((f) => {
    const ref = `${f.eventExternalId}/${f.source}`;
    if (!refs.eventIds.has(f.eventExternalId)) { add("error", "bad_reference", "financials", ref, `event ${f.eventExternalId} does not exist`); drop("financials"); return false; }
    if (!nonNeg(f.gateUsd, f.ticketsSold, f.capacity, f.siteFeeUsd, f.ppvBuys, f.ppvPriceUsd, f.ppvRevenueUsd, f.sponsorshipUsd)) { add("error", "negative_amount", "financials", ref, "an amount is negative or not a number"); drop("financials"); return false; }
    if (!provenance(f, "financials", ref)) return false;
    if ([f.gateUsd, f.siteFeeUsd, f.ppvRevenueUsd, f.sponsorshipUsd].some((x) => x !== undefined && x > MAX_EVENT_USD)) add("warning", "implausible_amount", "financials", ref, "an amount above $2 billion");
    if (f.ticketsSold !== undefined && f.capacity !== undefined && f.ticketsSold > f.capacity) add("warning", "tickets_over_capacity", "financials", ref, `${f.ticketsSold} tickets for a capacity of ${f.capacity}`);
    if (f.ppvBuys !== undefined && f.ppvPriceUsd !== undefined && f.ppvRevenueUsd !== undefined) {
      const expect = f.ppvBuys * f.ppvPriceUsd;
      if (expect > 0 && Math.abs(f.ppvRevenueUsd - expect) / expect > 0.2) add("warning", "ppv_revenue_mismatch", "financials", ref, `${f.ppvBuys} buys x $${f.ppvPriceUsd} is $${Math.round(expect)}, revenue says $${Math.round(f.ppvRevenueUsd)}`);
    }
    if (f.ppvPriceUsd !== undefined && (f.ppvPriceUsd < 5 || f.ppvPriceUsd > 150)) add("warning", "implausible_ppv_price", "financials", ref, `PPV price $${f.ppvPriceUsd}`);
    if (f.gateUsd !== undefined && f.ticketsSold !== undefined && f.ticketsSold > 0 && (f.gateUsd / f.ticketsSold < 5 || f.gateUsd / f.ticketsSold > 20000)) add("warning", "implausible_ticket_price", "financials", ref, `$${Math.round(f.gateUsd / f.ticketsSold)} per ticket on average`);
    return true;
  });
  const purseKeys = new Set<string>();
  const purses = input.purses.filter((p) => {
    const ref = `${p.boutExternalId}/${p.boxerExternalId}/${p.source}`;
    const b = refs.bouts.get(p.boutExternalId);
    if (!b || !refs.boxerIds.has(p.boxerExternalId)) { add("error", "bad_reference", "purse", ref, "bout or fighter does not exist"); drop("purse"); return false; }
    if (!nonNeg(p.guaranteedUsd, p.bonusUsd, p.totalUsd)) { add("error", "negative_amount", "purse", ref, "an amount is negative or not a number"); drop("purse"); return false; }
    if (p.guaranteedUsd === undefined && p.bonusUsd === undefined && p.totalUsd === undefined) { add("error", "empty_purse", "purse", ref, "no amount given"); drop("purse"); return false; }
    if (!provenance(p, "purse", ref)) return false;
    if (purseKeys.has(ref)) { add("error", "dup_purse", "purse", ref, "the same source gives this fighter's purse for this bout twice"); drop("purse"); return false; }
    purseKeys.add(ref);
    if (!(b.red === p.boxerExternalId || b.blue === p.boxerExternalId)) add("warning", "purse_not_in_bout", "purse", ref, "fighter was not in this bout");
    const total = p.totalUsd ?? (p.guaranteedUsd ?? 0) + (p.bonusUsd ?? 0);
    if (total > MAX_PURSE_USD) add("warning", "implausible_purse", "purse", ref, `$${Math.round(total)} for one fight`);
    if (p.totalUsd !== undefined && p.guaranteedUsd !== undefined && p.totalUsd + 1 < p.guaranteedUsd) add("warning", "purse_total_below_guarantee", "purse", ref, `total $${p.totalUsd} is below the guarantee $${p.guaranteedUsd}`);
    if (p.totalUsd !== undefined && p.guaranteedUsd !== undefined && p.bonusUsd !== undefined && Math.abs(p.guaranteedUsd + p.bonusUsd - p.totalUsd) > Math.max(1000, p.totalUsd * 0.02)) add("warning", "purse_parts_mismatch", "purse", ref, "guarantee + bonus does not equal the total");
    return true;
  });
  const broadcastKeys = new Set<string>();
  const broadcasts = input.broadcasts.filter((b) => {
    const ref = `${b.eventExternalId}/${b.broadcaster}/${b.region ?? ""}/${b.source}`;
    if (!refs.eventIds.has(b.eventExternalId)) { add("error", "bad_reference", "broadcast", ref, `event ${b.eventExternalId} does not exist`); drop("broadcast"); return false; }
    if (!b.broadcaster?.trim()) { add("error", "missing_broadcaster", "broadcast", ref, "broadcaster name is blank"); drop("broadcast"); return false; }
    if (!PLATFORMS.has(b.platform)) { add("error", "bad_platform", "broadcast", ref, `platform "${b.platform}" must be ppv, streaming, subscription or free-tv`); drop("broadcast"); return false; }
    if (!nonNeg(b.viewersAvg, b.viewersPeak)) { add("error", "negative_amount", "broadcast", ref, "an audience figure is negative or not a number"); drop("broadcast"); return false; }
    if (!provenance(b, "broadcast", ref)) return false;
    if (broadcastKeys.has(ref)) { add("error", "dup_broadcast", "broadcast", ref, "duplicate broadcast row"); drop("broadcast"); return false; }
    broadcastKeys.add(ref);
    if (b.viewersAvg !== undefined && b.viewersPeak !== undefined && b.viewersPeak < b.viewersAvg) add("warning", "peak_below_average", "broadcast", ref, `peak ${b.viewersPeak} is below the average ${b.viewersAvg}`);
    if ((b.viewersPeak ?? b.viewersAvg ?? 0) > 400_000_000) add("warning", "implausible_audience", "broadcast", ref, "an audience above 400 million");
    return true;
  });
  const earningKeys = new Set<string>();
  const earnings = input.earnings.filter((e) => {
    const ref = `${e.boxerExternalId}/${e.year}/${e.source}`;
    if (!refs.boxerIds.has(e.boxerExternalId)) { add("error", "bad_reference", "earning", ref, `fighter ${e.boxerExternalId} does not exist`); drop("earning"); return false; }
    if (!Number.isInteger(e.year) || e.year < 1900 || e.year > Number(refs.today.slice(0, 4))) { add("error", "bad_year", "earning", ref, `year ${e.year}`); drop("earning"); return false; }
    if (!nonNeg(e.totalUsd, e.ringUsd, e.offRingUsd) || e.totalUsd === undefined) { add("error", "negative_amount", "earning", ref, "an amount is negative or missing"); drop("earning"); return false; }
    if (!provenance(e, "earning", ref)) return false;
    if (earningKeys.has(ref)) { add("error", "dup_earning", "earning", ref, "the same source gives this fighter's earnings for this year twice"); drop("earning"); return false; }
    earningKeys.add(ref);
    if (e.ringUsd !== undefined && e.offRingUsd !== undefined && Math.abs(e.ringUsd + e.offRingUsd - e.totalUsd) > Math.max(1000, e.totalUsd * 0.02)) add("warning", "earning_parts_mismatch", "earning", ref, "ring + off-ring does not equal the total");
    if (e.totalUsd > MAX_PURSE_USD * 2) add("warning", "implausible_earning", "earning", ref, `$${Math.round(e.totalUsd)} in a year`);
    return true;
  });

  const weighKeys = new Set<string>();
  const weighIns = (input.weighIns ?? []).filter((w) => {
    const ref = `${w.boutExternalId}/${w.boxerExternalId}/${w.source ?? ""}`;
    const b = refs.bouts.get(w.boutExternalId);
    if (!b || !refs.boxerIds.has(w.boxerExternalId)) { add("error", "bad_reference", "weigh_in", ref, "bout or fighter does not exist"); drop("weigh_in"); return false; }
    if (!(b.red === w.boxerExternalId || b.blue === w.boxerExternalId)) { add("error", "weigh_in_not_in_bout", "weigh_in", ref, "the fighter was not in this bout"); drop("weigh_in"); return false; }
    if (!nonNeg(w.officialLb, w.fightNightLb, w.limitLb ?? undefined) || (w.officialLb === undefined && w.fightNightLb === undefined)) { add("error", "bad_weight", "weigh_in", ref, "a weight is negative, not a number or missing"); drop("weigh_in"); return false; }
    if (!provenance({ basis: w.basis ?? "reported", source: w.source, sourceUrl: w.sourceUrl, retrievedAt: w.retrievedAt }, "weigh_in", ref)) return false;
    if (weighKeys.has(ref)) { add("error", "dup_weigh_in", "weigh_in", ref, "the same source gives this fighter's weight for this bout twice"); drop("weigh_in"); return false; }
    weighKeys.add(ref);
    for (const x of [w.officialLb, w.fightNightLb, w.limitLb ?? undefined]) if (x !== undefined && (x < 85 || x > 400)) add("warning", "implausible_weight", "weigh_in", ref, `${x} lb`);
    if (w.officialLb !== undefined && w.fightNightLb !== undefined && w.fightNightLb < w.officialLb - 3) add("warning", "fight_night_below_weigh_in", "weigh_in", ref, `${w.fightNightLb} lb on fight night, ${w.officialLb} lb at the weigh-in`);
    return true;
  });

  for (const [entity, n] of noUrl) add("info", "no_source_url", entity, "*", `${n} ${entity} row${n === 1 ? "" : "s"} ha${n === 1 ? "s" : "ve"} no source URL, so a reader cannot check ${n === 1 ? "it" : "them"}`);
  return { financials, purses, broadcasts, earnings, weighIns };
}
