import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { EMBED_HEADERS, STATIC_HEADERS, contentSecurityPolicy, isEmbedPath, securityProblems } from "../lib/security";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/**
 * Embeds (round: embeds): pages for other sites to frame. The part that must not go wrong is the framing rule: ONLY /embed/... may be framed, every other path (pages, the API,
 * the feeds) must still refuse. These tests hold both directions, at the policy, the config, the proxy and the rendered page.
 */
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(name + " ")) ?? "";

test("the embed policy differs from the standard one in exactly two directives: who may frame the page, and what the page may frame (a page here may hold YouTube's player, an embed holds nothing)", () => {
  const std = contentSecurityPolicy({ nonce: "N" }), emb = contentSecurityPolicy({ nonce: "N", embed: true });
  assert.equal(directive(std, "frame-ancestors"), "frame-ancestors 'none'"); assert.equal(directive(emb, "frame-ancestors"), "frame-ancestors *");
  assert.equal(directive(std, "frame-src"), "frame-src https://www.youtube-nocookie.com"); assert.equal(directive(emb, "frame-src"), "frame-src 'none'");
  const without = (csp: string) => csp.split("; ").filter((d) => !d.startsWith("frame-ancestors") && !d.startsWith("frame-src")).join("; ");
  assert.equal(without(emb), without(std), "the same nonce policy, the same everything else");
  assert.ok(/script-src 'self' 'nonce-N' 'strict-dynamic'/.test(emb) && !/unsafe-inline/.test(directive(emb, "script-src")), "scripts stay nonce-only");
});

test("which paths are embeds: /embed and what is under it, nothing that merely contains the word", () => {
  for (const p of ["/embed", "/embed/en/fighter/x", "/embed/ar/rankings/heavyweight"]) assert.equal(isEmbedPath(p), true, p);
  for (const p of ["/", "/boxers", "/embedded", "/embedded/x", "/api/embed", "/ar/embed/en/fighter/x", "/en/embed", "/boxers/embed"]) assert.equal(isEmbedPath(p), false, p);
  assert.deepEqual(EMBED_HEADERS.map((h) => h.key), STATIC_HEADERS.map((h) => h.key).filter((k) => k !== "X-Frame-Options"));
});

test("the config: the header rules, read as the patterns they are, give an embed no X-Frame-Options and every other path the whole set", async () => {
  const rules = await (await import("../next.config")).default.headers!();
  const matches = (source: string, p: string) => new RegExp(`^${source.replace(/:path\*$/, "(?:.*)")}$`).test(p); // the two shapes used: "/embed/:path*" and "/(<regex>)"
  const headersFor = (p: string) => rules.filter((r) => matches(r.source, p)).flatMap((r) => r.headers.map((h) => h.key));
  for (const p of ["/embed/en/fighter/x", "/embed/ar/rankings/lightweight"]) { const k = headersFor(p); assert.ok(!k.includes("X-Frame-Options"), p); assert.ok(k.includes("X-Content-Type-Options") && k.includes("Referrer-Policy"), `${p} keeps the other headers`); }
  for (const p of ["/", "/boxers", "/ar/boxers", "/api/v1/fighters", "/feeds/calendar.ics", "/embedded/x", "/ar/embed/en/fighter/x", "/privacy", "/account"]) { const k = headersFor(p); assert.ok(k.includes("X-Frame-Options"), `${p} still refuses framing`); assert.equal(k.filter((x) => x === "X-Frame-Options").length, 1, `${p}: once`); }
  assert.ok(!headersFor("/embed/en/fighter/x").some((k) => k === "X-Frame-Options"));
});

test("the proxy: an embed gets the framable policy, a nonce, no language rewrite; every other path keeps 'none' and its rewrite", async () => {
  const { proxy } = await import("../proxy");
  const req = (url: string) => new NextRequest(url, { headers: {} });
  const e = proxy(req("http://localhost:3000/embed/en/fighter/x")), a = proxy(req("http://localhost:3000/embed/ar/rankings/heavyweight")), page = proxy(req("http://localhost:3000/boxers")), api = proxy(req("http://localhost:3000/ar/boxers"));
  for (const r of [e, a]) {
    const csp = r.headers.get("content-security-policy")!;
    assert.equal(directive(csp, "frame-ancestors"), "frame-ancestors *"); assert.match(csp, /'nonce-[^']+'/);
    assert.equal(r.headers.get("x-middleware-rewrite"), null, "no language rewrite: the language is the second segment");
    const forwarded = r.headers.get("x-middleware-override-headers") ?? ""; assert.ok(/x-nonce/.test(forwarded) && /content-security-policy/.test(forwarded));
  }
  assert.notEqual(e.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1], a.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1], "a nonce per request");
  for (const r of [page, api]) assert.equal(directive(r.headers.get("content-security-policy")!, "frame-ancestors"), "frame-ancestors 'none'");
  assert.equal(page.headers.get("x-middleware-rewrite")?.endsWith("/en/boxers"), true);
  const secure = proxy(new NextRequest("http://localhost:3000/embed/en/fighter/x", { headers: { "x-forwarded-proto": "https" } }));
  assert.ok(secure.headers.get("strict-transport-security") && secure.headers.get("content-security-policy")!.includes("upgrade-insecure-requests"), "over https an embed gets HSTS and upgrades too");
});

test("securityProblems for an embed: it must be framable, and be held to every other rule", () => {
  const headersOf = (set: { key: string; value: string }[], csp: string) => new Headers({ ...Object.fromEntries(set.map((h) => [h.key, h.value])), "content-security-policy": csp });
  const html = `<html><body><p>x</p></body></html>`;
  const good = headersOf(EMBED_HEADERS, contentSecurityPolicy({ nonce: "N", embed: true }));
  assert.deepEqual(securityProblems(good, html, { embed: true }), []);
  assert.ok(securityProblems(good, html).some((p) => /X-Frame-Options is missing/.test(p)), "judged as an ordinary page, the same response is wrong");
  assert.ok(securityProblems(good, html).includes("the page can be framed"), "and its policy lets it be framed");
  const withXfo = headersOf(STATIC_HEADERS, contentSecurityPolicy({ nonce: "N", embed: true }));
  assert.ok(securityProblems(withXfo, html, { embed: true }).includes("an embed carries X-Frame-Options, so it cannot be framed"));
  const none = headersOf(EMBED_HEADERS, contentSecurityPolicy({ nonce: "N" }));
  assert.ok(securityProblems(none, html, { embed: true }).includes("the embed's policy does not let other sites frame it"));
  assert.ok(securityProblems(good, `<script>a()</script>`, { embed: true }).includes("an inline script without the nonce"), "an embed may not run an un-nonced script");
  assert.ok(securityProblems(good, `<script src="https://evil.test/x.js"></script>`, { embed: true }).includes("a script from another website"));
});

// ---- the pages, over a league ----
const cleanup = tempDb("embeds", "2026-10-03");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-emb-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });
type Page = (a: { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string | undefined>> }) => Promise<unknown>;
let fighterPage: Page, rankingsPage: Page;
type Meta = (a: { params: Promise<Record<string, string>> }) => Promise<{ title?: string; robots?: { index?: boolean; follow?: boolean } }>;
let fighterMeta: Meta, rankingsMeta: Meta;
const render = async (page: Page, params: Record<string, string>, search: Record<string, string> = {}) => renderToStaticMarkup((await page({ params: Promise.resolve(params), searchParams: Promise.resolve(search) })) as never);
const withEnv = async <T,>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> => { const saved = { ...process.env }; Object.assign(process.env, env); try { return await fn(); } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); } };
const isNotFound = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch (e) { return /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/.test(String((e as { digest?: string }).digest ?? e)); } };

before(async () => {
  const feed = miniFeed();
  const names = ["Alma Ruiz", "Bea Cole", "Cyrus Dean", "Dov Eden", "Eli Fox", "Fay Gil"];
  feed.boxers = names.map((n, i) => makeBoxer(`B${i}`, "Lightweight", { name: n, country: "Mexico" }));
  const ev = (id: string, date: string) => ({ externalId: id, name: `Night ${id}`, date, venue: "Arena", city: "Las Vegas", country: "United States" });
  const pairs: [number, number][] = []; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) pairs.push([i, j]);
  feed.events = [...pairs.map((_, k) => ev(`R${k}`, `2026-0${1 + (k % 8)}-${10 + (k % 15)}`)), ev("UP", "2026-10-20")];
  feed.bouts = [
    ...pairs.map(([i, j], k) => ({ externalId: `RB${k}`, eventExternalId: `R${k}`, redExternalId: `B${i}`, blueExternalId: `B${j}`, weightClass: "Lightweight", rounds: 12, winnerExternalId: `B${i}`, method: "UD", endRound: 12, title: null, position: 0 })),
    { externalId: "UPB", eventExternalId: "UP", redExternalId: "B0", blueExternalId: "B1", weightClass: "Lightweight", rounds: 12, winnerExternalId: null, method: null, endRound: null, title: null, position: 0 },
  ] as never;
  feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = [];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file; process.env.SITE_URL = "https://ringside.test";
  fighterPage = (await import("../app/embed/[locale]/fighter/[slug]/page")).default as unknown as Page;
  rankingsPage = (await import("../app/embed/[locale]/rankings/[division]/page")).default as unknown as Page;
  fighterMeta = (await import("../app/embed/[locale]/fighter/[slug]/page")).generateMetadata as unknown as Meta;
  rankingsMeta = (await import("../app/embed/[locale]/rankings/[division]/page")).generateMetadata as unknown as Meta;
});

test("a fighter card: the name, record, knockouts, rating and rank, the last fights and the next one, a link back that opens in a new tab, and no script", async () => {
  const html = await render(fighterPage, { locale: "en", slug: "alma-ruiz" });
  for (const s of ["Alma Ruiz", "Mexico", "Lightweight", "5-0-0", "Knockouts", "Rank #1", "Last 5 fights", "Next fight", "Oct 20", "Bea Cole"]) assert.ok(html.includes(s) || html.includes(s.replace("Oct 20", "2026-10-20")), `shows ${s}`);
  assert.match(html, /<a href="https:\/\/ringside\.test\/boxers\/alma-ruiz" target="_blank" rel="noopener"[^>]*>View on Ringside/);
  assert.ok(!/<script|onclick|javascript:/i.test(html), "no script of ours");
  assert.ok(!/Boxing Data API/.test(html), "a file feed has no supplier to credit");
  assert.ok(!/style="[^"]*--bg/.test(html), "dark is the site's own look");
});

test("the theme, the language and the limit are read from the address, and a bad value falls back", async () => {
  const light = await render(fighterPage, { locale: "en", slug: "alma-ruiz" }, { theme: "light" });
  assert.match(light, /--bg:#ffffff/); assert.match(light, /color-scheme:light/);
  assert.ok(!/--bg:#ffffff/.test(await render(fighterPage, { locale: "en", slug: "alma-ruiz" }, { theme: "neon" })), "an unknown theme is dark");
  const ar = await render(fighterPage, { locale: "ar", slug: "alma-ruiz" });
  assert.ok(ar.includes("عرض على رينغسايد") && ar.includes("المرتبة 1"), "Arabic strings"); assert.ok(ar.includes("https://ringside.test/ar/boxers/alma-ruiz"), "the link back keeps the language");
  const rows = (html: string) => (html.match(/<li /g) ?? []).length;
  assert.equal(rows(await render(rankingsPage, { locale: "en", division: "lightweight" })), 3, "three of the six qualify");
  assert.equal(rows(await render(rankingsPage, { locale: "en", division: "lightweight" }, { limit: "2" })), 2);
  assert.equal(rows(await render(rankingsPage, { locale: "en", division: "lightweight" }, { limit: "99" })), 3, "capped at ten, and here only three exist");
  assert.equal(rows(await render(rankingsPage, { locale: "en", division: "lightweight" }, { limit: "abc" })), 3, "a bad limit is the default");
});

test("a ranking: the division's name, each place with the fighter, record and rating, and a plain line when nobody is ranked", async () => {
  const html = await render(rankingsPage, { locale: "en", division: "lightweight" });
  assert.ok(html.includes("Lightweight rankings")); assert.match(html, /Alma Ruiz[\s\S]*Bea Cole[\s\S]*Cyrus Dean/); assert.ok(html.includes("5-0-0") && html.includes("4-1-0"));
  assert.ok(html.includes("https://ringside.test/rankings/lightweight"), "the link back goes to the whole ranking");
  assert.ok((await render(rankingsPage, { locale: "en", division: "lightweight" }, { sex: "female" })).includes("Nobody is ranked there."));
  assert.ok((await render(rankingsPage, { locale: "ar", division: "lightweight" })).includes("تصنيفات الوزن الخفيف") || (await render(rankingsPage, { locale: "ar", division: "lightweight" })).includes("الوزن الخفيف"));
});

test("nothing to show, or not allowed to: an unknown fighter, division or language, and the switch, are all a 404 and never a half page", async () => {
  assert.equal(await isNotFound(() => render(fighterPage, { locale: "en", slug: "nobody-here" })), true);
  assert.equal(await isNotFound(() => render(fighterPage, { locale: "xx", slug: "alma-ruiz" })), true);
  assert.equal(await isNotFound(() => render(rankingsPage, { locale: "en", division: "catchweight" })), true);
  assert.equal(await withEnv({ PUBLIC_API: "0" }, () => isNotFound(() => render(fighterPage, { locale: "en", slug: "alma-ruiz" }))), true, "switched off");
  assert.equal(await withEnv({ BOXING_PROVIDER: "licensed" }, () => isNotFound(() => render(rankingsPage, { locale: "en", division: "lightweight" }))), true, "licensed data: off until the owner turns it on");
  assert.equal(await withEnv({ BOXING_PROVIDER: "licensed", PUBLIC_API: "1" }, () => isNotFound(() => render(fighterPage, { locale: "en", slug: "alma-ruiz" }))), true, "one of the two is not enough");
});

test("licensed data, switched on by the owner: the footer names the supplier, in a link that opens in a new tab", async () => {
  const html = await withEnv({ BOXING_PROVIDER: "licensed", PUBLIC_API: "1", VENDOR_REDISTRIBUTION_CONFIRMED: "1" }, () => render(fighterPage, { locale: "en", slug: "alma-ruiz" }));
  assert.match(html, /Fight, fighter and event data: <a href="https:\/\/boxing-data\.com"[^>]*target="_blank" rel="noopener"[^>]*>Boxing Data API<\/a>/);
  const ar = await withEnv({ BOXING_PROVIDER: "licensed", PUBLIC_API: "1", VENDOR_REDISTRIBUTION_CONFIRMED: "1" }, () => render(fighterPage, { locale: "ar", slug: "alma-ruiz" }));
  assert.ok(ar.includes("Boxing Data API") && ar.includes("بيانات النزالات"), "the credit in Arabic, the supplier's name as written");
});

test("crawlers are told to stay out of /embed/", async () => {
  const robots = (await import("../app/robots")).default;
  const r = await withEnv({ INDEXABLE: "1" }, async () => robots()) as { rules: { disallow: string[] } };
  assert.ok(r.rules.disallow.includes("/embed/") && r.rules.disallow.includes("/api/"));
});

test("the smoke check for an embed: bare HTML with a link back that opens in a new tab and a noindex, and each way it can go wrong is reported", async () => {
  const { problemsIn } = await import("../lib/smoke");
  const route = { path: "/embed/en/fighter/x", kind: "embed" as const, label: "embed", mustShow: "Alma Ruiz" };
  const good = `<html lang="en"><head><title>Alma Ruiz · Ringside</title><meta name="robots" content="noindex, nofollow"/></head><body><main><h1>Alma Ruiz</h1><a href="https://ringside.test/boxers/x" target="_blank" rel="noopener">View on Ringside</a></main></body></html>`;
  assert.deepEqual(problemsIn(route, "en", 200, "text/html; charset=utf-8", good), []);
  assert.match(problemsIn(route, "en", 200, "text/html", good.replace(' rel="noopener"', "")).join(), /no link back/);
  assert.match(problemsIn(route, "en", 200, "text/html", good.replace("<main>", "<nav>menu</nav><main>")).join(), /site chrome/);
  assert.match(problemsIn(route, "en", 200, "text/html", good.replace("<title>Alma Ruiz · Ringside</title>", "")).join(), /no title/);
  assert.match(problemsIn(route, "en", 200, "text/html", good.replace("<main>", "<div>").replace("</main>", "</div>")).join(), /no main landmark/);
  assert.match(problemsIn(route, "en", 200, "text/html", good.replace('content="noindex, nofollow"', 'content="index"')).join(), /search engines may list/);
  assert.match(problemsIn(route, "en", 200, "text/html", good.replaceAll("Alma Ruiz", "Someone")).join(), /does not show "Alma Ruiz"/);
  assert.match(problemsIn(route, "en", 200, "application/json", good).join(), /not HTML/);
  assert.deepEqual(problemsIn(route, "en", 404, "text/html", good), ["status 404"]);
  // a name that has to be escaped on the page is found as the person reads it (the hostile league's fighter), and a name that is NOT escaped is not what the check looks for
  const hostile = { ...route, mustShow: `<script>alert(1)</script> O'Brien "The Bomb" & Sons` };
  const escaped = good.replace("Alma Ruiz", "&lt;script&gt;alert(1)&lt;/script&gt; O&#x27;Brien &quot;The Bomb&quot; &amp; Sons");
  assert.deepEqual(problemsIn(hostile, "en", 200, "text/html", escaped), []);
  assert.match(problemsIn(hostile, "en", 200, "text/html", good).join(), /does not show/);
});

test("the code to paste: the address of each card, the language and theme in it, the rows held to what the card accepts, and everything in the HTML escaped", async () => {
  const { embedPath, embedHeight, embedSnippet } = await import("../lib/embed-code");
  assert.equal(embedPath({ kind: "fighter", lang: "en", theme: "dark", slug: "alma-ruiz" }), "/embed/en/fighter/alma-ruiz?theme=dark");
  assert.equal(embedPath({ kind: "fighter", lang: "ar", theme: "light", slug: "alma-ruiz" }), "/embed/ar/fighter/alma-ruiz?theme=light");
  assert.equal(embedPath({ kind: "rankings", lang: "en", theme: "dark", division: "light-flyweight", rows: 7 }), "/embed/en/rankings/light-flyweight?theme=dark&limit=7");
  assert.equal(embedPath({ kind: "fighter", lang: "en", theme: "dark" }), null, "no fighter chosen, nothing to paste"); assert.equal(embedPath({ kind: "rankings", lang: "en", theme: "dark" }), null);
  for (const [rows, want] of [[0, 1], [-4, 1], [99, 10], [3.9, 3], [undefined, 5]] as const) assert.match(embedPath({ kind: "rankings", lang: "en", theme: "dark", division: "heavyweight", rows })!, new RegExp(`limit=${want}$`), String(rows));
  assert.equal(embedPath({ kind: "fighter", lang: "xx" as "en", theme: "neon" as "dark", slug: "a" }), "/embed/en/fighter/a?theme=dark", "a value that is not one of the choices is the default");
  assert.equal(embedPath({ kind: "fighter", lang: "en", theme: "dark", slug: "a/b?c" }), "/embed/en/fighter/a%2Fb%3Fc?theme=dark", "a slug cannot change the path or add a query");
  assert.equal(embedHeight({ kind: "fighter", lang: "en", theme: "dark" }), 290); assert.equal(embedHeight({ kind: "rankings", lang: "en", theme: "dark", rows: 5 }), 330); assert.equal(embedHeight({ kind: "rankings", lang: "en", theme: "dark", rows: 99 }), 540);
  const snippet = embedSnippet("https://ringside.test/", { kind: "fighter", lang: "en", theme: "dark", slug: "alma-ruiz" })!;
  assert.equal(snippet, '<iframe src="https://ringside.test/embed/en/fighter/alma-ruiz?theme=dark" width="460" height="290" style="border:0;max-width:100%" loading="lazy" title="Ringside"></iframe>');
  assert.ok(embedSnippet('https://x.test/"><script>a()</script>', { kind: "fighter", lang: "en", theme: "dark", slug: "a" })!.includes("&quot;&gt;&lt;script&gt;"), "a base address cannot break out of the attribute");
});

test("what the builder produces is served: the paths it builds are paths the embed pages answer, and a fighter or division it offers always exists", async () => {
  const { embedPath } = await import("../lib/embed-code");
  const fighter = embedPath({ kind: "fighter", lang: "ar", theme: "light", slug: "alma-ruiz" })!, ranking = embedPath({ kind: "rankings", lang: "en", theme: "dark", division: "lightweight", rows: 2 })!;
  const [, , locale1, , slug] = fighter.split("?")[0].split("/"), [, , locale2, , division] = ranking.split("?")[0].split("/");
  assert.ok((await render(fighterPage, { locale: locale1, slug }, { theme: "light" })).includes("5-0-0"));
  assert.ok((await render(rankingsPage, { locale: locale2, division }, { limit: "2", theme: "dark" })).includes("Lightweight rankings"));
});

test("a card is a page a screen reader can use (axe found three problems on every embed): a title for the frame, and the content inside a main landmark; and it is still not for search engines", async () => {
  const meta = (m: Meta, params: Record<string, string>) => m({ params: Promise.resolve(params) });
  assert.equal((await meta(fighterMeta, { locale: "en", slug: "alma-ruiz" })).title, "Alma Ruiz · Ringside");
  assert.equal((await meta(rankingsMeta, { locale: "en", division: "lightweight" })).title, "Lightweight rankings · Ringside");
  assert.equal((await meta(rankingsMeta, { locale: "ar", division: "lightweight" })).title, "تصنيفات الوزن الخفيف · Ringside", "in the card's own language");
  for (const m of [await meta(fighterMeta, { locale: "en", slug: "alma-ruiz" }), await meta(rankingsMeta, { locale: "en", division: "lightweight" })]) assert.deepEqual(m.robots, { index: false, follow: false });
  assert.equal((await meta(fighterMeta, { locale: "en", slug: "nobody-here" })).title, "Ringside", "an unknown fighter: a plain title, never a crash");
  assert.equal((await meta(fighterMeta, { locale: "xx", slug: "alma-ruiz" })).title, "Ringside"); assert.equal((await meta(rankingsMeta, { locale: "en", division: "catchweight" })).title, "Ringside");
  for (const html of [await render(fighterPage, { locale: "en", slug: "alma-ruiz" }), await render(rankingsPage, { locale: "ar", division: "lightweight" }, { theme: "light" })]) {
    assert.equal((html.match(/<main\b/g) ?? []).length, 1, "one main landmark");
    assert.ok(html.indexOf("<main") < html.indexOf("<h1") && html.lastIndexOf("</main>") > html.lastIndexOf("</a>"), "the heading and the footer link are inside it");
  }
});
