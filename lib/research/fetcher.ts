import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { htmlToText, hostOf } from "./text";

/** Sites we never fetch automatically: their terms forbid it. (BoxRec says so in its terms; its data is licensed to partners only.) */
export const NEVER_FETCH = ["boxrec.com"];

export type FetchOutcome =
  | { ok: true; url: string; text: string; fromCache: boolean; status: number }
  | { ok: false; url: string; reason: "blocked-host" | "robots" | "blocked" | "http" | "network" | "unsupported" | "bad-url"; detail: string };

export interface FetcherOptions {
  /** An email address or URL where a site owner can reach whoever runs the bot. Required: it goes in the User-Agent. */
  contact: string;
  /** Minimum gap between two requests to the same host. */
  delayMs?: number;
  cacheDir?: string;
  cacheTtlMs?: number;
  extraBlocked?: string[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxBytes?: number;
  /**
   * For addresses someone else typed in (not a researcher's own list): follow redirects only within the same site, at most 3, each hop checked,
   * and ask `hostCheck` about the host (and every hop) before touching it. Returns a reason to refuse, or null.
   */
  strictRedirects?: boolean;
  hostCheck?: (host: string) => Promise<string | null>;
}

interface Robots { allow: string[]; disallow: string[]; crawlDelay?: number }

/** The rules for our bot in a robots.txt: its own group if present, else `*`. Longest matching rule wins; Allow beats Disallow on a tie. */
export function parseRobots(txt: string, agent = "ringsideresearch"): Robots {
  const groups: { agents: string[]; allow: string[]; disallow: string[]; delay?: number }[] = [];
  let cur: (typeof groups)[number] | null = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!cur || !lastWasAgent) { cur = { agents: [], allow: [], disallow: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === "allow" && v) cur.allow.push(v); else if (k === "disallow" && v) cur.disallow.push(v); else if (k === "crawl-delay") cur.delay = Number(v) || undefined;
  }
  const g = groups.find((x) => x.agents.some((a) => agent.includes(a) && a !== "*")) ?? groups.find((x) => x.agents.includes("*"));
  return { allow: g?.allow ?? [], disallow: g?.disallow ?? [], crawlDelay: g?.delay };
}

export function robotsAllows(r: Robots, pathAndQuery: string): boolean {
  const rule = (p: string) => { const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")); return re.test(pathAndQuery) ? p.length : -1; };
  const a = Math.max(-1, ...r.allow.map(rule)), d = Math.max(-1, ...r.disallow.map(rule));
  return d < 0 || a >= d;
}

const privateHost = (h: string) => /^(localhost|.*\.local|.*\.internal)$/.test(h) || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/.test(h);

/**
 * A polite fetcher: identifies itself, obeys robots.txt and Crawl-delay, waits between requests to a host, caches what it reads,
 * never touches the never-fetch list, never follows a block (a 403, 429 or a challenge page is the end: no retry, no workaround).
 * It reads HTML and plain text only, and returns text for the checker; page text is cached locally and never republished.
 */
export class PoliteFetcher {
  private robots = new Map<string, Robots>();
  private last = new Map<string, number>();
  private o: Required<Omit<FetcherOptions, "cacheDir" | "fetchImpl" | "hostCheck">> & Pick<FetcherOptions, "cacheDir" | "fetchImpl" | "hostCheck">;
  constructor(opts: FetcherOptions) {
    if (!opts.contact || !/@|^https?:\/\//.test(opts.contact)) throw new Error("PoliteFetcher needs a contact (an email address or URL) for its User-Agent; set RESEARCH_CONTACT.");
    this.o = { delayMs: 3000, cacheTtlMs: 14 * 86400_000, extraBlocked: [], sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(), maxBytes: 2_000_000, strictRedirects: false, ...opts };
  }
  get userAgent() { return `RingsideResearch/0.1 (+${this.o.contact})`; }

  private cachePath(url: string) { return this.o.cacheDir ? path.join(this.o.cacheDir, crypto.createHash("sha1").update(url).digest("hex") + ".json") : null; }

  private async wait(host: string, extra = 0) {
    const gap = Math.max(this.o.delayMs, extra);
    const since = this.o.now() - (this.last.get(host) ?? 0);
    if (since < gap) await this.o.sleep(gap - since);
    this.last.set(host, this.o.now());
  }

  async get(rawUrl: string): Promise<FetchOutcome> {
    let u: URL;
    try { u = new URL(rawUrl); } catch { return { ok: false, url: rawUrl, reason: "bad-url", detail: "not a URL" }; }
    if (!/^https?:$/.test(u.protocol) || privateHost(u.hostname)) return { ok: false, url: rawUrl, reason: "bad-url", detail: "only public http(s) pages" };
    const host = hostOf(rawUrl);
    if ([...NEVER_FETCH, ...this.o.extraBlocked].some((b) => host === b || host.endsWith("." + b))) return { ok: false, url: rawUrl, reason: "blocked-host", detail: `${host} is on the never-fetch list (its terms forbid automated access)` };

    const cp = this.cachePath(rawUrl);
    if (cp && fs.existsSync(cp)) {
      const c = JSON.parse(fs.readFileSync(cp, "utf8")) as { at: number; status: number; text: string };
      if (this.o.now() - c.at < this.o.cacheTtlMs) return { ok: true, url: rawUrl, text: c.text, fromCache: true, status: c.status };
    }
    if (this.o.hostCheck) { const why = await this.o.hostCheck(u.hostname); if (why) return { ok: false, url: rawUrl, reason: "bad-url", detail: why }; }
    const f = this.o.fetchImpl ?? fetch;
    const headers = { "user-agent": this.userAgent, accept: "text/html,text/plain;q=0.9" };

    let rules = this.robots.get(u.origin);
    if (!rules) {
      await this.wait(host);
      try {
        const r = await f(`${u.origin}/robots.txt`, { headers, signal: AbortSignal.timeout(15000) });
        rules = r.ok ? parseRobots(await r.text()) : { allow: [], disallow: [] }; // no robots.txt (404) means no restrictions; 401/403 means stay away
        if (r.status === 401 || r.status === 403) rules = { allow: [], disallow: ["/"] };
      } catch { rules = { allow: [], disallow: [] }; }
      this.robots.set(u.origin, rules);
    }
    if (!robotsAllows(rules, u.pathname + u.search)) return { ok: false, url: rawUrl, reason: "robots", detail: `robots.txt on ${u.host} disallows this path` };

    await this.wait(host, (rules.crawlDelay ?? 0) * 1000);
    let res: Response;
    try {
      if (!this.o.strictRedirects) res = await f(rawUrl, { headers, redirect: "follow", signal: AbortSignal.timeout(20000) });
      else {
        let at = rawUrl;
        for (let hop = 0; ; hop++) {
          res = await f(at, { headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
          const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
          if (!loc) break;
          let next: URL;
          try { next = new URL(loc, at); } catch { return { ok: false, url: rawUrl, reason: "bad-url", detail: "a redirect to something that is not a URL" }; }
          if (hop >= 3 || !/^https?:$/.test(next.protocol) || hostOf(next.href) !== host || privateHost(next.hostname)) return { ok: false, url: rawUrl, reason: "blocked", detail: "the page redirects somewhere other than the same site (not followed)" };
          if (this.o.hostCheck) { const why = await this.o.hostCheck(next.hostname); if (why) return { ok: false, url: rawUrl, reason: "bad-url", detail: why }; }
          at = next.href;
        }
      }
    } catch (e) { return { ok: false, url: rawUrl, reason: "network", detail: (e as Error).message }; }
    if ([401, 403, 429, 451].includes(res.status)) return { ok: false, url: rawUrl, reason: "blocked", detail: `HTTP ${res.status}: the site refused automated access (not retried, not worked around)` };
    if (!res.ok) return { ok: false, url: rawUrl, reason: "http", detail: `HTTP ${res.status}` };
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)|application\/xhtml/.test(type)) return { ok: false, url: rawUrl, reason: "unsupported", detail: `content type ${type || "unknown"} (HTML and text only; download PDFs by hand)` };
    const raw = (await res.text()).slice(0, this.o.maxBytes);
    if (/captcha|cf-chl|attention required|access denied|are you a robot/i.test(raw.slice(0, 4000)) && raw.length < 20000) return { ok: false, url: rawUrl, reason: "blocked", detail: "the page is a bot challenge (not retried, not worked around)" };
    const text = /html/.test(type) ? htmlToText(raw) : raw;
    if (cp) { fs.mkdirSync(path.dirname(cp), { recursive: true }); fs.writeFileSync(cp, JSON.stringify({ url: rawUrl, at: this.o.now(), status: res.status, text })); }
    return { ok: true, url: rawUrl, text, fromCache: false, status: res.status };
  }
}
