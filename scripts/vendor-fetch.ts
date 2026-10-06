/**
 * npm run vendor:fetch -- --setup             save the key to ~/.ringside-key (hidden prompt, readable by you only); once, in a real terminal tab
 * npm run vendor:fetch [-- extra options]     the paced fetch into the cache (`--check --per-hour 400 --patience-min 240`, in ~/ringside-real/vendor-cache when it
 *                                             exists), with the key read from that file. Extra options go to `vendor:backfill` and win over the same default;
 *                                             `--no-check` drops `--check` (for the load itself); `--key-file PATH` and `--cache-dir DIR` choose the files.
 * The key is never printed or put on a command line; the fetch is started with it in its environment only. On a Mac the machine is kept awake while it runs (caffeinate).
 * Only one fetch per key runs at a time: a second is refused (stop the first with Ctrl-C in its tab).
 * npm run vendor:fetch -- --background       the same fetch, detached from the terminal: closing the tab or the panel does not end it. Output goes to fetch.log beside
 *                                             the cache, the process id to fetch.pid; `vendor:status` shows it running.
 * npm run vendor:fetch -- --stop              ends a background fetch (nothing fetched is lost; --background starts it again where it stopped).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_KEY_FILE, backgroundFiles, backgroundPid, defaultCacheDir, fetchArgs, logTail, readKeyFile, writeKeyFile } from "../lib/vendor-fetch";

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
  const stop = argv.includes("--stop"); if (stop) argv.splice(argv.indexOf("--stop"), 1);
  const checkMs = take("--bg-check-ms"); // how long --background waits to catch an immediate refusal (the tests lengthen it)
  const background = argv.includes("--background"); if (background) argv.splice(argv.indexOf("--background"), 1);
  if (stop) {
    const files = backgroundFiles(cacheArg ?? defaultCacheDir()), pid = backgroundPid(files.pid);
    if (!pid) { console.log(`No background fetch is running (no live process in ${files.pid}). A fetch started in a terminal tab is stopped with Ctrl-C in that tab.`); return; }
    process.kill(pid, "SIGTERM");
    console.log(`Stopped the background fetch (process ${pid}). What it fetched is in the cache; start it again with:  npm run vendor:fetch -- --background`);
    return;
  }
  const key = readKeyFile(keyFile);
  const cacheDir = cacheArg ?? defaultCacheDir();
  const args = fetchArgs([...argv, ...(cacheArg ? ["--cache-dir", cacheArg] : [])], cacheDir);
  console.log(`vendor:fetch: key from ${keyFile} (${key.length} characters), vendor:backfill ${args.join(" ")}`);
  if (background) {
    const files = backgroundFiles(cacheDir), running = backgroundPid(files.pid);
    if (running) { console.error(`A background fetch is already running (process ${running}, log ${files.log}). Stop it with:  npm run vendor:fetch -- --stop`); process.exit(1); }
    fs.mkdirSync(path.dirname(files.log), { recursive: true });
    const out = fs.openSync(files.log, "a");
    fs.writeSync(out, `\n--- ${new Date().toISOString()} background fetch started: vendor:backfill ${args.join(" ")}\n`);
    const bg = spawn(process.execPath, ["--import", "tsx", path.join(__dirname, "vendor-backfill.ts"), ...args], { stdio: ["ignore", out, out], detached: true, env: { ...process.env, BOXING_API_KEY: key } });
    let ended: number | null | undefined;
    bg.on("exit", (code) => { ended = code; });
    bg.unref();
    if (!bg.pid) { console.error("The fetch could not be started."); process.exit(1); }
    fs.writeFileSync(files.pid, `${bg.pid}\n`);
    if (process.platform === "darwin" && !noCaffeinate) { try { spawn("caffeinate", ["-i", "-w", String(bg.pid)], { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* not available: the machine may sleep */ } }
    // a refusal (another fetch for this key, a bad key file, a missing cache) comes in the first seconds: say so now rather than leave a dead process behind a hopeful message
    await new Promise((r) => setTimeout(r, Number(checkMs ?? 4000)));
    if (ended === 0) { console.log(`The fetch had nothing left to wait for and already finished (exit 0). The end of ${files.log}:\n  ${logTail(files.log, 4).join("\n  ")}`); return; }
    if (ended !== undefined || !backgroundPid(files.pid)) { console.error(`The background fetch stopped at once (exit ${ended ?? "unknown"}). The end of ${files.log}:\n  ${logTail(files.log, 8).join("\n  ")}`); process.exit(1); }
    console.log(`Started in the background (process ${bg.pid}). Closing this tab or the terminal panel does not stop it.\n  progress:  npm run vendor:status   (or:  tail -f ${files.log})\n  stop:      npm run vendor:fetch -- --stop`);
    return;
  }
  const child = spawn(process.execPath, ["--import", "tsx", path.join(__dirname, "vendor-backfill.ts"), ...args], { stdio: "inherit", env: { ...process.env, BOXING_API_KEY: key } });
  if (process.platform === "darwin" && !noCaffeinate && child.pid) { try { spawn("caffeinate", ["-i", "-w", String(child.pid)], { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* not available: the machine may sleep */ } }
  child.on("close", (code) => process.exit(code ?? 1));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
