import { todayIso } from "./clock";
import { clientAddress } from "./client-ip";

/**
 * Protects the Anthropic bill. Three things reach the model from anonymous traffic: the plain-English fighter search,
 * scouting reports and fight-preview articles. Each is cached, but a visitor can still ask for as many different
 * searches as they like, so every call that would reach the model first has to get past two limits:
 *  - a per-client limit (default 20 calls per 10 minutes, AI_CLIENT_LIMIT / AI_CLIENT_WINDOW_MS), and
 *  - a daily budget for the whole site (default 1,000 calls per UTC day, AI_DAILY_BUDGET), which is the hard stop.
 * A refused call is not an error for the visitor: every caller falls back to the rule-based answer, which is always complete.
 * The client id comes from X-Forwarded-For when a proxy sets it, so it can be spoofed by someone who can reach the server
 * directly; the daily budget does not depend on it. State lives in memory (one process); behind several instances each has its own budget.
 */
export type Verdict = "ok" | "client" | "budget";
export class AiLimited extends Error {
  constructor(public reason: "client" | "budget") { super(`AI call refused: ${reason} limit`); }
}

/**
 * The model could not be reached or answered with an error (a wrong key, no network, an outage, an overload). Callers fall back to the rules,
 * as for a limit, but the fallback must not be remembered for the day: the next visitor, after the pause below, gets another try.
 */
export class AiFailed extends Error {
  constructor(message: string) { super(message); }
}
/** True when a model call was refused or failed, so the plain answer it fell back to must not be cached. */
export const notRemembered = (e: unknown) => e instanceof AiLimited || e instanceof AiFailed;

const PAUSE_MS = 60_000;
const gf = globalThis as unknown as { __aiPause?: { until: number; lastLog: string } };
/** After a failure no call is made for a minute, so a broken key or an outage costs no waiting and no hammering. */
export const aiPaused = (at = Date.now()) => (gf.__aiPause?.until ?? 0) > at;
/** Records a failure: pauses the model for a minute and says why on the server log (never on a page), once per distinct reason. */
export function noteAiFailure(reason: string, at = Date.now()) {
  const prev = gf.__aiPause;
  gf.__aiPause = { until: at + PAUSE_MS, lastLog: reason };
  if (prev?.lastLog !== reason) console.warn(`[ai] model call failed, using the built-in answers for a minute: ${reason}`);
}
export const resetAiPause = () => { gf.__aiPause = undefined; };

interface State { day: string; used: number; clients: Map<string, number[]> }
const g = globalThis as unknown as { __aiGuard?: State };
const MAX_CLIENTS = 5000;

const envNum = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n >= 0 ? n : d; };
export const aiLimits = () => ({ daily: envNum("AI_DAILY_BUDGET", 1000), perClient: envNum("AI_CLIENT_LIMIT", 20), windowMs: envNum("AI_CLIENT_WINDOW_MS", 600_000) });

function state(): State {
  const day = todayIso();
  if (!g.__aiGuard) g.__aiGuard = { day, used: 0, clients: new Map() };
  if (g.__aiGuard.day !== day) g.__aiGuard = { day, used: 0, clients: g.__aiGuard.clients }; // a new day, a new budget
  return g.__aiGuard;
}

/** Asks to make one model call. Counts it only when allowed. */
export function reserveAiCall(client = "anon", at = Date.now()): Verdict {
  const s = state();
  const { daily, perClient, windowMs } = aiLimits();
  if (s.used >= daily) return "budget";
  const recent = (s.clients.get(client) ?? []).filter((t) => at - t < windowMs);
  if (recent.length >= perClient) { s.clients.delete(client); s.clients.set(client, recent); return "client"; }
  recent.push(at);
  s.clients.delete(client); s.clients.set(client, recent); // most recent last, so eviction drops the stalest
  while (s.clients.size > MAX_CLIENTS) s.clients.delete(s.clients.keys().next().value as string);
  s.used++;
  return "ok";
}

export const aiUsage = () => ({ day: state().day, used: state().used, daily: aiLimits().daily, clients: state().clients.size });
export const resetAiGuard = () => { g.__aiGuard = undefined; resetAiPause(); };

/** Who is asking, for the per-client limit. Never trusted for the daily budget. */
export function clientId(headers: Pick<Headers, "get">): string {
  return clientAddress(headers) ?? "anon";
}
