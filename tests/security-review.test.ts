import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";
import { limits } from "../lib/accounts/guard";

/** Regression tests from the pre-launch security review (docs/security-review.md). Each one fails on the code as it was before its fix. */
const cleanup = tempDb("secreview");
const accFile = path.join(os.tmpdir(), `ringside-test-secreview-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });
beforeEach(() => { for (const l of Object.values(limits())) l.reset(); });

const HOST = "http://localhost:3100";
const PW = "correct horse battery";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
async function call(h: (req: Request) => Promise<Response>, method: string, body?: unknown, o: { cookie?: string; ip?: string } = {}): Promise<{ status: number; json: Json; cookie?: string }> {
  const headers: Record<string, string> = { "content-type": "application/json", origin: HOST, "x-forwarded-for": o.ip ?? "10.9.0.1" };
  if (o.cookie) headers.cookie = o.cookie;
  const res = await h(new Request(`${HOST}/api/x`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

test("a request body is cut off at the cap while it arrives, not read whole first", async () => {
  const { postBody } = await import("../lib/accounts/api");
  // no Content-Length (a chunked upload): the stream is cancelled soon after the cap, long before its 50 MB are pulled
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled += 1; c.enqueue(new Uint8Array(1024).fill(97)); if (pulled >= 50_000) c.close(); } });
  const big = new Request(`${HOST}/api/x`, { method: "POST", headers: { origin: HOST }, body: stream, duplex: "half" } as RequestInit);
  const res = await postBody(big);
  assert.ok(res instanceof Response && res.status === 413, "too large");
  assert.ok(pulled < 200, `the stream was read to ${pulled} KB before the refusal`);
  // a declared length over the cap is refused before the body is touched
  const declared = new Request(`${HOST}/api/x`, { method: "POST", headers: { origin: HOST, "content-length": String(10_000_000) }, body: "{}" });
  const d = await postBody(declared);
  assert.ok(d instanceof Response && d.status === 413);
  // the cap counts bytes: 9,000 two-byte characters is 18 KB, over, though under 16K characters
  const wide = await postBody(new Request(`${HOST}/api/x`, { method: "POST", headers: { origin: HOST }, body: JSON.stringify({ a: "é".repeat(9000) }) }));
  assert.ok(wide instanceof Response && wide.status === 413, "bytes, not characters");
  // an ordinary body still passes
  const ok = await postBody(new Request(`${HOST}/api/x`, { method: "POST", headers: { origin: HOST }, body: JSON.stringify({ a: "é" }) }));
  assert.ok(!(ok instanceof Response) && ok.body.a === "é");
});

test("a typed username cannot spend another limiter's allowance (the password and delete limits of a real account)", async () => {
  const login = (await import("../app/api/account/login/route")).POST;
  const signup = (await import("../app/api/account/signup/route")).POST;
  const password = (await import("../app/api/account/password/route")).POST;
  const me = await call(signup, "POST", { username: "victim_vv", password: PW });
  assert.equal(me.status, 201);
  const id = me.json.user.id as number;
  for (const key of [`pw:${id}`, `del:${id}`, `reset:victim_vv`]) {
    for (let i = 0; i < 8; i++) await call(login, "POST", { username: key, password: "whatever whatever" }, { ip: `10.9.1.${i}` });
  }
  assert.equal(limits().loginName.left(`pw:${id}`), limits().loginName.max, "pw limiter untouched");
  assert.equal(limits().loginName.left(`del:${id}`), limits().loginName.max, "delete limiter untouched");
  assert.equal(limits().loginName.left("reset:victim_vv"), limits().loginName.max, "reset limiter untouched");
  const changed = await call(password, "POST", { current: PW, next: "another long passphrase" }, { cookie: me.cookie });
  assert.equal(changed.status, 200, "the account owner can still change the password");
});

test("a refused report or proposal does not forgive the ones already accepted today", async () => {
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  const signup = (await import("../app/api/account/signup/route")).POST;
  const contribute = (await import("../app/api/contribute/route")).POST;
  const boxer = db.prepare("SELECT external_id e FROM boxers WHERE active = 1 LIMIT 1").get() as { e: string };
  const u = await call(signup, "POST", { username: "spammy_ss", password: PW });
  const body = (i: number) => ({ boxerExt: boxer.e, role: "head_trainer", personName: `Coach Number${"abcdefghijklmnop"[i]}`, start: `2015-0${(i % 9) + 1}-01`, end: null, sourceUrl: "https://example.org/profile", quote: `Coach Number${"abcdefghijklmnop"[i]} has trained him since 2015` });
  for (let i = 0; i < 9; i++) assert.equal((await call(contribute, "POST", body(i), { cookie: u.cookie })).status, 201, `proposal ${i}`);
  // the loop an abuser would run: an invalid proposal, then a valid one, over and over
  const refused = await call(contribute, "POST", { ...body(10), role: "promoter" }, { cookie: u.cookie });
  assert.equal(refused.status, 400);
  assert.equal((await call(contribute, "POST", body(9), { cookie: u.cookie })).status, 201, "the tenth is the last");
  assert.equal((await call(contribute, "POST", body(11), { cookie: u.cookie })).status, 429, "still over the day's ten");
});
