import crypto from "node:crypto";
import { hostOf, numberStated, squash } from "./text";
import { VALUE_KEYS, type CheckedFact, type FactKind, type ResearchFact } from "./types";
import type { FetchOutcome } from "./fetcher";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PLATFORMS = new Set(["ppv", "streaming", "subscription", "free-tv"]);
const BASES = new Set(["disclosed", "reported", "estimated"]);
/** Domains whose own figures count as official on their own. */
const OFFICIAL = [/\.gov$/, /\.gov\.[a-z]{2}$/, /^sec\.gov$/];
export const isOfficialHost = (host: string, extra: string[] = []) => OFFICIAL.some((re) => re.test(host)) || extra.includes(host);

/** Folds a boxer's name to what two sources would agree on: no accents, no Jr/Sr/III, no punctuation. */
export const nameKey = (s: string) => squash(s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")).replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const surname = (s: string) => nameKey(s).split(" ").filter(Boolean).slice(-1)[0] ?? "";

/** Same card, whichever way each source names it: the date and the main-event surnames. */
export const eventKey = (f: ResearchFact): string =>
  f.event ? `${f.event.date}|${[...f.event.fighters].map(surname).sort().join("+") || nameKey(f.event.name)}` : "";

function subjectKey(f: ResearchFact): string {
  if (f.kind === "earning") return `${nameKey(f.fighter ?? "")}|${f.year}`;
  if (f.kind === "purse") return `${eventKey(f)}|${nameKey(f.fighter ?? "")}`;
  if (f.kind === "broadcast") return `${eventKey(f)}|${nameKey(String(f.values.broadcaster ?? ""))}|${nameKey(String(f.values.region ?? ""))}`;
  return eventKey(f);
}

export const factId = (f: ResearchFact) => crypto.createHash("sha1").update(`${f.kind}|${subjectKey(f)}|${f.sourceUrl}|${JSON.stringify(f.values)}`).digest("hex").slice(0, 12);

/** Problems with the claim itself, before anything is fetched. */
export function shapeProblems(f: ResearchFact): string[] {
  const p: string[] = [];
  const kinds: FactKind[] = ["event_financials", "purse", "broadcast", "earning"];
  if (!kinds.includes(f.kind)) return [`unknown kind "${f.kind}"`];
  const keys = VALUE_KEYS[f.kind];
  if (f.kind !== "earning" && f.kind !== undefined) {
    if (!f.event?.name || !ISO.test(f.event.date ?? "") || !Array.isArray(f.event.fighters) || f.event.fighters.length < 2) p.push("event needs name, date (yyyy-mm-dd) and both main-event fighters");
  }
  if (f.kind === "purse" && !f.fighter) p.push("purse needs the fighter");
  if (f.kind === "earning" && (!f.fighter || !Number.isInteger(f.year) || (f.year as number) < 1900)) p.push("earning needs fighter and year");
  if (!f.values || typeof f.values !== "object" || !Object.keys(f.values).length) p.push("no values");
  for (const [k, v] of Object.entries(f.values ?? {})) {
    if (keys.numeric.includes(k)) { if (typeof v !== "number" || !Number.isFinite(v) || v < 0) p.push(`${k} must be a non-negative number (got ${JSON.stringify(v)})`); }
    else if (keys.text.includes(k)) { if (typeof v !== "string" || !v.trim()) p.push(`${k} must be text`); }
    else p.push(`unknown value "${k}" for ${f.kind}`);
  }
  if (f.kind === "broadcast" && (!f.values?.broadcaster || !PLATFORMS.has(String(f.values.platform)))) p.push("broadcast needs broadcaster and platform (ppv, streaming, subscription or free-tv)");
  if (!BASES.has(f.basis)) p.push("basis must be disclosed, reported or estimated");
  if (!f.source?.trim()) p.push("source is required");
  if (!/^https?:\/\//.test(f.sourceUrl ?? "")) p.push("sourceUrl must be an http(s) link");
  if (!f.quote?.trim()) p.push("quote is required: the exact words from the page");
  else if (f.quote.split(/\s+/).length > 80) p.push("quote is too long: copy only the passage that holds the figure (about 40 words)");
  return p;
}

export type PageGetter = (url: string) => Promise<FetchOutcome>;

export interface CheckOptions { getPage: PageGetter; officialHosts?: string[]; tolerance?: number }

/**
 * Checks every claim and decides what can be published.
 * 1. The claim must be well formed.
 * 2. The page is fetched again, here, by code: the quote must be on it, word for word, and every number claimed must be stated in the quote.
 * 3. Figures are grouped by what they describe. Two independent sites (at least one not Wikipedia) within 5% of each other, or one official
 *    (.gov) record, make it verified; a lone source is single_source; sites that disagree make a conflict.
 */
export async function checkFacts(input: ResearchFact[], opts: CheckOptions): Promise<CheckedFact[]> {
  const tol = opts.tolerance ?? 0.05;
  const out: CheckedFact[] = [];
  const pages = new Map<string, Promise<FetchOutcome>>();
  const page = (u: string) => pages.get(u) ?? pages.set(u, opts.getPage(u)).get(u)!;

  for (const f of input) {
    const c: CheckedFact = { ...f, id: factId(f), host: hostOf(f.sourceUrl ?? ""), status: "single_source", reasons: [] };
    const bad = shapeProblems(f);
    if (bad.length) { c.status = "invalid"; c.reasons = bad; out.push(c); continue; }
    const res = await page(f.sourceUrl);
    if (!res.ok) { c.status = "unconfirmed"; c.reasons = [`could not read the page: ${res.reason}: ${res.detail}`]; out.push(c); continue; }
    if (!squash(res.text).includes(squash(f.quote))) { c.status = "unconfirmed"; c.reasons = ["the quote is not on the page (word for word)"]; out.push(c); continue; }
    const missing = Object.entries(f.values).filter(([, v]) => typeof v === "number" && !numberStated(v, f.quote)).map(([k]) => k);
    if (missing.length) { c.status = "unconfirmed"; c.reasons = [`the quote does not state: ${missing.join(", ")}`]; out.push(c); continue; }
    const textVals = Object.entries(f.values).filter(([k, v]) => typeof v === "string" && k === "broadcaster" && !squash(f.quote).includes(squash(String(v))));
    if (textVals.length) { c.status = "unconfirmed"; c.reasons = ["the broadcaster is not named in the quote"]; out.push(c); continue; }
    out.push(c);
  }

  // cross-source agreement, field by field, among the claims whose quotes held up
  const live = out.filter((c) => c.status === "single_source");
  const groups = new Map<string, CheckedFact[]>();
  for (const c of live) {
    for (const [k, v] of Object.entries(c.values)) {
      if (typeof v !== "number") continue;
      const key = `${c.kind}|${subjectKey(c)}|${k}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
    }
  }
  const fieldStatus = new Map<string, Map<string, "verified" | "single_source" | "conflict">>(); // fact id -> field -> status
  const mark = (id: string, field: string, s: "verified" | "single_source" | "conflict") => (fieldStatus.get(id) ?? fieldStatus.set(id, new Map()).get(id)!).set(field, s);
  const within = (a: number, b: number) => (Math.max(a, b) === 0 ? true : Math.abs(a - b) / Math.max(a, b) <= tol);
  for (const [key, members] of groups) {
    const field = key.split("|").pop()!;
    const byHost = new Map<string, CheckedFact[]>();
    for (const m of members) (byHost.get(m.host) ?? byHost.set(m.host, []).get(m.host)!).push(m);
    const val = (m: CheckedFact) => m.values[field] as number;
    const reps = [...byHost.values()].map((l) => l[0]);
    const official = (m: CheckedFact) => m.basis === "disclosed" && isOfficialHost(m.host, opts.officialHosts);
    // the biggest set of hosts that agree with one another
    let cluster: CheckedFact[] = [];
    for (const r of reps) { const c = reps.filter((o) => within(val(o), val(r))); if (c.length > cluster.length) cluster = c; }
    const decided = cluster.length >= 2 && cluster.some((m) => !/(^|\.)(wikipedia|wikidata)\.org$/.test(m.host));
    for (const m of members) {
      const inCluster = cluster.some((c) => c.host === m.host) && within(val(m), val(cluster[0]));
      if (reps.length === 1) mark(m.id, field, official(m) ? "verified" : "single_source");
      else if (decided) {
        if (inCluster) { mark(m.id, field, "verified"); m.agreeing = cluster.filter((c) => c.host !== m.host).map((c) => c.host); } else mark(m.id, field, "conflict");
      } else {
        const officials = reps.filter(official);
        if (officials.length === 1 && official(m) && reps.every((r) => r === m || !official(r))) mark(m.id, field, "verified");
        else mark(m.id, field, "conflict");
      }
    }
  }
  for (const c of live) {
    const fs = [...(fieldStatus.get(c.id)?.entries() ?? [])];
    const all = fs.map(([, s]) => s);
    if (all.includes("conflict")) {
      c.status = "conflict";
      c.reasons = fs.filter(([, s]) => s === "conflict").map(([k]) => {
        const others = (groups.get(`${c.kind}|${subjectKey(c)}|${k}`) ?? []).filter((m) => m.host !== c.host).map((m) => `${m.host}: ${m.values[k]}`);
        return `${k} = ${c.values[k]} here but ${others.join("; ")}`;
      });
    } else if (all.length && all.every((s) => s === "verified")) { c.status = "verified"; c.reasons = c.agreeing?.length ? [`also stated by ${c.agreeing.join(", ")}`] : ["official record"]; }
    else c.reasons = ["only one source states this"];
  }
  return out;
}

export interface Report { total: number; byStatus: Record<string, number>; byKind: Record<string, number>; hosts: Record<string, { total: number; verified: number; unconfirmed: number }> }
export function report(facts: CheckedFact[]): Report {
  const r: Report = { total: facts.length, byStatus: {}, byKind: {}, hosts: {} };
  for (const f of facts) {
    r.byStatus[f.status] = (r.byStatus[f.status] ?? 0) + 1; r.byKind[f.kind] = (r.byKind[f.kind] ?? 0) + 1;
    const h = (r.hosts[f.host] ??= { total: 0, verified: 0, unconfirmed: 0 }); h.total++; if (f.status === "verified") h.verified++; if (f.status === "unconfirmed") h.unconfirmed++;
  }
  return r;
}
