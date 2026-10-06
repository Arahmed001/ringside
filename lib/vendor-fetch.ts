import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertPlausibleKey } from "./providers/boxing-data-api";

/**
 * `npm run vendor:fetch` (round 85): starts the paced fetch with the key read from a file only the owner can read, so it starts the same way from any terminal tab.
 * The key was typed into the wrong place again and again (a chat box, a tab that did not have it, a placeholder); a file removes that. Nothing here prints the key.
 */
export const DEFAULT_KEY_FILE = path.join(os.homedir(), ".ringside-key");

/**
 * Text that is plainly a stand-in for a key ("your-key-here", "paste-your-real-key-here"): made of nothing but placeholder words and separators. Deliberately narrow:
 * a real key is random, and one that merely CONTAINS "here" must not be refused.
 */
export const looksLikePlaceholder = (key: string): boolean => /^(?:[-_.\s]*(?:paste|your|put|insert|enter|replace|real|rapidapi|api|key|here|token|secret|xxx+)[-_.\s]*)+$/i.test(key.trim());

export interface KeyFileState { exists: boolean; /** readable by nobody but the owner */ private: boolean; length: number; placeholder: boolean }
/** What the key file is like, never its content. */
export function keyFileState(file: string): KeyFileState {
  try {
    const st = fs.statSync(file);
    const k = fs.readFileSync(file, "utf8").trim();
    return { exists: true, private: (st.mode & 0o077) === 0, length: k.length, placeholder: k.length < 30 || /\s|…|\.\.\./.test(k) || looksLikePlaceholder(k) };
  } catch { return { exists: false, private: false, length: 0, placeholder: false }; }
}

/** The key in the file. Refuses a file other users can read (with the command that fixes it), an empty one and one that is plainly a placeholder. */
export function readKeyFile(file: string): string {
  if (!fs.existsSync(file)) throw new Error(`There is no key file at ${file}. Create it once, in a real terminal tab (not a chat box):  npm run vendor:fetch -- --setup`);
  const st = fs.statSync(file);
  if ((st.mode & 0o077) !== 0) throw new Error(`${file} can be read by other users on this machine. Fix it with:  chmod 600 ${file}`);
  const key = fs.readFileSync(file, "utf8").trim();
  if (!key) throw new Error(`${file} is empty. Fill it again with:  npm run vendor:fetch -- --setup`);
  try { assertPlausibleKey(key, true); if (looksLikePlaceholder(key)) throw new Error("BOXING_API_KEY is not a plausible API key (it is placeholder text, such as `your-key-here`): it looks like a placeholder was pasted instead of the real key."); } catch (e) { throw new Error(`${file}: ${(e as Error).message.replace("BOXING_API_KEY", "the key in it")} Fill it again with:  npm run vendor:fetch -- --setup`); }
  return key;
}

/** Writes the key to `file`, readable by its owner only. The key is checked first and is never put in a message. */
export function writeKeyFile(file: string, key: string): void {
  const k = key.trim();
  try { assertPlausibleKey(k, true); if (looksLikePlaceholder(k)) throw new Error("BOXING_API_KEY is not a plausible API key (it is placeholder text, such as `your-key-here`): it looks like a placeholder was pasted instead of the real key."); } catch (e) { throw new Error((e as Error).message.replace("BOXING_API_KEY", "The key you entered")); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, k + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600); // a file that already existed keeps its old mode otherwise
}

/** The default cache of the real fetch, when it exists on this machine; otherwise the backfill's own default (undefined). */
export const defaultCacheDir = (): string | undefined => { const d = path.join(os.homedir(), "ringside-real/vendor-cache"); return fs.existsSync(d) ? d : undefined; };

/**
 * The arguments for `vendor-backfill`: a fetch into the cache that does not touch the database (`--check`), paced under the plan's limit (`--per-hour 400`), patient with
 * rate limits and a network that drops (`--patience-min 240`), in the cache directory. Anything the user passes wins over the same default; `--no-check` drops `--check`
 * (for the load itself).
 */
export function fetchArgs(user: string[], cacheDir?: string): string[] {
  const has = (f: string) => user.includes(f);
  const rest = user.filter((a) => a !== "--no-check");
  const out: string[] = [];
  if (!has("--no-check") && !has("--check") && !has("--plan") && !has("--update")) out.push("--check");
  if (!has("--per-hour")) out.push("--per-hour", "400");
  if (!has("--patience-min")) out.push("--patience-min", "240");
  if (!has("--cache-dir") && cacheDir) out.push("--cache-dir", cacheDir);
  return [...out, ...rest];
}

/**
 * `--background` (round 102): the fetch takes days, and one run in a terminal tab died with the tab (closing the panel ended it overnight, with 20,000 fighters to go). In the
 * background it is its own process group, its output goes to a log file next to the cache, and its process id to a file, so a closed tab, a closed panel or a new
 * session cannot end it. A Mac that sleeps or restarts still stops it (the same command starts it again; nothing fetched is lost).
 */
export function backgroundFiles(cacheDir?: string): { log: string; pid: string } {
  const dir = cacheDir ? path.dirname(path.resolve(cacheDir)) : path.dirname(path.join(os.homedir(), "ringside-real/vendor-cache"));
  return { log: path.join(dir, "fetch.log"), pid: path.join(dir, "fetch.pid") };
}

/** The process id in `pidFile` when that process is alive AND its command matches `kind` (a recycled id belonging to something else is not touched); otherwise undefined. */
export function livePid(pidFile: string, kind: RegExp): number | undefined {
  let pid: number;
  try { pid = Number(fs.readFileSync(pidFile, "utf8").trim()); } catch { return undefined; }
  if (!Number.isInteger(pid) || pid <= 1) return undefined;
  try { process.kill(pid, 0); } catch { return undefined; }
  try { return kind.test(execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" })) ? pid : undefined; } catch { return undefined; }
}

/** The process id of a live background fetch (see `livePid`). */
export const backgroundPid = (pidFile: string): number | undefined => livePid(pidFile, /vendor-backfill/);

/** The last `n` lines of a log (never the key: nothing here prints it, and the fetch does not either). */
export function logTail(file: string, n = 5): string[] {
  try { return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-n); } catch { return []; }
}
