import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupDatabases, sha256File, verifyBackup } from "./backup";

/**
 * Putting a backup back, carefully. The order matters and every step can stop the whole thing before anything is changed:
 *   1. the backup must verify (every database opens, integrity_check ok, every checksum matches the list written when it was made);
 *   2. the site must not be running (a running site holds the files open and would write over the restore);
 *   3. a safety copy of what is there NOW is taken and checked: that is the way back;
 *   4. the new files are written beside the old ones, flushed to disk and checked again;
 *   5. only then are they swapped in with `rename` (atomic: a reader sees the old file or the new one, never half of one),
 *      the old `-wal` and `-shm` files are removed (they belong to the old database and must never be applied to the new one),
 *      and if anything fails part-way the files already swapped are put back.
 * `dryRun` does steps 1 and 2 and reports what it would do; it writes nothing. Nothing here prints a row, a name or a password: only paths, sizes and counts.
 */
export interface RestoreTarget { name: string; path: string; private?: boolean }
export interface RestoreOptions {
  backupDir: string;
  /** The live databases, by backup file name (`ringside` is `ringside.db` in the backup). */
  databases: RestoreTarget[];
  /** Extra plain files restored as they are, if the backup has them (model-fit.json). */
  extra?: RestoreTarget[];
  /** Where the safety copy of the current data goes (a fresh dated folder inside it). */
  safetyRoot: string;
  dryRun?: boolean;
  /** Go ahead although the site may be running (the person says they stopped it, or it is a copy being rehearsed). */
  allowRunning?: boolean;
  /** Accept a backup with no checksum list (made before checksums were written). Integrity is still checked. */
  allowUnchecked?: boolean;
  now?: Date;
  /** Returns reasons the site might be running (empty = none found). Replaceable for tests. */
  detectRunning?: () => Promise<string[]> | string[];
  /** The port the site listens on, probed when there is no `detectRunning` (the image's is 3000). */
  port?: number;
  /** Test hooks that throw to simulate a crash: `afterStage` before any file is swapped, `beforeSwap(i)` before the i-th file is. */
  hooks?: { afterStage?: () => void; beforeSwap?: (i: number, name: string) => void };
}
export interface RestoreResult {
  ok: boolean;
  dryRun: boolean;
  refused: string[];
  /** Plain-language lines of what was (or would be) done. */
  did: string[];
  safetyDir: string | null;
  restored: string[];
  /** Counts read from the restored files (never contents). */
  counts: string[];
}

const TMP = ".restore-tmp", OLD = ".restore-old";
const fsyncFile = (f: string) => { const fd = fs.openSync(f, "r+"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
const fsyncDir = (d: string) => { try { const fd = fs.openSync(d, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch { /* some filesystems cannot flush a directory; the rename is still atomic */ } };
const sidecars = (f: string) => [`${f}-wal`, `${f}-shm`, `${f}-journal`];
const kb = (f: string) => `${Math.max(1, Math.round(fs.statSync(f).size / 1024))} KB`;

/** The ways to tell that something may still be using the database: a process that has it open (Linux), a leftover -wal/-shm where /proc cannot be read, a server answering on the site's port. */
export async function siteMightBeRunning(files: string[], port = 3000): Promise<string[]> {
  const why: string[] = [];
  let procOk = false;
  const real = new Set(files.filter((f) => fs.existsSync(f)).map((f) => fs.realpathSync(f)));
  try {
    procOk = fs.existsSync("/proc/self/fd");
    for (const pid of fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n) && +n !== process.pid)) {
      try {
        for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
          let t = ""; try { t = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
          if (real.has(t)) { why.push(`another program (process ${pid}) has ${path.basename(t)} open`); break; }
        }
      } catch { /* not ours to look at */ }
    }
  } catch { /* no /proc here (macOS): the other checks still run */ }
  // Where /proc can be read, "who has it open" is the real answer, and a leftover -wal/-shm only means the last program to use the files (a script, a crashed site) did not tidy up.
  // Where it cannot (macOS), the leftover files are the only sign there is.
  if (!procOk) for (const f of files) for (const s of [`${f}-wal`, `${f}-shm`]) if (fs.existsSync(s)) why.push(`${path.basename(s)} exists (a site that was shut down cleanly leaves none)`);
  const answering = await new Promise<boolean>((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (v: boolean) => { sock.destroy(); resolve(v); };
    sock.setTimeout(500, () => done(false)); sock.once("connect", () => done(true)); sock.once("error", () => done(false));
  });
  if (answering) why.push(`something is answering on port ${port} (the site?)`);
  return [...new Set(why)];
}

const countOf = (file: string, table: string, label: string): string | null => {
  try { const db = new DatabaseSync(file, { readOnly: true }); try { return `${(db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c} ${label}`; } finally { db.close(); } } catch { return null; }
};
const integrityOk = (file: string) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return String((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check) === "ok"; } finally { db.close(); }
};

export async function restoreBackup(o: RestoreOptions): Promise<RestoreResult> {
  const r: RestoreResult = { ok: false, dryRun: !!o.dryRun, refused: [], did: [], safetyDir: null, restored: [], counts: [] };
  const refuse = (...why: string[]) => { r.refused.push(...why); return r; };

  // 1. the backup must be good
  if (!fs.existsSync(o.backupDir) || !fs.statSync(o.backupDir).isDirectory()) return refuse(`${o.backupDir} is not a folder`);
  const problems = verifyBackup(o.backupDir, { requireChecksums: !o.allowUnchecked });
  if (problems.length) return refuse("the backup did not verify, so nothing was changed:", ...problems.map((p) => `  ${p}`));
  const items = [
    ...o.databases.filter((t) => fs.existsSync(path.join(o.backupDir, `${t.name}.db`))).map((t) => ({ ...t, from: path.join(o.backupDir, `${t.name}.db`), db: true })),
    ...(o.extra ?? []).filter((t) => fs.existsSync(path.join(o.backupDir, path.basename(t.path)))).map((t) => ({ ...t, from: path.join(o.backupDir, path.basename(t.path)), db: false })),
  ];
  if (!items.some((i) => i.db)) return refuse("the backup has no database files to restore");
  r.did.push(`backup ${o.backupDir} verifies (${o.allowUnchecked ? "integrity only: no checksum list" : "integrity and checksums"})`);
  for (const t of o.databases) if (!items.some((i) => i.name === t.name)) r.did.push(`the backup has no ${t.name}.db: the current ${path.basename(t.path)} is left exactly as it is`);

  // 2. the site must be stopped
  const running = await (o.detectRunning ?? (() => siteMightBeRunning(o.databases.map((t) => t.path), o.port)))();
  if (running.length && !o.allowRunning) return refuse("the site might be running, so nothing was changed:", ...running.map((w) => `  ${w}`), "Stop the site, then run this again. If you are sure it is stopped (or this is a copy), add --even-if-running.");
  if (running.length) r.did.push(`the site might be running (${running.length} sign${running.length > 1 ? "s" : ""}); carrying on because you said so`);

  const current = o.databases.filter((t) => fs.existsSync(t.path));
  const stamp = (o.now ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  if (o.dryRun) {
    if (current.length) r.did.push(`would copy the current data to ${path.join(o.safetyRoot, stamp)} first`);
    for (const i of items) r.did.push(`would replace ${i.path} (${fs.existsSync(i.path) ? kb(i.path) : "does not exist yet"}) with ${i.from} (${kb(i.from)})`);
    r.did.push("would remove the old -wal and -shm files beside the databases");
    r.did.push("dry run: nothing was changed");
    r.ok = true; return r;
  }

  // leftovers of an earlier crash: staged copies are junk, but a set-aside original is the old data and is never deleted for you
  for (const i of items) {
    if (fs.existsSync(i.path + OLD)) return refuse(`${i.path}${OLD} exists: an earlier restore stopped half way and set the old file aside. Look at it before doing anything else (it may be the data you want); rename it back to ${path.basename(i.path)} or move it away.`);
    fs.rmSync(i.path + TMP, { force: true });
  }

  // 3. a safety copy of what is there now
  if (current.length) {
    const extraCur = (o.extra ?? []).filter((t) => fs.existsSync(t.path));
    try { r.safetyDir = backupDatabases({ root: o.safetyRoot, files: current.map((t) => ({ name: t.name, path: t.path, private: t.private })), extra: extraCur, keep: 50, now: o.now }).dir; }
    catch (e) { return refuse(`could not take the safety copy of the current data (${(e as Error).message}), so nothing was changed.`); }
    const bad = verifyBackup(r.safetyDir);
    if (bad.length) return refuse("the safety copy of the current data did not verify, so nothing was changed:", ...bad.map((p) => `  ${p}`));
    r.did.push(`saved the current data to ${r.safetyDir} (checked)`);
    for (const t of current) { // fold the old write-ahead logs into the files now, so removing them later loses nothing
      try { const db = new DatabaseSync(t.path); try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { db.close(); } } catch { /* the safety copy already holds everything */ }
    }
  } else r.did.push("there was no current data to save");

  // 4. write the new files beside the old ones
  const staged: typeof items = [];
  const swapped: { path: string; hadOld: boolean }[] = [];
  const cleanup = () => { for (const i of staged) fs.rmSync(i.path + TMP, { force: true }); };
  try {
    fs.mkdirSync(path.dirname(items[0].path), { recursive: true });
    for (const i of items) {
      const tmp = i.path + TMP;
      staged.push(i); fs.copyFileSync(i.from, tmp);
      if (i.private) fs.chmodSync(tmp, 0o600);
      fsyncFile(tmp);
      if (sha256File(tmp) !== sha256File(i.from)) throw new Error(`the copy of ${path.basename(i.from)} does not match the backup`);
      if (i.db && !integrityOk(tmp)) throw new Error(`the copy of ${path.basename(i.from)} failed its integrity check`);
    }
    r.did.push(`wrote ${items.length} file${items.length > 1 ? "s" : ""} beside the current ones, flushed them to disk and checked them`);
    o.hooks?.afterStage?.();

    // 5. swap them in, all or nothing
    items.forEach((i, n) => {
      o.hooks?.beforeSwap?.(n, i.name);
      const had = fs.existsSync(i.path);
      for (const s of sidecars(i.path)) fs.rmSync(s, { force: true });
      if (had) fs.renameSync(i.path, i.path + OLD);
      swapped.push({ path: i.path, hadOld: had });
      fs.renameSync(i.path + TMP, i.path);
    });
    fsyncDir(path.dirname(items[0].path));
  } catch (e) {
    for (const s of swapped.reverse()) { // put back what was already swapped
      try { fs.rmSync(s.path, { force: true }); if (s.hadOld) fs.renameSync(s.path + OLD, s.path); } catch { /* the safety copy is the way back */ }
    }
    cleanup();
    return refuse(`the restore stopped (${(e as Error).message}) and the files were put back as they were.${r.safetyDir ? ` A copy of the data is also in ${r.safetyDir}.` : ""}`);
  }
  for (const s of swapped) fs.rmSync(s.path + OLD, { force: true });
  r.restored = items.map((i) => i.path);
  r.did.push(`replaced ${items.map((i) => path.basename(i.path)).join(", ")} and removed the old -wal and -shm files`);

  // 6. look at the result (counts only)
  for (const i of items) {
    if (!i.db) continue;
    if (!integrityOk(i.path)) { r.refused.push(`${path.basename(i.path)} failed its integrity check after the swap: restore the safety copy`); return r; }
    const c = i.name === "ringside" ? [countOf(i.path, "boxers", "fighters"), countOf(i.path, "bouts", "fights")] : i.name === "accounts" ? [countOf(i.path, "users", "accounts")] : [];
    r.counts.push(`${path.basename(i.path)}: ${[...c.filter(Boolean), "integrity ok"].join(", ")}`);
  }
  r.ok = true;
  return r;
}
