import test from "node:test";
import assert from "node:assert/strict";
import { PoliteFetcher, MAX_CRAWL_DELAY_S, MAX_RULES, MAX_RULE_LENGTH, parseRobots, readCapped, robotsAllows, ruleMatches } from "../lib/research/fetcher";
import { isPrivateAddress } from "../lib/research/netguard";
import { boxingDataApiProvider } from "../lib/providers/boxing-data-api";
import { mulberry32 } from "../lib/prng";

/**
 * The page-checker fetches an address a reader typed, and reads a robots.txt the owner of that address wrote. A security review found five ways that could hurt
 * the server: a robots rule that makes a regular expression run for minutes, a robots.txt redirect to an internal address, bodies read whole before being cut,
 * a Crawl-delay with no ceiling, and IPv4 hidden inside IPv6. Each is closed here and each test fails if its fix is removed.
 */
const oldRegexRule = (p: string, text: string) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")).test(text);

test("robots rules match exactly as the regular-expression version did, on thousands of random rules and paths", () => {
  const rand = mulberry32(99);
  const pick = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
  let stars = 0, anchored = 0, matched = 0;
  for (let i = 0; i < 6000; i++) {
    let rule = pick("/ab*.$?", 1 + Math.floor(rand() * 7));
    if (rand() < 0.2) rule += "$";
    const text = pick("/ab.?$", Math.floor(rand() * 9));
    if (rule.includes("*")) stars++;
    if (rule.endsWith("$")) anchored++;
    const want = oldRegexRule(rule, text);
    if (want) matched++;
    assert.equal(ruleMatches(rule, text), want, `rule ${JSON.stringify(rule)} on ${JSON.stringify(text)}`);
  }
  assert.ok(stars > 1000 && anchored > 800 && matched > 300, `the corpus exercises stars (${stars}), anchors (${anchored}) and matches (${matched})`);
});

test("a robots rule built to make a regular expression run for minutes is answered at once", () => {
  const r = parseRobots("User-agent: *\nDisallow: /*a*a*a*a*a*a*a*a*a*a*a*c\n");
  const t0 = performance.now();
  assert.equal(robotsAllows(r, "/" + "a".repeat(300)), true, "no c on the path: allowed");
  assert.equal(robotsAllows(r, "/" + "a".repeat(300) + "c"), false, "a c at the end: disallowed");
  assert.ok(performance.now() - t0 < 200, `took ${Math.round(performance.now() - t0)} ms`);
});

test("only so much of a robots.txt is believed: 200 rules a group, 200 characters a rule, a Crawl-delay of at most 10 s", () => {
  const many = "User-agent: *\n" + Array.from({ length: 500 }, (_, i) => `Disallow: /p${i}`).join("\n") + `\nDisallow: /${"x".repeat(MAX_RULE_LENGTH + 5)}\nCrawl-delay: 2000000\n`;
  const r = parseRobots(many);
  assert.equal(r.disallow.length, MAX_RULES);
  assert.equal(parseRobots("User-agent: *\n" + Array.from({ length: 500 }, (_, i) => `Allow: /a${i}`).join("\n")).allow.length, MAX_RULES, "allow rules are capped too");
  assert.ok(r.disallow.every((d) => d.length <= MAX_RULE_LENGTH));
  assert.equal(r.crawlDelay, MAX_CRAWL_DELAY_S);
  assert.equal(parseRobots("User-agent: *\nCrawl-delay: 2.5\n").crawlDelay, 2.5);
  assert.equal(parseRobots("User-agent: *\nCrawl-delay: -4\n").crawlDelay, undefined);
  assert.equal(parseRobots("User-agent: *\nCrawl-delay: abc\n").crawlDelay, undefined);
});

type Page = { status?: number; type?: string; body?: string; location?: string };
const web = (pages: Record<string, Page>) => {
  const log: string[] = [], modes: Record<string, string> = {};
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); log.push(url); modes[url] = String(init?.redirect);
    const p = pages[url];
    if (!p) return new Response("", { status: 404 });
    return new Response(p.body ?? "", { status: p.status ?? 200, headers: { "content-type": p.type ?? "text/html", ...(p.location ? { location: p.location } : {}) } });
  }) as typeof fetch;
  return { fetchImpl, log, modes };
};
const fetcher = (w: ReturnType<typeof web>, over: Partial<ConstructorParameters<typeof PoliteFetcher>[0]> = {}) => {
  let clock = 0; const sleeps: number[] = [];
  return { sleeps, f: new PoliteFetcher({ contact: "research@example.org", fetchImpl: w.fetchImpl, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; }, delayMs: 3000, ...over }) };
};

test("a robots.txt that redirects to an internal address is never followed: the internal address is not asked for, and the page is not fetched", async () => {
  for (const to of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:8080/admin", "https://other.example/robots.txt", "ftp://evil.example/robots.txt"]) {
    const w = web({ "https://evil.example/robots.txt": { status: 302, location: to }, "https://evil.example/page": { body: "<p>quote</p>" }, [to]: { body: "User-agent: *\nDisallow:\n" } });
    const { f } = fetcher(w, { strictRedirects: true, hostCheck: async () => null });
    const r = await f.get("https://evil.example/page");
    assert.ok(!r.ok && r.reason === "robots", `${to}: read as "stay away"`);
    assert.ok(!w.log.includes(to), `${to} was never requested`);
    assert.ok(!w.log.includes("https://evil.example/page"), "and the page itself was not fetched");
    assert.equal(w.modes["https://evil.example/robots.txt"], "manual", "robots.txt is asked for with redirects handled by us, never followed by the HTTP library");
  }
});

test("a robots.txt may redirect within its own site, up to 3 hops, each hop checked with the host check", async () => {
  const w = web({
    "https://ok.example/robots.txt": { status: 301, location: "https://ok.example/real-robots.txt" },
    "https://ok.example/real-robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /private\n" },
    "https://ok.example/page": { body: "<p>fine</p>" }, "https://ok.example/private": { body: "<p>no</p>" },
  });
  const checked: string[] = [];
  const { f } = fetcher(w, { strictRedirects: true, hostCheck: async (h) => { checked.push(h); return null; } });
  assert.ok((await f.get("https://ok.example/page")).ok);
  const blocked = await f.get("https://ok.example/private");
  assert.ok(!blocked.ok && blocked.reason === "robots", "the redirected robots.txt is the one that is believed");
  const w2 = web({ "https://loop.example/robots.txt": { status: 302, location: "https://loop.example/robots.txt" }, "https://loop.example/p": { body: "x" } });
  const r = await fetcher(w2, { strictRedirects: true }).f.get("https://loop.example/p");
  assert.ok(!r.ok && r.reason === "robots", "a redirect loop is read as stay away, after 3 hops");
  assert.equal(w2.log.filter((u) => u.endsWith("/robots.txt")).length, 4, "the first request and 3 hops, no more");
  const w3 = web({ "https://hc.example/robots.txt": { status: 302, location: "https://hc.example/r2" }, "https://hc.example/p": { body: "x" } });
  const refused = await fetcher(w3, { strictRedirects: true, hostCheck: async () => (w3.log.length >= 1 ? "no" : null) }).f.get("https://hc.example/p");
  assert.ok(!refused.ok && refused.reason === "robots", "the host check can refuse a hop");
  assert.ok(!w3.log.includes("https://hc.example/r2"), "and the refused hop is not requested");
});

test("a body is read only up to the cap and the rest is cancelled, for a page and for a robots.txt", async () => {
  let pulled = 0, cancelled = false;
  const stream = () => new ReadableStream<Uint8Array>({
    pull(c) { pulled++; c.enqueue(new TextEncoder().encode("x".repeat(10_000))); if (pulled > 5000) c.close(); },
    cancel() { cancelled = true; },
  });
  const text = await readCapped(new Response(stream()), 100_000);
  assert.equal(text.length, 100_000);
  assert.ok(pulled <= 15, `pulled ${pulled} chunks of 10 kB for a 100 kB cap`);
  assert.ok(cancelled, "the stream was cancelled");
  assert.equal(await readCapped(new Response("short"), 100_000), "short");
  assert.equal(await readCapped(new Response("héllo wörld"), 1000), "héllo wörld", "multi-byte text survives");

  pulled = 0; cancelled = false;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const u = String(input);
    return u.endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response(stream(), { status: 200, headers: { "content-type": "text/plain" } });
  }) as typeof fetch;
  const r = await new PoliteFetcher({ contact: "a@b.c", fetchImpl, delayMs: 0, maxBytes: 50_000, sleep: async () => {} }).get("https://big.example/p");
  assert.ok(r.ok && r.text.length === 50_000);
  assert.ok(pulled <= 10 && cancelled, `the page read stopped after ${pulled} chunks`);
});

test("a Crawl-delay of two million seconds waits 10 seconds, not 23 days", async () => {
  const w = web({ "https://slow.example/robots.txt": { type: "text/plain", body: "User-agent: *\nCrawl-delay: 2000000\n" }, "https://slow.example/p": { body: "<p>ok</p>" } });
  const { f, sleeps } = fetcher(w);
  assert.ok((await f.get("https://slow.example/p")).ok);
  assert.ok(Math.max(0, ...sleeps) <= MAX_CRAWL_DELAY_S * 1000, `longest wait ${Math.max(0, ...sleeps)} ms`);
  assert.ok(sleeps.some((ms) => ms >= 5000), "a Crawl-delay is still honoured up to the ceiling");
});

test("IPv4 hidden inside IPv6 is judged as the IPv4 address it carries, in every spelling", () => {
  for (const a of ["::ffff:7f00:1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:7f00:1", "2002:7f00:1::", "2002:a9fe:a9fe::1", "fec0::1", "fe80::1", "febf::1", "fc00::1", "fd12:3456::1", "ff02::1", "::", "::1", "0:0:0:0:0:0:0:1", "64:ff9b::1", "::ffff:10.1.2.3", "::ffff:c0a8:101"])
    assert.equal(isPrivateAddress(a), true, a);
  for (const a of ["::ffff:808:808", "::ffff:8.8.8.8", "2002:808:808::", "2606:4700:4700::1111", "2a00:1450:4001:81b::200e", "::ffff:5db8:d822", "fec:1::1"])
    assert.equal(isPrivateAddress(a), false, a);
  assert.equal(isPrivateAddress("not-an-address"), true);
  assert.equal(isPrivateAddress("1:2:3:4:5:6:7:8:9"), true);
  assert.equal(isPrivateAddress("1::2::3"), true);
});

test("a vendor reply that echoes the API key into a thrown message is scrubbed", async () => {
  const KEY = "sk-secret-key-0123456789abcdef0123456789abcdef";
  const echo = (body: string) => boxingDataApiProvider({ key: KEY, purpose: "evaluation", scheduleDays: 0, retries: 0, gapMs: 0, maxRequests: 10, log: () => {}, sleep: async () => {},
    fetchImpl: (async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch });
  for (const body of [`<html>bad gateway for ${KEY}</html>`, JSON.stringify({ error: { message: `invalid key ${KEY}` }, data: [] })]) {
    let message = "";
    try { await echo(body).plan(); } catch (e) { message = (e as Error).message; }
    assert.ok(message.length > 0, "it threw");
    assert.ok(!message.includes(KEY), `the key is not in: ${message}`);
    assert.match(message, /\*\*\*/);
  }
});

test("the names of this machine are refused however they are written, with no host check at all (the command-line tool has none): a trailing dot, capitals, anything under .localhost", async () => {
  for (const u of ["http://localhost/", "http://localhost./", "http://LOCALHOST/", "http://localhost.../x", "http://foo.localhost/", "http://a.b.localhost./", "http://printer.local./", "http://db.internal./", "http://127.0.0.1./", "http://[::1]/"]) {
    const w = web({ [u]: { body: "<p>secret</p>" } });
    const { f } = fetcher(w, {});
    const r = await f.get(u);
    assert.ok(!r.ok && r.reason === "bad-url", `${u}: refused`);
    assert.deepEqual(w.log, [], `${u}: nothing was requested, not even its robots.txt`);
  }
});

test("and a public name written with a trailing dot, or one that merely contains 'localhost', is still a public name", async () => {
  for (const u of ["https://example.com./page", "https://localhost-news.example/page", "https://mylocalhost.example/page"]) {
    const w = web({ [`${new URL(u).origin}/robots.txt`]: { status: 404, body: "" }, [u]: { body: "<p>quote</p>" } });
    const { f } = fetcher(w, {});
    const r = await f.get(u);
    assert.ok(r.ok, `${u}: fetched (${JSON.stringify(r)})`);
  }
});
