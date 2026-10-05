/**
 * npm run vendor:fetch -- --setup             save the key to ~/.ringside-key (hidden prompt, readable by you only); once, in a real terminal tab
 * npm run vendor:fetch [-- extra options]     the paced fetch into the cache (`--check --per-hour 400 --patience-min 240`, in ~/ringside-real/vendor-cache when it
 *                                             exists), with the key read from that file. Extra options go to `vendor:backfill` and win over the same default;
 *                                             `--no-check` drops `--check` (for the load itself); `--key-file PATH` and `--cache-dir DIR` choose the files.
 * The key is never printed or put on a command line; the fetch is started with it in its environment only. On a Mac the machine is kept awake while it runs (caffeinate).
 * Only one fetch per key runs at a time: a second is refused (stop the first with Ctrl-C in its tab).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { DEFAULT_KEY_FILE, defaultCacheDir, fetchArgs, readKeyFile, writeKeyFile } from "../lib/vendor-fetch";

const argv = process.argv.slice(2);
const take = (flag: string): string | undefined => { const i = argv.indexOf(flag); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, v === undefined || v.startsWith("--") ? 1 : 2); return v; };

/** Reads a line without echoing it. Needs a real terminal: a chat box or a pipe is not one, and says so rather than appearing to take the key. */
function hiddenPrompt(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return reject(new Error("--setup needs a real terminal tab (it hides what you type). This is not one: open a tab in your terminal panel and run it there."));
    process.stdout.write(question);
    let buf = "";
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    const done = (fn: () => void) => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", onData); process.stdout.write("\n"); fn(); };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(buf));
        if (ch === "\u0003") return done(() => reject(new Error("cancelled")));
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1); else buf += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  const setup = argv.includes("--setup"); if (setup) argv.splice(argv.indexOf("--setup"), 1);
  const noCaffeinate = argv.includes("--no-caffeinate"); if (noCaffeinate) argv.splice(argv.indexOf("--no-caffeinate"), 1);
  const keyFile = path.resolve(take("--key-file") ?? process.env.RINGSIDE_KEY_FILE ?? DEFAULT_KEY_FILE);
  const cacheArg = take("--cache-dir");
  if (setup) {
    const key = await hiddenPrompt("RapidAPI key (hidden; it is saved to a file only you can read): ");
    writeKeyFile(keyFile, key);
    console.log(`saved to ${keyFile} (${key.trim().length} characters, readable by you only). It is never printed.\nStart the fetch with:  npm run vendor:fetch`);
    return;
  }
  const key = readKeyFile(keyFile);
  const cacheDir = cacheArg ?? defaultCacheDir();
  const args = fetchArgs([...argv, ...(cacheArg ? ["--cache-dir", cacheArg] : [])], cacheDir);
  console.log(`vendor:fetch: key from ${keyFile} (${key.length} characters), vendor:backfill ${args.join(" ")}`);
  const child = spawn(process.execPath, ["--import", "tsx", path.join(__dirname, "vendor-backfill.ts"), ...args], { stdio: "inherit", env: { ...process.env, BOXING_API_KEY: key } });
  if (process.platform === "darwin" && !noCaffeinate && child.pid) { try { spawn("caffeinate", ["-i", "-w", String(child.pid)], { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* not available: the machine may sleep */ } }
  child.on("close", (code) => process.exit(code ?? 1));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
