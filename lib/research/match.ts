import type { DatabaseSync } from "node:sqlite";
import type { MoneyRows } from "../validate-money";
import type { CheckedFact } from "./types";
import { isOfficialHost, nameKey } from "./check";

export interface Unmatched { fact: CheckedFact; reason: string }

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Same boxer under two spellings: identical once folded, or same surname and same first initial ("Floyd Mayweather Jr." / "F. Mayweather"). */
export function sameBoxer(a: string, b: string): boolean {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xp = x.split(" "), yp = y.split(" ");
  return xp[xp.length - 1] === yp[yp.length - 1] && xp[0][0] === yp[0][0] && (xp[0].length === 1 || yp[0].length === 1 || xp[0].startsWith(yp[0]) || yp[0].startsWith(xp[0]));
}

interface BoutRef { bout: string; event: string; date: string; red: { ext: string; name: string }; blue: { ext: string; name: string } }

/**
 * Turns checked facts into money rows that point at the fighters, cards and bouts already in the database. A fact is matched by
 * date (a day either side: cards straddle time zones) and the two fighters' names. Anything that cannot be matched to exactly one
 * bout or fighter is returned, not guessed.
 */
export function matchFacts(db: DatabaseSync, facts: CheckedFact[], opts: { allowSingleSource?: boolean; officialHosts?: string[]; today?: string } = {}): { rows: MoneyRows; used: CheckedFact[]; unmatched: Unmatched[]; held: CheckedFact[] } {
  const rows: MoneyRows = { financials: [], purses: [], broadcasts: [], earnings: [] };
  const used: CheckedFact[] = [], unmatched: Unmatched[] = [], held: CheckedFact[] = [];
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const boutsNear = db.prepare(`SELECT b.external_id bout, e.external_id event, e.date date, r.external_id re, r.name rn, u.external_id ue, u.name un
    FROM bouts b JOIN events e ON e.id = b.event_id JOIN boxers r ON r.id = b.red_id JOIN boxers u ON u.id = b.blue_id WHERE e.date BETWEEN ? AND ?`);
  const boxers = db.prepare("SELECT external_id ext, name FROM boxers");
  let allBoxers: { ext: string; name: string }[] | undefined;

  const findBout = (f: CheckedFact): BoutRef | string => {
    const ev = f.event!;
    const hits = (boutsNear.all(addDays(ev.date, -1), addDays(ev.date, 1)) as { bout: string; event: string; date: string; re: string; rn: string; ue: string; un: string }[])
      .filter((b) => (sameBoxer(b.rn, ev.fighters[0]) && sameBoxer(b.un, ev.fighters[1])) || (sameBoxer(b.rn, ev.fighters[1]) && sameBoxer(b.un, ev.fighters[0])))
      .map((b): BoutRef => ({ bout: b.bout, event: b.event, date: b.date, red: { ext: b.re, name: b.rn }, blue: { ext: b.ue, name: b.un } }));
    return hits.length === 1 ? hits[0] : hits.length ? "more than one bout matches" : "no bout in the database between those fighters on that date";
  };

  // earnings from one list are one row however many outlets repeat the list: first claim wins, later ones only fill gaps
  const earningRow = new Map<string, MoneyRows["earnings"][number]>();
  // the same goes for a card's figures, a purse and a broadcast: one row for each (card or fight, source), whatever number of the source's articles gave a figure (the database holds one row
  // per card and source, and ESPN's gate and ESPN's pay-per-view buys are two claims). The first claim of a figure wins; a later one only fills a gap.
  const finRow = new Map<string, MoneyRows["financials"][number]>(), purseRow = new Map<string, MoneyRows["purses"][number]>(), castRow = new Map<string, MoneyRows["broadcasts"][number]>();
  const fill = <T extends object>(have: T, row: T) => { for (const k of Object.keys(row) as (keyof T)[]) if (have[k] === undefined || have[k] === null) have[k] = row[k]; };

  for (const f of facts) {
    const strong = f.status === "verified" || (!!opts.allowSingleSource && f.status === "single_source");
    // each value stands on its own status, so one disputed value does not hold back the others; older files without per-value status use the claim's
    const valueKeys = Object.keys(f.fields ?? {});
    const says = (k: string) => f.fields?.[k];
    const ok = (k: string) => { const s = says(k); return s ? s === "verified" || (!!opts.allowSingleSource && s === "single_source") : strong; };
    if (valueKeys.length ? !valueKeys.some(ok) : !strong) { held.push(f); continue; }
    const lone = valueKeys.length ? valueKeys.some((k) => ok(k) && says(k) === "single_source") : f.status === "single_source";
    // "disclosed" is only honoured from an official host; anyone else claiming it is reported
    const basis = f.basis === "disclosed" && !(f.doc ? f.doc.official : isOfficialHost(f.host, opts.officialHosts)) ? "reported" : f.basis;
    const note = [f.note, lone ? "single source" : undefined, basis !== f.basis ? (f.doc ? "from a document that is not an official record" : "published by a non-official site") : undefined, f.doc ? `document ${f.doc.file} (sha256 ${f.doc.sha256.slice(0, 12)}), ${f.doc.issuer}, received ${f.doc.receivedAt}${f.doc.form === "transcription" ? ", transcribed" : ""}` : undefined].filter(Boolean).join("; ") || undefined;
    const common = { basis, source: f.source, sourceUrl: f.sourceUrl, retrievedAt: f.accessedAt ?? today, note } as const;
    const num = (k: string) => (typeof f.values[k] === "number" && ok(k) ? (f.values[k] as number) : undefined);

    if (f.kind === "earning") {
      allBoxers ??= boxers.all() as { ext: string; name: string }[];
      const hit = allBoxers.filter((b) => sameBoxer(b.name, f.fighter!));
      if (hit.length !== 1) { unmatched.push({ fact: f, reason: hit.length ? "more than one fighter has that name" : "no such fighter in the database" }); continue; }
      const row = { boxerExternalId: hit[0].ext, year: f.year!, totalUsd: num("totalUsd")!, ringUsd: num("ringUsd"), offRingUsd: num("offRingUsd"), ...common, ...(f.list ? { source: f.list } : {}) };
      const key = f.list ? `${row.boxerExternalId}|${row.year}|${row.source}` : "";
      const have = key ? earningRow.get(key) : undefined;
      if (have) { have.totalUsd ??= row.totalUsd; have.ringUsd ??= row.ringUsd; have.offRingUsd ??= row.offRingUsd; }
      else { rows.earnings.push(row); if (key) earningRow.set(key, row); }
      used.push(f); continue;
    }
    const b = findBout(f);
    if (typeof b === "string") { unmatched.push({ fact: f, reason: b }); continue; }
    if (f.kind === "event_financials") { const row = { eventExternalId: b.event, gateUsd: num("gateUsd"), ticketsSold: num("ticketsSold"), capacity: num("capacity"), siteFeeUsd: num("siteFeeUsd"), ppvBuys: num("ppvBuys"), ppvPriceUsd: num("ppvPriceUsd"), ppvRevenueUsd: num("ppvRevenueUsd"), sponsorshipUsd: num("sponsorshipUsd"), ...common }; const k = `${row.eventExternalId}|${row.source}`, have = finRow.get(k); if (have) fill(have, row); else { rows.financials.push(row); finRow.set(k, row); } }
    else if (f.kind === "purse") {
      const who = sameBoxer(b.red.name, f.fighter!) ? b.red : sameBoxer(b.blue.name, f.fighter!) ? b.blue : null;
      if (!who) { unmatched.push({ fact: f, reason: "the fighter was not in that bout" }); continue; }
      const row = { boutExternalId: b.bout, boxerExternalId: who.ext, guaranteedUsd: num("guaranteedUsd"), bonusUsd: num("bonusUsd"), totalUsd: num("totalUsd"), ...common };
      const k = `${row.boutExternalId}|${row.boxerExternalId}|${row.source}`, have = purseRow.get(k);
      if (have) fill(have, row); else { rows.purses.push(row); purseRow.set(k, row); }
    } else if (f.kind === "broadcast") { const row = { eventExternalId: b.event, broadcaster: String(f.values.broadcaster), platform: String(f.values.platform) as never, region: f.values.region ? String(f.values.region) : undefined, viewersAvg: num("viewersAvg"), viewersPeak: num("viewersPeak"), ...common }; const k = `${row.eventExternalId}|${row.broadcaster}|${row.region ?? ""}|${row.source}`, have = castRow.get(k); if (have) fill(have, row); else { rows.broadcasts.push(row); castRow.set(k, row); } }
    used.push(f);
  }
  return { rows, used, unmatched, held };
}
