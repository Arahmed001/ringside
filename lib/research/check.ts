import crypto from "node:crypto";
import { hostOf, numberStated, squash } from "./text";
import { VALUE_KEYS, type CheckedFact, type FactKind, type FieldStatus, type ResearchFact } from "./types";
import type { FetchOutcome } from "./fetcher";
import type { DocOutcome } from "./documents";
import type { Decision } from "./decisions";

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
  if (f.kind === "earning") return `${nameKey(f.fighter ?? "")}|${f.year}|${nameKey(f.list ?? "")}`;
  if (f.kind === "purse" || f.kind === "weigh_in") return `${eventKey(f)}|${nameKey(f.fighter ?? "")}`;
  if (f.kind === "broadcast") return `${eventKey(f)}|${nameKey(String(f.values.broadcaster ?? ""))}|${nameKey(String(f.values.region ?? ""))}`;
  return eventKey(f);
}

export const factId = (f: ResearchFact) => crypto.createHash("sha1").update(`${f.kind}|${subjectKey(f)}|${f.sourceUrl ?? `document:${f.document}`}|${JSON.stringify(f.values)}`).digest("hex").slice(0, 12);

/** Problems with the claim itself, before anything is fetched. */
export function shapeProblems(f: ResearchFact): string[] {
  const p: string[] = [];
  const kinds: FactKind[] = ["event_financials", "purse", "broadcast", "earning", "weigh_in"];
  if (!kinds.includes(f.kind)) return [`unknown kind "${f.kind}"`];
  const keys = VALUE_KEYS[f.kind];
  if (f.kind !== "earning" && f.kind !== undefined) {
    if (!f.event?.name || !ISO.test(f.event.date ?? "") || !Array.isArray(f.event.fighters) || f.event.fighters.length < 2) p.push("event needs name, date (yyyy-mm-dd) and both main-event fighters");
  }
  if ((f.kind === "purse" || f.kind === "weigh_in") && !f.fighter) p.push(`${f.kind === "purse" ? "purse" : "weigh_in"} needs the fighter`);
  if (f.list !== undefined && (f.kind !== "earning" || typeof f.list !== "string" || !f.list.trim())) p.push("list is only for earnings and must name the ranking");
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
  if (f.sourceUrl !== undefined && f.document !== undefined) p.push("give a sourceUrl or a document, not both");
  else if (f.document !== undefined) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(f.document) || f.document.includes("..")) p.push("document must be the plain name of a registered document"); }
  else if (!/^https?:\/\//.test(f.sourceUrl ?? "")) p.push("sourceUrl must be an http(s) link (or name a registered document)");
  if (!f.quote?.trim()) p.push("quote is required: the exact words from the page");
  else if (f.quote.split(/\s+/).length > 80) p.push("quote is too long: copy only the passage that holds the figure (about 40 words)");
  return p;
}

export type PageGetter = (url: string) => Promise<FetchOutcome>;

export type DocumentGetter = (name: string) => DocOutcome;
export interface CheckOptions { getPage: PageGetter; getDocument?: DocumentGetter; officialHosts?: string[]; tolerance?: number; decisions?: Decision[] }

/**
 * Checks every claim and decides what can be published.
 * 1. The claim must be well formed.
 * 2. The page is fetched again, here, by code: the quote must be on it, word for word, and every number claimed must be stated in the quote.
 * 3. Figures are grouped by what they describe. Two independent sites (at least one not Wikipedia) within 5% of each other, or one official
 *    (.gov) record, make it verified; a lone source is single_source; sites that disagree make a conflict. Earnings are only compared
 *    within one published list (Forbes, Sportico ...), since lists cover different periods.
 * 4. A recorded decision (decisions.ts) can take a claim, or some of its values, out of that comparison; the rest is judged as usual.
 *    Each value has its own status, so one disputed value no longer holds back the others on the same claim.
 */
export async function checkFacts(input: ResearchFact[], opts: CheckOptions): Promise<CheckedFact[]> {
  const tolOf = (kind: string) => opts.tolerance ?? (kind === "weigh_in" ? 0.005 : 0.05); // a weight is read to the pound: 5% (7 lb at welterweight) would call 140 and 147 the same
  const out: CheckedFact[] = [];
  const pages = new Map<string, Promise<FetchOutcome>>();
  const page = (u: string) => pages.get(u) ?? pages.set(u, opts.getPage(u)).get(u)!;

  for (const f of input) {
    const c: CheckedFact = { ...f, id: factId(f), host: f.document !== undefined ? "" : hostOf(f.sourceUrl ?? ""), status: "single_source", reasons: [] };
    const bad = shapeProblems(f);
    if (bad.length) { c.status = "invalid"; c.reasons = bad; out.push(c); continue; }
    let res: { ok: true; text: string } | { ok: false; reason: string; detail: string };
    if (f.document !== undefined) { // evidence that is a file: proven by the hash recorded when a person registered it
      const d: DocOutcome | { ok: false; reason: string; detail: string } = opts.getDocument?.(f.document) ?? { ok: false, reason: "no-store", detail: "no document store was given to the checker" };
      if (d.ok) {
        // the issuer's domain stands in for the host, so a document and a page from the same issuer count as one source
        c.host = hostOf(`https://${d.entry.issuerHost}/`) || d.entry.issuerHost;
        c.doc = { file: d.entry.file, sha256: d.entry.sha256, issuer: d.entry.issuer, receivedAt: d.entry.receivedAt, official: d.entry.official && d.entry.form === "original", form: d.entry.form };
      }
      res = d;
    } else res = await page(f.sourceUrl!);
    const noun = f.document !== undefined ? "document" : "page";
    if (!res.ok) { c.status = "unconfirmed"; c.reasons = [`could not read the ${noun}: ${res.reason}: ${res.detail}`]; out.push(c); continue; }
    if (!squash(res.text).includes(squash(f.quote))) { c.status = "unconfirmed"; c.reasons = [`the quote is not in the ${noun} (word for word)`]; out.push(c); continue; }
    const missing = Object.entries(f.values).filter(([, v]) => typeof v === "number" && !numberStated(v, f.quote)).map(([k]) => k);
    if (missing.length) { c.status = "unconfirmed"; c.reasons = [`the quote does not state: ${missing.join(", ")}`]; out.push(c); continue; }
    const textVals = Object.entries(f.values).filter(([k, v]) => typeof v === "string" && k === "broadcaster" && !squash(f.quote).includes(squash(String(v))));
    if (textVals.length) { c.status = "unconfirmed"; c.reasons = ["the broadcaster is not named in the quote"]; out.push(c); continue; }
    out.push(c);
  }

  // cross-source agreement, field by field, among the claims whose quotes held up
  const live = out.filter((c) => c.status === "single_source");
  // values taken out of the comparison by a recorded decision: claim id -> field -> the decision
  const excluded = new Map<string, Map<string, Decision>>();
  for (const d of opts.decisions ?? []) for (const id of d.claims) {
    const c = live.find((x) => x.id === id);
    if (!c) continue;
    for (const k of d.fields ?? Object.keys(c.values)) if (typeof c.values[k] === "number") (excluded.get(id) ?? excluded.set(id, new Map()).get(id)!).set(k, d);
  }
  const groups = new Map<string, CheckedFact[]>();
  for (const c of live) {
    for (const [k, v] of Object.entries(c.values)) {
      if (typeof v !== "number" || excluded.get(c.id)?.has(k)) continue;
      const key = `${c.kind}|${subjectKey(c)}|${k}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
    }
  }
  const fieldStatus = new Map<string, Map<string, "verified" | "single_source" | "conflict">>(); // fact id -> field -> status
  const mark = (id: string, field: string, s: "verified" | "single_source" | "conflict") => (fieldStatus.get(id) ?? fieldStatus.set(id, new Map()).get(id)!).set(field, s);
  const withinKind = (kind: string) => (a: number, b: number) => (Math.max(a, b) === 0 ? true : Math.abs(a - b) / Math.max(a, b) <= tolOf(kind));
  for (const [key, members] of groups) {
    const field = key.split("|").pop()!;
    const within = withinKind(members[0].kind);
    const byHost = new Map<string, CheckedFact[]>();
    for (const m of members) (byHost.get(m.host) ?? byHost.set(m.host, []).get(m.host)!).push(m);
    const val = (m: CheckedFact) => m.values[field] as number;
    const reps = [...byHost.values()].map((l) => l[0]);
    const official = (m: CheckedFact) => m.basis === "disclosed" && (m.doc ? m.doc.official : isOfficialHost(m.host, opts.officialHosts));
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
    const gone = excluded.get(c.id);
    c.fields = Object.fromEntries([...fs, ...[...(gone?.keys() ?? [])].map((k): [string, FieldStatus] => [k, "excluded"])]);
    if (gone) { const d = [...gone.values()][0]; c.decision = { reason: d.reason, why: d.why, decidedBy: d.decidedBy, date: d.date, ...(d.fields ? { fields: d.fields } : {}) }; }
    if (!all.length && gone) { c.status = "excluded"; c.reasons = [`excluded (${c.decision!.why}): ${c.decision!.reason}`]; continue; }
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
