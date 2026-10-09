import test from "node:test";
import assert from "node:assert/strict";
import { clientAddress } from "../lib/client-ip";
import { clientId } from "../lib/ai-guard";
import { clientKey } from "../lib/public-api-http";

const h = (o: Record<string, string>) => new Headers(o);
const withEnv = (v: string | undefined, f: () => void) => { const old = process.env.CLIENT_IP_HEADER; if (v === undefined) delete process.env.CLIENT_IP_HEADER; else process.env.CLIENT_IP_HEADER = v; try { f(); } finally { if (old === undefined) delete process.env.CLIENT_IP_HEADER; else process.env.CLIENT_IP_HEADER = old; } };

test("by default: the first X-Forwarded-For entry, then X-Real-IP, else nothing", () => withEnv(undefined, () => {
  assert.equal(clientAddress(h({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" })), "1.2.3.4");
  assert.equal(clientAddress(h({ "x-real-ip": "5.6.7.8" })), "5.6.7.8");
  assert.equal(clientAddress(h({})), null);
}));

test("with CLIENT_IP_HEADER set only that header counts; a visitor-written X-Forwarded-For is ignored", () => withEnv("Fly-Client-IP", () => {
  assert.equal(clientAddress(h({ "fly-client-ip": "7.7.7.7", "x-forwarded-for": "1.1.1.1, 7.7.7.7" })), "7.7.7.7");
  assert.equal(clientAddress(h({ "x-forwarded-for": "1.1.1.1" })), null, "no host header: no fallback to one the visitor can write");
  assert.equal(clientAddress(h({ "fly-client-ip": "  " })), null);
}));

test("a malformed header name is not used and does not fall back", () => withEnv("bad name!", () => {
  assert.equal(clientAddress(h({ "x-forwarded-for": "1.1.1.1" })), null);
}));

test("the AI limit and the public API read the same address, and share one bucket when there is none", () => withEnv("Fly-Client-IP", () => {
  const req = new Request("http://x/", { headers: { "fly-client-ip": "7.7.7.7", "x-forwarded-for": "1.1.1.1" } });
  assert.equal(clientId(req.headers), "7.7.7.7");
  assert.equal(clientKey(req), "7.7.7.7");
  const bare = new Request("http://x/", { headers: { "x-forwarded-for": "1.1.1.1" } });
  assert.equal(clientId(bare.headers), "anon");
  assert.equal(clientKey(bare), clientKey(new Request("http://x/")));
}));
