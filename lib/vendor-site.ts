import net from "node:net";
import path from "node:path";
import { DEFAULT_DATABASE } from "./vendor-load";

/**
 * `npm run vendor:site` (round 103): the site on the real database, started the same way every time. Starting it by hand went wrong in a different way each time: a tab in
 * the wrong folder ("Missing script"), a port still held by the previous server, a server that ended with its terminal tab, a build run over the folder a running server was using.
 * This starts it detached (its own process group, no terminal), on a port that is checked first, with the log and the process id in files beside the database.
 * It never sets the vendor key or the storage statement: serving a database needs neither.
 */
export const DEFAULT_PORT = 3480;

export interface SitePlan { port: number; database: string; log: string; pid: string; env: Record<string, string> }

/** Where the site runs: DATABASE_PATH (default ~/ringside-real/real.db), `--port` (default 3480), the log and process-id files beside the database (`site.log`/`site.pid` on the default port, `site-PORT.log`/`site-PORT.pid` on another, so a second site on the same folder, a preview, does not take over the first one's files). */
export function sitePlan(opts: { port?: string; database?: string }, env: Record<string, string | undefined> = process.env): SitePlan {
  const port = Number(opts.port ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`--port ${opts.port} is not a port number between 1024 and 65535.`);
  const database = path.resolve(opts.database ?? env.DATABASE_PATH ?? DEFAULT_DATABASE);
  const dir = path.dirname(database), tag = port === DEFAULT_PORT ? "site" : `site-${port}`;
  return { port, database, log: path.join(dir, `${tag}.log`), pid: path.join(dir, `${tag}.pid`), env: { DATABASE_PATH: database, BOXING_PROVIDER: "licensed", PORT: String(port), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" } };
}

/** Whether something already accepts connections on the port. */
export const portInUse = (port: number): Promise<boolean> => new Promise((resolve) => {
  const s = net.createConnection({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
  s.setTimeout(1500, () => { s.destroy(); resolve(false); });
});

/** What `/api/health` says, or null when nothing answers. */
export async function siteHealth(port: number): Promise<{ fighters: number; bouts: number; updatedAt: string | null } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { fighters: number; bouts: number; data?: { updatedAt?: string | null } };
    return { fighters: j.fighters, bouts: j.bouts, updatedAt: j.data?.updatedAt ?? null };
  } catch { return null; }
}

