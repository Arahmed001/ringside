import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { signV4, EMPTY_SHA256, s3Client } from "../lib/s3";
import { decryptFile, encryptFile, fetchBackup, listBackups, offsiteConfig, uploadBackup, type OffsiteConfig } from "../lib/offsite";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ringside-offsite-"));
const PASS = "a long passphrase kept somewhere else";

test("the request signing reproduces the published AWS Signature Version 4 test vector (get-vanilla)", () => {
  const h = signV4({ method: "GET", url: new URL("https://example.amazonaws.com/"), headers: {}, payloadHash: EMPTY_SHA256, accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "service", now: new Date("2015-08-30T12:36:00Z"), contentShaHeader: false });
  assert.equal(h.authorization, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
});

test("a file is compressed and encrypted; the right passphrase restores it exactly, a wrong one or a changed byte refuses", () => {
  const plain = Buffer.from("accounts: alice@example.org password-hash-123 ".repeat(500));
  const blob = encryptFile(plain, PASS);
  assert.ok(!blob.includes("alice@example.org"), "no readable text in what is stored");
  assert.ok(blob.length < plain.length / 5, "compressed too");
  assert.deepEqual(decryptFile(blob, PASS), plain);
  assert.throws(() => decryptFile(blob, "another passphrase entirely"), /wrong passphrase/);
  const bad = Buffer.from(blob); bad[60] ^= 0xff;
  assert.throws(() => decryptFile(bad, PASS), /wrong passphrase, or the file was damaged/);
  assert.throws(() => decryptFile(Buffer.from("plain text, not a backup file at all........."), PASS), /not a Ringside backup/);
});

test("the settings: every one that is missing is named, a short passphrase is refused, and a plain-http storage address is refused", () => {
  const r = offsiteConfig({});
  assert.equal(r.config, null); assert.ok(r.problems.some((p) => /OFFSITE_S3_ENDPOINT/.test(p)) && r.problems.some((p) => /BACKUP_PASSPHRASE/.test(p)));
  assert.equal(offsiteConfig({ OFFSITE_S3_ENDPOINT: "https://x.example", OFFSITE_S3_BUCKET: "b", OFFSITE_S3_ACCESS_KEY_ID: "k", OFFSITE_S3_SECRET_ACCESS_KEY: "s", BACKUP_PASSPHRASE: "short" }).config, null);
  const ok = offsiteConfig({ OFFSITE_S3_ENDPOINT: "https://x.example", OFFSITE_S3_BUCKET: "b", OFFSITE_S3_ACCESS_KEY_ID: "k", OFFSITE_S3_SECRET_ACCESS_KEY: "s", BACKUP_PASSPHRASE: PASS });
  assert.equal(ok.config?.region, "auto"); assert.equal(ok.config?.prefix, "ringside/"); assert.equal(ok.config?.keep, 30);
  assert.throws(() => s3Client({ endpoint: "http://storage.example.com", bucket: "b", accessKeyId: "k", secretAccessKey: "s", region: "auto" }), /must be https/);
  assert.equal(offsiteConfig({ ...{ OFFSITE_S3_ENDPOINT: "https://x.example", OFFSITE_S3_BUCKET: "b", OFFSITE_S3_ACCESS_KEY_ID: "k", OFFSITE_S3_SECRET_ACCESS_KEY: "s", BACKUP_PASSPHRASE: PASS }, OFFSITE_S3_PREFIX: "../x" }).config, null);
});

/** A stand-in storage service: path-style addresses, signed requests checked for the shape that matters, objects held in memory. */
async function storage(opts: { truncate?: boolean } = {}) {
  const objects = new Map<string, Buffer>(), seen: { method: string; auth: string }[] = [];
  const srv = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x"), auth = String(req.headers.authorization ?? "");
      seen.push({ method: req.method!, auth });
      if (!/^AWS4-HMAC-SHA256 Credential=KEYID\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/.test(auth) || !req.headers["x-amz-content-sha256"]) { res.writeHead(403).end("<Error>bad signature shape</Error>"); return; }
      const key = decodeURIComponent(u.pathname).replace(/^\/bucket\/?/, "");
      if (req.method === "PUT") { const b = Buffer.concat(chunks); objects.set(key, opts.truncate ? b.subarray(0, b.length - 5) : b); res.writeHead(200).end(); }
      else if (req.method === "HEAD") { const o = objects.get(key); if (o) res.writeHead(200, { "content-length": String(o.length) }).end(); else res.writeHead(404).end(); }
      else if (req.method === "DELETE") { objects.delete(key); res.writeHead(204).end(); }
      else if (req.method === "GET" && u.searchParams.get("list-type") === "2") {
        const prefix = u.searchParams.get("prefix") ?? "", delim = u.searchParams.get("delimiter"), keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort(), prefixes = new Set<string>(), direct: string[] = [];
        for (const k of keys) { const rest = k.slice(prefix.length), i = delim ? rest.indexOf(delim) : -1; if (i >= 0) prefixes.add(prefix + rest.slice(0, i + 1)); else direct.push(k); }
        res.writeHead(200, { "content-type": "application/xml" }).end(`<ListBucketResult><IsTruncated>false</IsTruncated>${direct.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}${[...prefixes].map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join("")}</ListBucketResult>`);
      } else if (req.method === "GET") { const o = objects.get(key); if (o) res.writeHead(200).end(o); else res.writeHead(404).end("<Error>NoSuchKey</Error>"); }
      else res.writeHead(405).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const cfg: OffsiteConfig = { endpoint: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, bucket: "bucket", accessKeyId: "KEYID", secretAccessKey: "SECRET", region: "auto", prefix: "ringside/", passphrase: PASS, keep: 2 };
  return { objects, seen, cfg, close: () => srv.close() };
}
function backupFolder(root: string, stamp: string, accounts = "alice@example.org hash:abc") {
  const d = path.join(root, stamp); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "ringside.db"), Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(50_000, 3)]));
  fs.writeFileSync(path.join(d, "accounts.db"), accounts); fs.writeFileSync(path.join(d, "checksums.sha256"), "abc  ringside.db\n");
  return d;
}

test("a backup folder is uploaded encrypted with a size check and a completion marker, listed, and fetched back byte for byte; the bucket never holds readable account data", async () => {
  const s = await storage(), root = tmp();
  try {
    const dir = backupFolder(root, "2026-10-09T03-30-00Z", "alice@example.org hash:abc");
    const r = await uploadBackup(dir, s.cfg);
    assert.deepEqual(r.files.map((f) => f.name).sort(), ["accounts.db", "checksums.sha256", "ringside.db"]);
    assert.ok([...s.objects.keys()].every((k) => k.startsWith("ringside/2026-10-09T03-30-00Z/")));
    for (const [k, v] of s.objects) if (k.endsWith(".rsbk")) assert.ok(!v.includes("alice@example.org"), `${k} holds no readable account data`);
    assert.ok(s.seen.every((x) => x.auth.startsWith("AWS4-HMAC-SHA256")));
    assert.deepEqual(await listBackups(s.cfg), ["2026-10-09T03-30-00Z"]);
    const out = tmp(), got = await fetchBackup("latest", out, s.cfg);
    assert.deepEqual(got.files.sort(), ["accounts.db", "checksums.sha256", "ringside.db"]);
    for (const n of got.files) assert.deepEqual(fs.readFileSync(path.join(got.dir, n)), fs.readFileSync(path.join(dir, n)));
    await assert.rejects(fetchBackup("latest", out, s.cfg), /already exists/);
    await assert.rejects(fetchBackup("2020-01-01T00-00-00Z", tmp(), s.cfg), /no complete copy/);
  } finally { s.close(); }
});

test("only the newest OFFSITE_KEEP dated folders stay in the bucket, and other objects under the prefix are left alone", async () => {
  const s = await storage(), root = tmp();
  try {
    s.objects.set("ringside/README.txt", Buffer.from("mine"));
    for (const st of ["2026-10-07T03-30-00Z", "2026-10-08T03-30-00Z", "2026-10-09T03-30-00Z"]) await uploadBackup(backupFolder(root, st), s.cfg);
    assert.deepEqual(await listBackups(s.cfg), ["2026-10-08T03-30-00Z", "2026-10-09T03-30-00Z"]);
    assert.ok(![...s.objects.keys()].some((k) => k.includes("2026-10-07")), "everything under the oldest folder was removed");
    assert.ok(s.objects.has("ringside/README.txt"));
  } finally { s.close(); }
});

test("an upload whose stored size does not match is an error, and a folder without the completion marker is never offered for restoring", async () => {
  const s = await storage({ truncate: true }), root = tmp();
  try {
    await assert.rejects(uploadBackup(backupFolder(root, "2026-10-09T03-30-00Z"), s.cfg), /the copy is not complete/);
    assert.deepEqual(await listBackups(s.cfg), [], "no _complete marker was written");
    await assert.rejects(fetchBackup("latest", tmp(), s.cfg), /no complete copy/);
    await assert.rejects(uploadBackup(path.join(root, "not-a-dated-folder"), s.cfg), /not a dated backup folder/);
  } finally { s.close(); }
});
