/**
 * The money-research pipeline. Researchers (Claude agents browsing the web, or the extraction bot) drop claims into data/research/inbox/*.jsonl;
 * this script re-fetches every source and decides what can be published. See docs/research.md.
 *
 *   npm run research -- lint [files...]         offline shape check of the claims and of data/research/decisions.jsonl (no network)
 *   npm run research -- check [files...]        confirm quotes on the live pages, cross-check sources -> data/research/checked.jsonl
 *   npm run research -- report                  counts by status, kind and site
 *   npm run research -- promote [--allow-single-source]   match verified facts to the database -> data/research/money-feed.json
 *   npm run research -- apply                   write money-feed.json into the database
 *   npm run research -- extract --url U --event "Name|2015-05-02|Fighter A;Fighter B" --want event_financials,purse   (the bot; needs ANTHROPIC_API_KEY)
 *   npm run research -- fetch URL [--grep WORD | --full]   what the polite fetcher sees at a URL (the first 1,500 characters, the lines holding WORD, or all of it)
 *   npm run research -- add-document FILE --issuer "California State Athletic Commission" --issuer-host dca.ca.gov --received 2026-10-10 --how "public-records response" [--official] [--transcription]
 *                                               register a document you placed in data/research/manual/ (hash recorded); claims then say "document": "FILE" instead of a URL
 *   npm run research -- documents               every registered document and whether it still matches its hash
 * Needs RESEARCH_CONTACT (an email or URL for the User-Agent) in .env.local to touch the network (claims that name a document need no network).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { checkFacts, report, shapeProblems } from "../lib/research/check";
import { PoliteFetcher } from "../lib/research/fetcher";
import { matchFacts } from "../lib/research/match";
import { extractFromPage } from "../lib/research/extract";
import { ask, loadEnv } from "../lib/i18n/translate";
import { ingestMoney } from "../lib/ingest-money";
import { decisionProblems, staleDecisions, type Decision } from "../lib/research/decisions";
import { loadManifest, readDocument, registerDocument } from "../lib/research/documents";
import { officialHostList } from "../lib/research/official-hosts";
import type { CheckedFact, FactKind, ResearchFact } from "../lib/research/types";

const DIR = process.env.RESEARCH_DIR ?? path.join(process.cwd(), "data", "research"); // RESEARCH_DIR is for the tests
const MANUAL = path.join(DIR, "manual");
const INBOX = path.join(DIR, "inbox"), DECISIONS = path.join(DIR, "decisions.jsonl"), CHECKED = path.join(DIR, "checked.jsonl"), FEED = path.join(DIR, "money-feed.json");
const readJsonl = <T,>(f: string): T[] => fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l) as T; } catch { throw new Error(`${f}:${i + 1} is not valid JSON`); } });
const decisions = (): Decision[] => (fs.existsSync(DECISIONS) ? readJsonl<Decision>(DECISIONS) : []);
const officialHosts = () => officialHostList(DIR);

function fetcher() {
  loadEnv();
  if (!process.env.RESEARCH_CONTACT) throw new Error("Set RESEARCH_CONTACT (an email address or website where site owners can reach you) in .env.local. It goes in the bot's User-Agent; use your own, never someone else's.");
  return new PoliteFetcher({ contact: process.env.RESEARCH_CONTACT, cacheDir: path.join(DIR, "cache"), delayMs: Number(process.env.RESEARCH_DELAY_MS ?? 3000), extraBlocked: (process.env.RESEARCH_BLOCKLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean) });
}
const FLAGS_WITH_VALUE = new Set(["url", "event", "fighter", "year", "want", "issuer", "issuer-host", "received", "how"]);
const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) { const k = argv[i].slice(2); if (FLAGS_WITH_VALUE.has(k)) flags.set(k, argv[++i]); else flags.set(k, "true"); } else positional.push(argv[i]);
}
const arg = (k: string) => flags.get(k);

async function main() {
  const [cmd, ...rest] = positional;
  fs.mkdirSync(INBOX, { recursive: true });
  if (cmd === "lint") { // offline: only the shape of each claim, for researchers to self-check before handing in
    const files = rest.length ? rest : fs.readdirSync(INBOX).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(INBOX, f));
    let bad = 0, n = 0;
    const registered = new Set(loadManifest(MANUAL).map((e) => e.file));
    for (const f of files) readJsonl<ResearchFact>(f).forEach((c, i) => {
      n++;
      const p = shapeProblems(c);
      if (c.document !== undefined && !p.length && !registered.has(c.document)) p.push(`document ${c.document} is not registered (npm run research -- add-document)`);
      if (p.length) { bad++; console.log(`${path.basename(f)}:${i + 1} ${p.join(" | ")}`); }
    });
    const ds = decisions();
    ds.forEach((d, i) => { const p = decisionProblems(d); if (p.length) { bad++; console.log(`decisions.jsonl:${i + 1} ${p.join(" | ")}`); } });
    console.log(`${n} claims, ${ds.length} decisions, ${bad} malformed`);
    process.exit(bad ? 1 : 0);
  }
  if (cmd === "check") {
    const files = rest.length ? rest : fs.readdirSync(INBOX).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(INBOX, f));
    const facts = files.flatMap((f) => readJsonl<ResearchFact>(f));
    let f: PoliteFetcher | undefined; // only built when a claim needs the web: a run over documents alone needs no contact and no network
    const ds = decisions();
    const badDecision = ds.flatMap((d, i) => decisionProblems(d).map((p) => `decisions.jsonl:${i + 1} ${p}`));
    if (badDecision.length) throw new Error(`fix the decisions first:\n${badDecision.join("\n")}`);
    const checked = await checkFacts(facts, { getPage: (u) => (f ??= fetcher()).get(u), getDocument: (name) => readDocument(MANUAL, name), officialHosts: officialHosts(), decisions: ds });
    for (const x of staleDecisions(ds, checked)) console.log(`STALE decision (${x.decision.why}, ${x.decision.date}): no claim ${x.missing.join(", ")}; the claim was edited or removed, so this decision applies to nothing`);
    fs.writeFileSync(CHECKED, checked.map((c) => JSON.stringify(c)).join("\n") + "\n");
    const r = report(checked);
    console.log(`${r.total} claims from ${files.length} file(s):`, r.byStatus);
    for (const c of checked.filter((x) => x.status !== "verified").slice(0, 25)) console.log(`  ${c.status.padEnd(13)} ${c.kind} ${c.event?.name ?? c.fighter} (${c.host}): ${c.reasons[0]}`);
  } else if (cmd === "report") {
    const r = report(readJsonl<CheckedFact>(CHECKED));
    console.log(JSON.stringify(r, null, 1));
  } else if (cmd === "markdown") { // a readable digest of what has been verified, for people
    const facts = readJsonl<CheckedFact>(CHECKED);
    const fmt = (k: string, v: number | string) => (typeof v === "string" ? v : /Usd$/.test(k) ? `$${v.toLocaleString("en-US")}` : v.toLocaleString("en-US"));
    const by = new Map<string, CheckedFact[]>();
    for (const f of facts.filter((x) => ["verified", "conflict", "single_source", "excluded"].includes(x.status) || x.fields)) {
      const key = f.kind === "earning" ? `Earnings · ${f.fighter} · ${f.year}${f.list ? ` · ${f.list}` : ""}` : `${f.event!.date} · ${f.event!.fighters.join(" vs ")}`;
      (by.get(key) ?? by.set(key, []).get(key)!).push(f);
    }
    const r = report(facts);
    const lines = ["# Researched fight money (generated by `npm run research -- markdown`)", "", `${r.total} claims checked: ${Object.entries(r.byStatus).map(([k, v]) => `${v} ${k}`).join(", ")}. Verified = quote confirmed on the live page by code and two independent sites (or one official record) agree within 5%. Excluded = taken out of the comparison by a recorded decision (listed at the end, with the reason and evidence). Amounts in US dollars as published (nominal).`, ""];
    for (const key of [...by.keys()].sort()) {
      lines.push(`## ${key}`, "");
      const rows = new Map<string, { f: CheckedFact; v: number | string; st: string }[]>();
      for (const f of by.get(key)!) for (const [k, v] of Object.entries(f.values)) {
        if (f.kind === "broadcast" && typeof v === "string") continue;
        const lab = f.kind === "purse" ? `${f.fighter} ${k}` : f.kind === "broadcast" ? `${f.values.broadcaster} ${k}` : k;
        (rows.get(lab) ?? rows.set(lab, []).get(lab)!).push({ f, v, st: f.fields?.[k] ?? f.status });
      }
      for (const [lab, items] of [...rows].sort()) {
        const live = items.filter((x) => x.st !== "excluded");
        const stat = live.some((x) => x.st === "conflict") ? "CONFLICT" : live.some((x) => x.st === "verified") ? "verified" : live.length ? "single source" : "excluded";
        const one = (x: (typeof items)[number]) => `${fmt(lab, x.v)} (${x.f.host}${x.f.doc ? `, document ${x.f.doc.file}` : ""}${x.f.basis === "disclosed" && (x.f.doc ? x.f.doc.official : true) ? ", official" : ""}${x.st === "excluded" ? `, excluded: ${x.f.decision?.why}` : ""})`;
        lines.push(`- **${lab}**: ${items.map(one).join("; ")}: ${stat}`);
      }
      lines.push("");
    }
    const made = decisions();
    if (made.length) {
      lines.push("## Decisions", "", "Each took a figure out of the cross-check; nothing was added by hand. A figure still needs two independent sources to be verified.", "");
      const byId = new Map(facts.map((f) => [f.id, f]));
      for (const d of made) {
        const who = d.claims.map((id) => byId.get(id)).filter(Boolean).map((f) => `${f!.host} ${Object.entries(f!.values).filter(([k]) => !d.fields || d.fields.includes(k)).map(([k, v]) => `${k} ${fmt(k, v)}`).join(", ")} (${f!.kind === "earning" ? `${f!.fighter} ${f!.year}` : f!.event!.fighters.join(" vs ")})`).join("; ");
        lines.push(`- **${d.why}**, ${d.date}, ${d.decidedBy}: ${who || "claim no longer present"}. ${d.reason} Evidence: ${d.evidence.join(", ")}`);
      }
      lines.push("");
    }
    fs.writeFileSync(path.join(process.cwd(), "docs", "research-results.md"), lines.join("\n"));
    console.log(`docs/research-results.md: ${by.size} subjects`);
  } else if (cmd === "promote") {
    const db = new DatabaseSync(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db"));
    const m = matchFacts(db, readJsonl<CheckedFact>(CHECKED), { allowSingleSource: flags.has("allow-single-source"), officialHosts: officialHosts() });
    fs.writeFileSync(FEED, JSON.stringify(m.rows, null, 1));
    console.log(`matched ${m.used.length} facts into ${FEED}: ${m.rows.financials.length} financials, ${m.rows.purses.length} purses, ${m.rows.broadcasts.length} broadcasts, ${m.rows.earnings.length} earnings, ${(m.rows.weighIns ?? []).length} weigh-ins`);
    console.log(`held back ${m.held.length} (not verified), could not match ${m.unmatched.length}${m.unmatched.length ? ":" : ""}`);
    for (const u of m.unmatched.slice(0, 20)) console.log(`  ${u.fact.kind} ${u.fact.event?.name ?? u.fact.fighter}: ${u.reason}`);
  } else if (cmd === "apply") {
    const db = await (await import("../lib/db")).getDb(); // opened the usual way, so a file older than the code gains the columns the new rows need
    const rows = JSON.parse(fs.readFileSync(FEED, "utf8"));
    const r = ingestMoney(db, rows, { label: "research" });
    console.log("written", r.written, "dropped", r.dropped, `${r.issues.length} issue(s)`);
    for (const i of r.issues.filter((x) => x.severity !== "info").slice(0, 15)) console.log(`  ${i.severity} ${i.code} ${i.ref}: ${i.message}`);
  } else if (cmd === "add-document") {
    const file = rest[0];
    if (!file) throw new Error('usage: add-document FILE --issuer "Who issued it" --issuer-host dca.ca.gov --received yyyy-mm-dd --how "public-records response" [--official] [--transcription]   (FILE is already in data/research/manual/)');
    fs.mkdirSync(MANUAL, { recursive: true });
    const e = registerDocument(MANUAL, { file, issuer: arg("issuer") ?? "", issuerHost: arg("issuer-host") ?? "", receivedAt: arg("received") ?? "", how: arg("how") ?? "", official: flags.has("official"), form: flags.has("transcription") ? "transcription" : "original" });
    console.log(`registered ${e.file}: sha256 ${e.sha256.slice(0, 16)}..., ${e.issuer} (${e.issuerHost}), received ${e.receivedAt}, ${e.official ? "an official record" : e.form === "transcription" ? "a transcription (never official)" : "not marked official"}${e.text ? `; text taken with ${e.text.via} into ${e.text.file}` : ""}`);
    console.log("Commit data/research/manual/manifest.jsonl (the hash and who issued it). Keep the document itself where you keep records: it is not needed to read the manifest, only to check a claim.");
  } else if (cmd === "documents") {
    const all = loadManifest(MANUAL);
    if (!all.length) console.log("no documents registered");
    for (const e of all) { const r = readDocument(MANUAL, e.file); console.log(`${r.ok ? "ok     " : "PROBLEM"} ${e.file}  ${e.issuer} (${e.issuerHost}), received ${e.receivedAt}, ${e.official ? "official" : e.form}${r.ok ? "" : `: ${r.detail}`}`); }
    process.exitCode = all.some((e) => !readDocument(MANUAL, e.file).ok) ? 1 : 0;
  } else if (cmd === "fetch") {
    const r = await fetcher().get(rest[0]);
    const g = arg("grep"); // --grep WORD: the whole lines that hold the word, to copy a quote from; --full: the whole text
    console.log(r.ok ? `${r.status}${r.fromCache ? " (cache)" : ""}, ${r.text.length} characters\n${g ? r.text.split("\n").filter((l) => l.toLowerCase().includes(g.toLowerCase())).join("\n") : process.argv.includes("--full") ? r.text : r.text.slice(0, 1500)}` : `not fetched: ${r.reason}: ${r.detail}`);
  } else if (cmd === "extract") {
    const url = arg("url"), ev = arg("event"), fighter = arg("fighter");
    if (!url || (!ev && !fighter)) throw new Error('usage: extract --url U (--event "Name|yyyy-mm-dd|Fighter A;Fighter B" | --fighter "Name" --year 2024) [--want event_financials,purse,broadcast,earning]');
    const [name, date, fighters] = (ev ?? "").split("|");
    const want = (arg("want") ?? "event_financials,purse,broadcast").split(",") as FactKind[];
    const page = await fetcher().get(url);
    if (!page.ok) throw new Error(`not fetched: ${page.reason}: ${page.detail}`);
    const { facts, dropped } = await extractFromPage({ ask, text: page.text, url, task: { event: ev ? { name, date, fighters: fighters.split(";") } : undefined, fighter, year: arg("year") ? Number(arg("year")) : undefined, want } });
    fs.appendFileSync(path.join(INBOX, "bot.jsonl"), facts.map((f) => JSON.stringify(f)).join("\n") + (facts.length ? "\n" : ""));
    console.log(`${facts.length} facts added to inbox/bot.jsonl; ${dropped} dropped because their quote is not on the page. Now run: npm run research -- check`);
  } else { console.error("usage: lint | check | report | promote | apply | extract | fetch | add-document | documents (see the header of scripts/research.ts)"); process.exit(2); }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
