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
 *   npm run research -- fetch URL               what the polite fetcher sees at a URL
 * Needs RESEARCH_CONTACT (an email or URL for the User-Agent) in .env.local to touch the network.
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
import type { CheckedFact, FactKind, ResearchFact } from "../lib/research/types";

const DIR = path.join(process.cwd(), "data", "research");
const INBOX = path.join(DIR, "inbox"), DECISIONS = path.join(DIR, "decisions.jsonl"), CHECKED = path.join(DIR, "checked.jsonl"), FEED = path.join(DIR, "money-feed.json");
const readJsonl = <T,>(f: string): T[] => fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l) as T; } catch { throw new Error(`${f}:${i + 1} is not valid JSON`); } });
const decisions = (): Decision[] => (fs.existsSync(DECISIONS) ? readJsonl<Decision>(DECISIONS) : []);
const officialHosts = () => { const f = path.join(DIR, "official-hosts.txt"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : []; };

function fetcher() {
  loadEnv();
  if (!process.env.RESEARCH_CONTACT) throw new Error("Set RESEARCH_CONTACT (an email address or website where site owners can reach you) in .env.local. It goes in the bot's User-Agent; use your own, never someone else's.");
  return new PoliteFetcher({ contact: process.env.RESEARCH_CONTACT, cacheDir: path.join(DIR, "cache"), delayMs: Number(process.env.RESEARCH_DELAY_MS ?? 3000), extraBlocked: (process.env.RESEARCH_BLOCKLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean) });
}
const FLAGS_WITH_VALUE = new Set(["url", "event", "fighter", "year", "want"]);
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
    for (const f of files) readJsonl<ResearchFact>(f).forEach((c, i) => { n++; const p = shapeProblems(c); if (p.length) { bad++; console.log(`${path.basename(f)}:${i + 1} ${p.join(" | ")}`); } });
    const ds = decisions();
    ds.forEach((d, i) => { const p = decisionProblems(d); if (p.length) { bad++; console.log(`decisions.jsonl:${i + 1} ${p.join(" | ")}`); } });
    console.log(`${n} claims, ${ds.length} decisions, ${bad} malformed`);
    process.exit(bad ? 1 : 0);
  }
  if (cmd === "check") {
    const files = rest.length ? rest : fs.readdirSync(INBOX).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(INBOX, f));
    const facts = files.flatMap((f) => readJsonl<ResearchFact>(f));
    const f = fetcher();
    const ds = decisions();
    const badDecision = ds.flatMap((d, i) => decisionProblems(d).map((p) => `decisions.jsonl:${i + 1} ${p}`));
    if (badDecision.length) throw new Error(`fix the decisions first:\n${badDecision.join("\n")}`);
    const checked = await checkFacts(facts, { getPage: (u) => f.get(u), officialHosts: officialHosts(), decisions: ds });
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
        const one = (x: (typeof items)[number]) => `${fmt(lab, x.v)} (${x.f.host}${x.f.basis === "disclosed" ? ", official" : ""}${x.st === "excluded" ? `, excluded: ${x.f.decision?.why}` : ""})`;
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
    console.log(`matched ${m.used.length} facts into ${FEED}: ${m.rows.financials.length} financials, ${m.rows.purses.length} purses, ${m.rows.broadcasts.length} broadcasts, ${m.rows.earnings.length} earnings`);
    console.log(`held back ${m.held.length} (not verified), could not match ${m.unmatched.length}${m.unmatched.length ? ":" : ""}`);
    for (const u of m.unmatched.slice(0, 20)) console.log(`  ${u.fact.kind} ${u.fact.event?.name ?? u.fact.fighter}: ${u.reason}`);
  } else if (cmd === "apply") {
    const db = new DatabaseSync(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db"));
    const rows = JSON.parse(fs.readFileSync(FEED, "utf8"));
    const r = ingestMoney(db, rows, { label: "research" });
    console.log("written", r.written, "dropped", r.dropped, `${r.issues.length} issue(s)`);
    for (const i of r.issues.filter((x) => x.severity !== "info").slice(0, 15)) console.log(`  ${i.severity} ${i.code} ${i.ref}: ${i.message}`);
  } else if (cmd === "fetch") {
    const r = await fetcher().get(rest[0]);
    console.log(r.ok ? `${r.status}${r.fromCache ? " (cache)" : ""}, ${r.text.length} characters\n${r.text.slice(0, 1500)}` : `not fetched: ${r.reason}: ${r.detail}`);
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
  } else { console.error("usage: check | report | promote | apply | extract | fetch (see the header of scripts/research.ts)"); process.exit(2); }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
