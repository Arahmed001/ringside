/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright is not a dependency of the site (it is loaded from wherever the machine has it, see scripts/e2e.ts), so its types are not available: everything from it is `any` */
/**
 * What every browser flow gets (docs/e2e.md): a browser context of its own with its own network address (so the per-address limits on sign-ups and posts never
 * meet between flows running side by side), a monitor that turns console errors, page errors, failed requests, error responses and content-security-policy
 * violations into a failure of the flow, accounts made through the real sign-up endpoint, and the waits that make a test deterministic without sleeping:
 * `ready` (the page has handed itself to React: a click before that does nothing) and `until` (poll a condition, never a fixed delay).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getTFor } from "../lib/i18n/dicts";
import type { Locale } from "../lib/i18n/config";
import type { T } from "../lib/i18n/t";

export type Lang = Locale;
export interface Variant { lang: Lang; width: number }
export interface Flow { name: string; variants: Variant[]; run: (h: Harness, v: Variant) => Promise<void> }
export interface Server { base: string; accountsDb: string; mainDb: string; tmp: string }

export const EN1280: Variant = { lang: "en", width: 1280 }, AR375: Variant = { lang: "ar", width: 375 }, EN375: Variant = { lang: "en", width: 375 }, AR1280: Variant = { lang: "ar", width: 1280 };
export const ALL4: Variant[] = [EN1280, AR375, EN375, AR1280];
export const TWO: Variant[] = [EN1280, AR375];

let counter = Math.floor(Math.random() * 60000) + 1000;
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
/** A name no other flow (or earlier run) has used. Letters only: the forum refuses the same words from two accounts, and digits do not count as words. */
export const uniqueName = (prefix = "e2e") => `${prefix}_${letters(10)}`;
export const PASSWORD = "Correct-horse-battery-staple-9";

export interface Account { username: string; password: string }

export class Harness {
  t!: T; // the site's own translator for the flow's language, with the table of proper names (set by `init`)
  readonly problems: string[] = [];
  private allowed: { url: RegExp; status?: number }[] = [];
  private contexts: any[] = [];
  private pages: any[] = [];

  constructor(readonly server: Server, readonly browser: any, readonly variant: Variant, readonly jobName: string) {}
  async init() { this.t = await getTFor(this.variant.lang); return this; }
  /** A fighter's name as the page shows it in the flow's language. */
  name(english: string): string { return this.t.name(english); }

  // ---- addresses ----
  /** The address of a page in the flow's language: `/boxers` is `/ar/boxers` in Arabic. */
  path(p: string, lang: Lang = this.variant.lang): string { return lang === "ar" ? (p === "/" ? "/ar" : `/ar${p}`) : p; }
  url(p: string, lang: Lang = this.variant.lang): string { return this.server.base + this.path(p, lang); }
  /** The words of the flow's language for an English key (the dictionary the site itself uses). */
  tr(key: string, vars?: Record<string, string | number>): string { return this.t(key, vars); }
  /** An exact-match text pattern for a label, in the flow's language. */
  label(key: string): RegExp { return new RegExp(`^\\s*${escapeRe(this.tr(key))}\\s*$`); }

  /** An error response or a console line about it is expected for addresses matching this (a 404 page that a flow asks for on purpose). */
  allow(url: RegExp, status?: number) { this.allowed.push({ url, status }); }
  private isAllowed(url: string, status?: number) { return this.allowed.some((a) => a.url.test(url) && (a.status === undefined || status === undefined || a.status === status)); }

  // ---- contexts and pages ----
  async context(opts: { width?: number; touch?: boolean; lang?: Lang; permissions?: string[] } = {}) {
    const width = opts.width ?? this.variant.width, lang = opts.lang ?? this.variant.lang;
    const n = counter++;
    const ctx = await this.browser.newContext({
      viewport: { width, height: width < 600 ? 800 : 900 },
      locale: lang === "ar" ? "ar" : "en-US",
      extraHTTPHeaders: { "x-forwarded-for": `10.${(n >> 8) & 255}.${n & 255}.7` },
      permissions: opts.permissions ?? ["clipboard-read", "clipboard-write"],
      ...(opts.touch ? { hasTouch: true, isMobile: true } : {}),
      reducedMotion: "reduce", // the page's own animations are off, so nothing is mid-fade when it is read; DESIGN.md: every animation is off under reduced motion
    });
    ctx.setDefaultTimeout(15000); ctx.setDefaultNavigationTimeout(30000);
    this.contexts.push(ctx);
    return ctx;
  }

  /** A page that is watched: anything it logs as an error, throws, fails to load or breaks the content security policy fails the flow when it ends. */
  async page(ctx: any) {
    const page = await ctx.newPage();
    this.pages.push(page);
    const problem = (s: string) => this.problems.push(s);
    await page.exposeFunction("__csp", (s: string) => problem(`content security policy violation: ${s}`));
    await page.addInitScript(() => {
      // the clipboard is one for the whole browser, shared by flows running side by side: what the page copies is recorded here instead (read with `copied`)
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => { (window as any).__copied = t; }, readText: async () => (window as any).__copied ?? "" }, configurable: true });
      document.addEventListener("securitypolicyviolation", (e) => { void (window as any).__csp(`${e.violatedDirective} blocked ${e.blockedURI || "inline"} (${e.sourceFile || ""}:${e.lineNumber})`); });
    });
    page.on("console", (m: any) => {
      if (m.type() !== "error") return;
      const loc = m.location()?.url ?? "";
      if (/Failed to load resource/.test(m.text()) && this.isAllowed(loc)) return; // the browser's line about an expected error response
      problem(`console error: ${m.text().slice(0, 300)} (${loc})`);
    });
    page.on("pageerror", (e: Error) => problem(`page error: ${e.message.slice(0, 300)}`));
    page.on("requestfailed", (r: any) => {
      const err = r.failure()?.errorText ?? "";
      if (/ERR_ABORTED/.test(err)) return; // the browser cancelling a request because the page moved on (an image still loading when a link was followed)
      problem(`request failed: ${r.method()} ${r.url()} ${err}`);
    });
    page.on("response", (r: any) => { if (r.status() >= 400 && !this.isAllowed(r.url(), r.status())) problem(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`); });
    return page;
  }

  /** What the page last copied to the clipboard (null if nothing). */
  async copied(page: any): Promise<string | null> { return page.evaluate(() => (window as any).__copied ?? null); }

  /** Opens a page in the flow's language and waits until it is usable: loaded, and handed to React. */
  async open(page: any, p: string, lang: Lang = this.variant.lang) {
    const res = await page.goto(this.url(p, lang), { waitUntil: "load" });
    await this.ready(page);
    return res;
  }

  /** The page has hydrated: the top bar's buttons carry React's props, and a frame has passed so the effects that attach listeners (the palette's shortcut) have run. */
  async ready(page: any) {
    await page.waitForFunction(() => {
      const b = document.querySelector("header button");
      return !!b && Object.keys(b).some((k) => k.startsWith("__reactProps"));
    });
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  }

  /** The header has asked the server who is signed in (until it has, a click on a pick or a star is saved in the browser as if nobody were). */
  async signedInAs(page: any, username: string) { await page.locator(`header a[aria-label="${this.tr("Your account: {name}", { name: username })}"]`).waitFor(); }
  async signedOut(page: any) { await page.locator(`header a[aria-label="${this.tr("Sign in")}"]`).waitFor(); }

  /** Waits for an element to be on the page and handed to React (a click before that is lost), then clicks it. */
  async click(loc: any) {
    await this.hydrated(loc);
    await loc.click();
  }
  async hydrated(loc: any) {
    const handle = await loc.first().elementHandle();
    await loc.page().waitForFunction((el: Element) => Object.keys(el).some((k) => k.startsWith("__reactProps")), handle);
  }

  /** Polls a condition (a database row, an answer from the API) until it holds. */
  async until<T>(what: string, fn: () => Promise<T | false | null | undefined> | T | false | null | undefined, ms = 15000): Promise<T> {
    const end = Date.now() + ms;
    let last: unknown;
    for (;;) {
      try { const v = await fn(); if (v) return v as T; } catch (e) { last = e; }
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}${last ? ` (${(last as Error).message})` : ""}`);
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  // ---- accounts ----
  /** Makes an account through the real sign-up endpoint; the context is signed in as it afterwards. */
  async signUp(ctx: any, prefix = "e2e"): Promise<Account> {
    const acc = { username: uniqueName(prefix), password: PASSWORD };
    const r = await ctx.request.post(`${this.server.base}/api/account/signup`, { data: acc });
    if (r.status() !== 201) throw new Error(`sign-up failed: ${r.status()} ${await r.text()}`);
    return acc;
  }
  async signIn(ctx: any, acc: Account) {
    const r = await ctx.request.post(`${this.server.base}/api/account/login`, { data: acc });
    if (r.status() !== 200) throw new Error(`sign-in failed: ${r.status()} ${await r.text()}`);
  }
  /** Straight into the accounts file, the way the operator's command and the unit tests do it (there is, deliberately, no route that sets a role). */
  private db<R>(fn: (db: DatabaseSync) => R): R {
    const db = new DatabaseSync(this.server.accountsDb);
    try { db.exec("PRAGMA busy_timeout = 5000"); return fn(db); } finally { db.close(); }
  }
  /** Backdates the account: a new account may not post for five minutes, and only a week-old account's report counts toward an automatic hide. */
  ageAccount(username: string, days: number) {
    this.db((db) => db.prepare("UPDATE users SET created_at = ? WHERE username = ?").run(new Date(Date.now() - days * 86400_000).toISOString(), username));
  }
  setRole(username: string, role: "user" | "editor" | "admin") {
    this.db((db) => { if (!db.prepare("UPDATE users SET role = ? WHERE username = ?").run(role, username).changes) throw new Error(`no account ${username}`); });
  }
  /** Every table of the accounts file, searched for some words: used to prove a deleted account's words are gone, not merely hidden. */
  accountsFileContains(words: string): string[] {
    return this.db((db) => {
      const hits: string[] = [];
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      for (const { name } of tables) {
        const cols = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
        for (const c of cols) { const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE CAST(${c} AS TEXT) LIKE ?`).get(`%${words}%`) as { n: number }).n; if (n) hits.push(`${name}.${c}`); }
      }
      return hits;
    });
  }
  /** A fighter with a profile, in the order of the rankings (0 is the best-rated). */
  fighter(rank = 0): { slug: string; name: string } {
    const db = new DatabaseSync(this.server.mainDb, { readOnly: true });
    try { return db.prepare("SELECT slug, name FROM boxers WHERE (SELECT COUNT(*) FROM bouts b WHERE b.red_id = boxers.id OR b.blue_id = boxers.id) > 3 ORDER BY rating DESC LIMIT 1 OFFSET ?").get(rank) as { slug: string; name: string }; } finally { db.close(); }
  }

  // ---- finishing ----
  /** Called by the runner when the flow returns or throws. Saves a picture of every page on a failure, closes the contexts, and fails if the monitor saw anything. */
  async finish(failed: boolean): Promise<string[]> {
    const shots: string[] = [];
    if (failed) {
      let i = 0;
      for (const p of this.pages) { try { const f = path.join(this.server.tmp, `${this.jobName.replace(/[^a-z0-9]+/gi, "-")}-${i++}.png`); await p.screenshot({ path: f, timeout: 5000 }); shots.push(f); } catch { /* the page is gone */ } }
    }
    for (const c of this.contexts) { try { await c.close(); } catch { /* already closed */ } }
    return shots;
  }
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Assertions that read like the tests of the rest of the repo but fail with the page's own words. */
export function check(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
export function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}
export const exists = (p: string) => fs.existsSync(p);
