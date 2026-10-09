import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { s3Client, type S3Config } from "./s3";

/**
 * Off-host copies of the nightly backup. A backup on the disk that dies is not a backup; this sends each verified backup folder to an S3-compatible bucket (Cloudflare R2,
 * Backblaze B2, Amazon S3) the nightly job reaches through NIGHTLY_OFFSITE_CMD (docs/nightly.md section 4). The folder holds the accounts database, which is personal data, so
 * **every file is compressed and encrypted here, with a passphrase only the owner holds, before it leaves the machine**: the bucket (and whoever can read it) sees random bytes.
 * Without the passphrase nothing is sent. An upload is complete only when every file's stored size matched and a `_complete` marker was written last; a folder without the marker
 * is never offered for restoring. Old folders beyond OFFSITE_KEEP are deleted from the bucket after a good upload.
 */
const MAGIC = Buffer.from("RSBK1\0");
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
export const DEFAULT_OFFSITE_KEEP = 30;

export function encryptFile(plain: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(plain, { level: 6 })), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, c.getAuthTag()]);
}
export function decryptFile(blob: Buffer, passphrase: string): Buffer {
  if (blob.length < MAGIC.length + 16 + 12 + 16 || !blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("this is not a Ringside backup file");
  const salt = blob.subarray(6, 22), iv = blob.subarray(22, 34), tag = blob.subarray(blob.length - 16), body = blob.subarray(34, blob.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", crypto.scryptSync(passphrase, salt, 32), iv);
  d.setAuthTag(tag);
  try { return zlib.gunzipSync(Buffer.concat([d.update(body), d.final()])); }
  catch { throw new Error("wrong passphrase, or the file was damaged or changed"); }
}

export interface OffsiteConfig extends S3Config { prefix: string; passphrase: string; keep: number }
/** Reads the settings; returns the problems in plain words instead of a half-working configuration. */
export function offsiteConfig(env: Record<string, string | undefined>): { config: OffsiteConfig | null; problems: string[] } {
  const g = (k: string) => (env[k] ?? "").trim(), problems: string[] = [];
  for (const k of ["OFFSITE_S3_ENDPOINT", "OFFSITE_S3_BUCKET", "OFFSITE_S3_ACCESS_KEY_ID", "OFFSITE_S3_SECRET_ACCESS_KEY"]) if (!g(k)) problems.push(`${k} is not set`);
  if (g("BACKUP_PASSPHRASE").length < 12) problems.push("BACKUP_PASSPHRASE is missing or shorter than 12 characters: nothing is sent unencrypted, so a passphrase is required (keep a copy somewhere that is not this server: without it a copy cannot be read)");
  const keep = g("OFFSITE_KEEP") ? Number(g("OFFSITE_KEEP")) : DEFAULT_OFFSITE_KEEP;
  if (!Number.isInteger(keep) || keep < 1) problems.push(`OFFSITE_KEEP must be a whole number of 1 or more, not "${g("OFFSITE_KEEP")}"`);
  if (problems.length) return { config: null, problems };
  let prefix = g("OFFSITE_S3_PREFIX") || "ringside/";
  if (!prefix.endsWith("/")) prefix += "/";
  if (prefix.startsWith("/") || prefix.includes("..")) return { config: null, problems: ["OFFSITE_S3_PREFIX must be a plain folder name such as ringside/"] };
  return { config: { endpoint: g("OFFSITE_S3_ENDPOINT"), bucket: g("OFFSITE_S3_BUCKET"), accessKeyId: g("OFFSITE_S3_ACCESS_KEY_ID"), secretAccessKey: g("OFFSITE_S3_SECRET_ACCESS_KEY"), region: g("OFFSITE_S3_REGION") || "auto", prefix, passphrase: g("BACKUP_PASSPHRASE"), keep }, problems: [] };
}

type Client = ReturnType<typeof s3Client>;
export interface UploadResult { folder: string; files: { name: string; bytes: number }[]; pruned: string[] }

export async function uploadBackup(dir: string, cfg: OffsiteConfig, client: Client = s3Client(cfg), log: (l: string) => void = () => {}): Promise<UploadResult> {
  const folder = path.basename(path.resolve(dir));
  if (!STAMP.test(folder)) throw new Error(`${folder} is not a dated backup folder (expected a name like 2026-10-09T03-30-00Z)`);
  const names = fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isFile());
  if (!names.length) throw new Error(`${dir} holds no files to copy`);
  const files: UploadResult["files"] = [];
  for (const n of names) {
    const blob = encryptFile(fs.readFileSync(path.join(dir, n)), cfg.passphrase), key = `${cfg.prefix}${folder}/${n}.rsbk`;
    await client.put(key, blob);
    const stored = await client.head(key);
    if (stored !== blob.length) throw new Error(`${n}: the storage holds ${stored} bytes but ${blob.length} were sent; the copy is not complete`);
    files.push({ name: n, bytes: blob.length }); log(`${n}: ${(blob.length / 1048576).toFixed(1)} MB sent, encrypted, size checked`);
  }
  await client.put(`${cfg.prefix}${folder}/_complete`, Buffer.from(JSON.stringify({ files: files.map((f) => f.name), at: new Date().toISOString() })));
  // keep only the newest `keep` dated folders in the bucket; nothing else under the prefix is touched
  const { prefixes } = await client.list(cfg.prefix, "/");
  const dated = prefixes.map((p) => p.slice(cfg.prefix.length).replace(/\/$/, "")).filter((n) => STAMP.test(n)).sort();
  const pruned: string[] = [];
  for (const old of dated.slice(0, Math.max(0, dated.length - cfg.keep))) {
    for (const k of (await client.list(`${cfg.prefix}${old}/`)).keys) await client.delete(k);
    pruned.push(old); log(`removed the old copy ${old} from the bucket`);
  }
  return { folder, files, pruned };
}

/** The dated folders in the bucket that were completely uploaded, newest last. */
export async function listBackups(cfg: OffsiteConfig, client: Client = s3Client(cfg)): Promise<string[]> {
  const { prefixes } = await client.list(cfg.prefix, "/");
  const dated = prefixes.map((p) => p.slice(cfg.prefix.length).replace(/\/$/, "")).filter((n) => STAMP.test(n)).sort(), done: string[] = [];
  for (const f of dated) if ((await client.list(`${cfg.prefix}${f}/_complete`)).keys.length) done.push(f);
  return done;
}

/** Downloads and decrypts one folder (or `latest`) into outDir/<folder>/, ready for `npm run backup -- verify` and `restore`. */
export async function fetchBackup(which: string, outDir: string, cfg: OffsiteConfig, client: Client = s3Client(cfg)): Promise<{ folder: string; dir: string; files: string[] }> {
  const all = await listBackups(cfg, client);
  const folder = which === "latest" ? all[all.length - 1] : which;
  if (!folder || !all.includes(folder)) throw new Error(`no complete copy named ${which} in the bucket (complete copies: ${all.slice(-5).join(", ") || "none"})`);
  const target = path.join(path.resolve(outDir), folder);
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`${target} already exists and is not empty; choose another folder`);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const files: string[] = [];
  for (const k of (await client.list(`${cfg.prefix}${folder}/`)).keys) {
    const base = path.basename(k);
    if (base === "_complete" || !base.endsWith(".rsbk")) continue;
    const name = base.slice(0, -5);
    if (!SAFE_NAME.test(name)) throw new Error(`the bucket holds a file with an unsafe name (${name.slice(0, 40)}); nothing was written for it`);
    fs.writeFileSync(path.join(target, name), decryptFile(await client.get(k), cfg.passphrase), { mode: 0o600 });
    files.push(name);
  }
  return { folder, dir: target, files };
}
