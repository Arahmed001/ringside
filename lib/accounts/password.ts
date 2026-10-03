import crypto from "node:crypto";

/**
 * Passwords are stored as scrypt hashes with a random salt per user, never in a form that can be read back:
 *   scrypt$N$r$p$salt$hash   (salt and hash base64url). The cost parameters live in the string, so they can be raised later
 * and old hashes keep verifying (and `needsRehash` says when to upgrade one at the next login).
 */
const COST = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const MAX_MEM = 128 * COST.N * COST.r * 2;

const derive = (pw: string, salt: Buffer, N: number, r: number, p: number, keylen: number) =>
  new Promise<Buffer>((resolve, reject) => crypto.scrypt(pw.normalize("NFKC"), salt, keylen, { N, r, p, maxmem: Math.max(MAX_MEM, 128 * N * r * 2) }, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await derive(pw, salt, COST.N, COST.r, COST.p, COST.keylen);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await derive(pw, Buffer.from(salt, "base64url"), Number(N), Number(r), Number(p), want.length);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export const needsRehash = (stored: string) => { const [, N, r, p] = stored.split("$"); return Number(N) !== COST.N || Number(r) !== COST.r || Number(p) !== COST.p; };

/** A hash nobody knows the password of, so a login for an unknown name costs the same time as a wrong password for a real one. */
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword(crypto.randomBytes(24).toString("hex")));

export const MIN_PASSWORD = 10, MAX_PASSWORD = 200;
const COMMON = new Set(["password", "password1", "1234567890", "qwertyuiop", "iloveyou12", "letmein123", "admin12345", "ringside123", "boxing1234", "0123456789", "1q2w3e4r5t", "passw0rd12"]);

/** Reasons a password is refused (codes, so the client can translate them). Length counts characters, not bytes: an Arabic passphrase is fine. */
export function passwordProblems(pw: unknown, username = ""): ("short" | "long" | "common" | "username" | "same_char")[] {
  const p: ReturnType<typeof passwordProblems> = [];
  if (typeof pw !== "string" || [...pw].length < MIN_PASSWORD) p.push("short");
  if (typeof pw === "string") {
    if ([...pw].length > MAX_PASSWORD) p.push("long");
    const low = pw.toLowerCase();
    if (COMMON.has(low)) p.push("common");
    if (username && low.includes(username.toLowerCase()) && username.length >= 3) p.push("username");
    if (new Set([...pw]).size <= 2 && pw.length) p.push("same_char");
  }
  return p;
}
