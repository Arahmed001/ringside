import crypto from "node:crypto";

/**
 * A small client for S3-compatible storage (Cloudflare R2, Backblaze B2, Amazon S3, MinIO), with no library: AWS Signature Version 4 over `fetch`, path-style addresses, and only the
 * five calls the off-host backup needs (put, head, get, list, delete). The secret key signs requests and is never sent, logged or put in an error message.
 */
export interface S3Config { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string }

const sha256 = (d: crypto.BinaryLike) => crypto.createHash("sha256").update(d).digest("hex");
const hmac = (k: crypto.BinaryLike, d: string) => crypto.createHmac("sha256", k).update(d).digest();
export const EMPTY_SHA256 = sha256("");
/** RFC 3986 encoding, as AWS asks for it (encodeURIComponent leaves ! ' ( ) * alone). */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export interface SignInput { method: string; url: URL; headers: Record<string, string>; payloadHash: string; accessKeyId: string; secretAccessKey: string; region: string; service?: string; now?: Date; contentShaHeader?: boolean }
/** The headers to send with a request (Authorization, x-amz-date, and x-amz-content-sha256 unless switched off for the published test vectors). */
export function signV4(i: SignInput): Record<string, string> {
  const now = i.now ?? new Date(), amz = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"), day = amz.slice(0, 8), service = i.service ?? "s3";
  const h: Record<string, string> = { ...i.headers, host: i.url.host, "x-amz-date": amz };
  if (i.contentShaHeader !== false) h["x-amz-content-sha256"] = i.payloadHash;
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]));
  const canonicalUri = i.url.pathname.split("/").map((s) => enc(decodeURIComponent(s))).join("/") || "/";
  const q = [...i.url.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)] as [string, string]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const canonical = [i.method, canonicalUri, q.map(([k, v]) => `${k}=${v}`).join("&"), names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), i.payloadHash].join("\n");
  const scope = `${day}/${i.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amz, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + i.secretAccessKey, day), i.region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

export class S3Error extends Error { constructor(public status: number, msg: string) { super(msg); } }

export function s3Client(c: S3Config, fetchImpl: typeof fetch = fetch) {
  const base = new URL(c.endpoint);
  if (base.protocol !== "https:" && !/^(127\.0\.0\.1|localhost)$/.test(base.hostname)) throw new Error("The storage address must be https (a plain http address is only allowed for this machine, for tests).");
  const urlOf = (key: string, query: Record<string, string> = {}) => {
    const u = new URL(base.href.replace(/\/$/, "") + "/" + [c.bucket, ...key.split("/")].filter((s, i) => i === 0 || s !== "" || key.endsWith("/")).map(encodeURIComponent).join("/"));
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u;
  };
  const call = async (method: string, key: string, o: { query?: Record<string, string>; body?: Buffer; type?: string; ok?: number[] } = {}) => {
    const url = urlOf(key, o.query), payloadHash = o.body ? sha256(o.body) : EMPTY_SHA256;
    const headers = signV4({ method, url, headers: o.type ? { "content-type": o.type } : {}, payloadHash, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, region: c.region });
    const res = await fetchImpl(url, { method, headers, body: o.body ? new Uint8Array(o.body) : undefined, redirect: "error", signal: AbortSignal.timeout(30 * 60_000) });
    if (!(o.ok ?? [200]).includes(res.status)) {
      const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
      throw new S3Error(res.status, `storage answered ${res.status} to ${method} ${key || "/"}: ${text}`);
    }
    return res;
  };
  const listPage = async (prefix: string, delimiter: string | null, token: string | null) => {
    const q: Record<string, string> = { "list-type": "2", prefix }; if (delimiter) q.delimiter = delimiter; if (token) q["continuation-token"] = token;
    const xml = await (await call("GET", "", { query: q })).text();
    const all = (re: RegExp) => [...xml.matchAll(re)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
    return { keys: all(/<Key>([^<]*)<\/Key>/g), prefixes: all(/<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>/g), next: /<IsTruncated>true<\/IsTruncated>/.test(xml) ? all(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/g)[0] ?? null : null };
  };
  return {
    put: (key: string, body: Buffer) => call("PUT", key, { body, type: "application/octet-stream" }).then(() => undefined),
    head: async (key: string) => Number((await call("HEAD", key)).headers.get("content-length") ?? NaN),
    get: async (key: string) => Buffer.from(await (await call("GET", key)).arrayBuffer()),
    delete: (key: string) => call("DELETE", key, { ok: [200, 204] }).then(() => undefined),
    async list(prefix: string, delimiter: string | null = null) {
      const keys: string[] = [], prefixes: string[] = []; let token: string | null = null;
      do { const p: Awaited<ReturnType<typeof listPage>> = await listPage(prefix, delimiter, token); keys.push(...p.keys); prefixes.push(...p.prefixes); token = p.next; } while (token);
      return { keys, prefixes };
    },
  };
}
