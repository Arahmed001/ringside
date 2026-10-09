import { EMBED_HOSTS } from "../lib/social/post";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { HSTS, STATIC_HEADERS, contentSecurityPolicy, isHttps, makeNonce, securityProblems } from "../lib/security";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(name + " ")) ?? "";

test("the production policy lets only nonced scripts run and nothing be framed, embedded or posted elsewhere", () => {
  const csp = contentSecurityPolicy({ nonce: "abc123" });
  assert.equal(directive(csp, "script-src"), "script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  assert.ok(!/unsafe-inline|unsafe-eval/.test(directive(csp, "script-src")) && !/unsafe-eval/.test(csp));
  assert.equal(directive(csp, "style-src"), "style-src 'self' 'nonce-abc123'", "style elements need the nonce");
  assert.equal(directive(csp, "style-src-attr"), "style-src-attr 'unsafe-inline'", "style attributes cannot carry one");
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "connect-src 'self'", "media-src 'self'"]) assert.ok(csp.split("; ").includes(d), d);
  assert.ok(!csp.includes("upgrade-insecure-requests"), "only over https");
  assert.ok(contentSecurityPolicy({ nonce: "n", https: true }).includes("upgrade-insecure-requests"));
  assert.ok(!/ws:/.test(csp), "no websockets in production");
  assert.ok(!/(?:script|style|font|connect)-src[^;]*https:/.test(csp.replace(/img-src[^;]*/, "")), "no third-party script, style, font or connection is allowed");
  assert.equal(directive(csp, "frame-src"), `frame-src ${Object.values(EMBED_HOSTS).map((h) => `https://${h}`).join(" ")}`, "the only frames: the five platforms' own players and embeds, each opened by a press of a button");
});

test("development loosens exactly what Next's tooling needs", () => {
  const csp = contentSecurityPolicy({ nonce: "n", dev: true });
  assert.match(directive(csp, "script-src"), /'unsafe-eval'/);
  assert.match(directive(csp, "connect-src"), /ws:/);
  assert.equal(directive(csp, "style-src"), "style-src 'self' 'unsafe-inline'");
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), "scripts stay nonce-only even in development");
});

test("nonces are fresh and unpredictable", () => {
  const seen = new Set(Array.from({ length: 200 }, makeNonce));
  assert.equal(seen.size, 200);
  for (const n of seen) assert.match(n, /^[A-Za-z0-9+/]{22}==$/, "16 random bytes, base64");
});

test("the proxy puts a new nonce and the policy on every page, forwards both to the page, and adds HSTS only over https", async () => {
  const { proxy } = await import("../proxy");
  const req = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });
  const a = proxy(req("http://localhost:3000/boxers")), b = proxy(req("http://localhost:3000/ar/boxers"));
  const na = a.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1], nb = b.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1];
  assert.notEqual(na, nb, "a nonce per request");
  for (const r of [a, b]) {
    const forwarded = r.headers.get("x-middleware-override-headers") ?? "";
    assert.ok(/x-nonce/.test(forwarded) && /content-security-policy/.test(forwarded), "the page can read its nonce, and Next can find it in the policy");
    assert.equal(r.headers.get("strict-transport-security"), null, "plain http: no HSTS");
  }
  assert.equal(a.headers.get("x-middleware-rewrite")?.endsWith("/en/boxers"), true, "the language rewrite still happens");
  const secure = proxy(req("http://localhost:3000/rankings", { "x-forwarded-proto": "https" }));
  assert.equal(secure.headers.get("strict-transport-security"), HSTS);
  assert.ok(secure.headers.get("content-security-policy")!.includes("upgrade-insecure-requests"));
  const redirect = proxy(req("http://localhost:3000/en/boxers", { "x-forwarded-proto": "https" }));
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.get("strict-transport-security"), HSTS);
  assert.ok(isHttps("https://ringside.example", null) && isHttps(undefined, "https") && !isHttps("http://x", "http") && !isHttps(undefined, null));
});

test("the standing headers are applied to every route, and the framework is not announced", async () => {
  const config = (await import("../next.config")).default;
  const rules = await config.headers!();
  // two rules: the embeds (made to be framed) and every other path (which refuses to be). tests/embeds.test.ts holds the details of the split
  assert.equal(rules.length, 2); assert.equal(rules[0].source, "/embed/:path*"); assert.equal(rules[1].source, "/((?!embed/).*)");
  assert.deepEqual(rules[1].headers, STATIC_HEADERS, "every other path gets the whole standing set, X-Frame-Options included");
  assert.deepEqual(rules[0].headers, STATIC_HEADERS.filter((h) => h.key !== "X-Frame-Options"), "an embed gets the same set but for the one header that would stop it being framed");
  assert.equal(config.poweredByHeader, false);
  const keys = STATIC_HEADERS.map((h) => h.key);
  for (const k of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy", "Cross-Origin-Opener-Policy"]) assert.ok(keys.includes(k), k);
  assert.equal(STATIC_HEADERS.find((h) => h.key === "X-Frame-Options")!.value, "DENY");
  assert.match(STATIC_HEADERS.find((h) => h.key === "Permissions-Policy")!.value, /camera=\(\).*microphone=\(\).*geolocation=\(\)/);
});

test("securityProblems finds what the browser would choke on", () => {
  const good = new Headers({ ...Object.fromEntries(STATIC_HEADERS.map((h) => [h.key, h.value])), "content-security-policy": contentSecurityPolicy({ nonce: "N1" }) });
  const html = `<html><script nonce="N1">a()</script><script src="/x.js" async></script><script type="application/ld+json">{}</script><a href="/x">x</a></html>`;
  assert.deepEqual(securityProblems(good, html), []);
  assert.deepEqual(securityProblems(good, html.replace('nonce="N1"', "")), ["an inline script without the nonce"]);
  assert.deepEqual(securityProblems(good, html.replace('nonce="N1"', 'nonce="OTHER"')), ["an inline script without the nonce"], "a nonce from another response does not count");
  assert.ok(securityProblems(good, '<img src=x onerror="a()">').includes("an inline event handler attribute"));
  assert.ok(securityProblems(good, '<a href="javascript:void(0)">').includes("a javascript: link"));
  assert.ok(securityProblems(new Headers(), html).some((p) => /no Content-Security-Policy/.test(p)));
  const noX = new Headers(good); noX.delete("x-frame-options");
  assert.ok(securityProblems(noX, html).some((p) => /X-Frame-Options/.test(p)));
  const loose = new Headers(good); loose.set("content-security-policy", "default-src 'self'; script-src 'self' 'nonce-N1' 'unsafe-inline'; frame-ancestors 'none'");
  assert.ok(securityProblems(loose, html).includes("script-src allows unsafe-inline"));
  const powered = new Headers(good); powered.set("x-powered-by", "Next.js");
  assert.ok(securityProblems(powered, html).some((p) => /X-Powered-By/.test(p)));
});

test("no source file adds an inline script the policy would block", () => {
  const root = process.cwd(), bad: string[] = [];
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of ["app", "components"].flatMap((d) => walk(path.join(root, d))).filter((f) => /\.tsx?$/.test(f))) {
    const s = fs.readFileSync(f, "utf8");
    for (const m of s.matchAll(/<script\b[^>]*>/g)) if (!/application\/ld\+json|nonce=|\bsrc=/.test(m[0]) && !/\{\.\.\./.test(m[0])) bad.push(`${path.relative(root, f)}: ${m[0].slice(0, 70)}`);
    if (/\son(click|load|error|submit|change)=\s*["']/.test(s)) bad.push(`${path.relative(root, f)}: an inline event handler string`);
  }
  assert.deepEqual(bad, []);
  const layout = fs.readFileSync(path.join(root, "app/[locale]/layout.tsx"), "utf8");
  assert.match(layout, /get\("x-nonce"\)/); assert.match(layout, /<InlineScript nonce=\{nonce\}/);
});
