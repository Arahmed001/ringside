/**
 * Follows the links of a running copy of the site and says which ones are wrong. (docs/link-check.md)
 *
 *   npm run check:links -- https://ringsidedb.fly.dev          the live site, politely (2 at a time, a pause between requests)
 *   npm run check:links -- http://localhost:3000 --fast        your own copy, as fast as it will go
 *   Options: --per 6 (pages read of each kind), --languages en,ar, --delay 150 (ms), --concurrency 2, --external (also ask each outside address), --json report.json
 *
 * It reads pages from "/" and "/ar", follows what it finds (a few pages of each kind: fighters, events, ...), then asks about EVERY link it saw. It reports:
 *   broken      an address that does not answer 200 (404, 500, no answer)
 *   redirected  a link that is answered with a redirect (it should point at the final address)
 *   language    a page in one language linking to a page in the other (except the language switch)
 *   section     a #section link whose section is not on the page
 *   name        a link whose text is a name but whose page is not about that name (a fighter's name that opens another fighter)
 *   unnamed     a link a screen reader would announce as nothing
 *   review      a link whose words share nothing with the heading of the page it leads to: for a person to glance at, not a failure
 * Exit code 1 when anything but "review" is found. Only GETs, with an honest User-Agent; it never submits a form.
 */
import { classify, extractAnchors, isAsset, isNamedPage, localeProblem, looksLikeControl, nameMismatch, pageInfo, routePattern, sharesWord, type PageInfo } from "../lib/link-check";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, d: string) => { const i = args.indexOf(`--${name}`); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "").replace(/\/+$/, "");
if (!base) { console.error("Say which site: npm run check:links -- https://ringsidedb.fly.dev   (see docs/link-check.md)"); process.exit(2); }
const fast = flag("fast"), per = Number(opt("per", "6")), concurrency = fast ? 8 : Number(opt("concurrency", "2")), delay = fast ? 0 : Number(opt("delay", "150"));
const languages = opt("languages", "en,ar").split(",");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = "RingsideLinkCheck/1.0 (checks the site's own links; one request at a time per worker)";

interface Fetched { status: number; location: string | null; html: string; error?: string }
async function get(path: string): Promise<Fetched> {
  if (delay) await sleep(delay);
  try {
    const r = await fetch(base + path, { redirect: "manual", headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
    const html = r.status === 200 ? await r.text() : (await r.arrayBuffer(), "");
    return { status: r.status, location: r.headers.get("location"), html };
  } catch (e) { return { status: 0, location: null, html: "", error: String(e instanceof Error ? e.message : e) }; }
}
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); }

interface Seen { from: string; frag: string; text: string; hidden: boolean }
const seen = new Map<string, Seen[]>(); // target path -> where it was linked from
const external = new Map<string, string>();
const pages = new Map<string, PageInfo & { status: number }>();
const problems: { kind: string; from: string; to: string; detail: string }[] = [];
const add = (kind: string, from: string, to: string, detail = "") => problems.push({ kind, from, to, detail });

async function crawl() {
  const queue = languages.map((l) => (l === "en" ? "/" : `/${l}`)), queued = new Set(queue), kinds = new Map<string, number>();
  while (queue.length) {
    const batch = queue.splice(0, concurrency);
    await pool(batch, concurrency, async (p) => {
      const r = await get(p);
      if (!r.html) { pages.set(p, { status: r.status, title: "", h1: "", ids: new Set() }); return; }
      pages.set(p, { status: r.status, ...pageInfo(r.html) });
      for (const a of extractAnchors(r.html)) {
        const t = classify(a.href, base, p);
        if (t.kind === "skip") continue;
        if (t.kind === "external") { external.set(t.url, a.text); continue; }
        if (!a.text && !a.label && !a.hidden) add("unnamed", p, t.path, "no text, no label");
        const list = seen.get(t.path) ?? []; list.push({ from: p, frag: t.frag, text: a.text || a.label, hidden: a.hidden }); seen.set(t.path, list);
        const kind = routePattern(t.path), n = kinds.get(kind) ?? 0;
        if (!isAsset(t.path) && !queued.has(t.path) && n < per) { kinds.set(kind, n + 1); queued.add(t.path); queue.push(t.path); }
      }
    });
    process.stderr.write(`\r  read ${pages.size} pages, ${seen.size} addresses linked, ${queue.length} to go   `);
  }
  process.stderr.write("\n");
}

const dump: { to: string; status: number; h1: string; title: string; links: { from: string; text: string; hidden: boolean }[] }[] = [];
async function check() {
  const targets = [...seen.keys()].filter((t) => !isAsset(t));
  const result = new Map<string, Fetched & { info?: PageInfo }>();
  await pool(targets, concurrency, async (t) => {
    const known = pages.get(t);
    if (known) { result.set(t, { status: known.status, location: null, html: "", info: known }); return; }
    const r = await get(t);
    result.set(t, { ...r, info: r.html ? pageInfo(r.html) : undefined });
  });
  for (const [t, list] of seen) {
    const r = result.get(t);
    for (const s of list) {
      const lang = localeProblem(s.from, t, s.text);
      if (lang) add("language", s.from, t, lang);
    }
    if (!r) continue;
    if (opt("dump", "")) dump.push({ to: t, status: r.status, h1: r.info?.h1 ?? "", title: r.info?.title ?? "", links: list.map((x) => ({ from: x.from, text: x.text, hidden: x.hidden })) });
    const first = list[0];
    if (r.status >= 300 && r.status < 400) add("redirected", first.from, t, `${r.status} to ${r.location}`);
    else if (r.status !== 200) add("broken", first.from, t, r.status ? String(r.status) : `no answer (${r.error})`);
    else {
      for (const s of list) if (s.frag && r.info && !r.info.ids.has(s.frag)) add("section", s.from, `${t}#${s.frag}`, "no such section on that page");
      const heading = `${r.info?.h1 ?? ""} ${r.info?.title ?? ""}`;
      if (isNamedPage(t)) for (const s of list) if (s.text && !s.hidden && s.from !== t && nameMismatch(s.text, heading)) add("name", s.from, t, `"${s.text}" opens "${(r.info?.h1 || r.info?.title || "").slice(0, 50)}"`);
      const shown = list.filter((s) => s.text && !s.hidden && s.text.length < 100 && !looksLikeControl(s.from, t) && !/^(English|العربية|Skip to content|انتقل إلى المحتوى)$/.test(s.text));
      const odd = shown.find((s) => !sharesWord(s.text, heading));
      if (odd && !/^\/ar(\/|$)/.test(t) && /^\/[a-z-]+$/.test(t)) add("review", odd.from, t, `"${odd.text}" leads to "${(r.info?.h1 || r.info?.title || "").slice(0, 50)}"`);
    }
  }
}

async function checkExternal() {
  const urls = [...external.keys()];
  await pool(urls, 2, async (u) => {
    if (delay) await sleep(delay);
    try { const r = await fetch(u, { method: "HEAD", redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) }); if (r.status >= 400) add("external", "(various)", u, `${r.status}${r.status === 403 ? " (often a site refusing automated visitors: open it in a browser)" : ""}`); }
    catch (e) { add("external", "(various)", u, `no answer (${e instanceof Error ? e.message : e})`); }
  });
}

async function main() {
  const t0 = Date.now();
  console.log(`Checking ${base} (${languages.join(" + ")}, ${per} pages of each kind, ${concurrency} at a time${delay ? `, ${delay} ms apart` : ""})`);
  await crawl();
  await check();
  if (flag("external")) await checkExternal();
  const failures = problems.filter((p) => p.kind !== "review");
  const by = (k: string) => problems.filter((p) => p.kind === k);
  console.log(`\n${pages.size} pages read, ${[...seen.keys()].filter((t) => !isAsset(t)).length} internal addresses checked, ${external.size} outside addresses${flag("external") ? " checked" : " (not asked: add --external)"}, ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const k of ["broken", "redirected", "language", "section", "name", "unnamed", "external", "review"]) {
    const list = by(k); if (!list.length) { if (k !== "review" && k !== "external") console.log(`  ${k}: none`); continue; }
    console.log(`  ${k}: ${list.length}${k === "review" ? " (for a person to glance at)" : ""}`);
    for (const p of list.slice(0, 25)) console.log(`     ${p.from}  ->  ${p.to}${p.detail ? "   " + p.detail : ""}`);
    if (list.length > 25) console.log(`     ... and ${list.length - 25} more (use --json to see all)`);
  }
  const dumpTo = opt("dump", "");
  if (dumpTo) { const fs = await import("node:fs"); fs.writeFileSync(dumpTo, JSON.stringify(dump)); console.log(`\nEvery link and its destination: ${dumpTo}`); }
  const out = opt("json", "");
  if (out) { const fs = await import("node:fs"); fs.writeFileSync(out, JSON.stringify({ base, pages: pages.size, addresses: seen.size, problems }, null, 1)); console.log(`\nFull report: ${out}`); }
  console.log(failures.length ? `\n${failures.length} problem(s).` : "\nEvery link checked leads where it says.");
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
