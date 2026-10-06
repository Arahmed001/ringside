import { getWorld } from "./world";
import { getTFor } from "./i18n/dicts";
import { isLocale, localePath, type Locale } from "./i18n/config";
import { abs } from "./seo";
import { makeLimiter } from "./rate-limit";
import { apiMeta, publicApiGate, type Ctx, type Result } from "./public-api";

/**
 * The HTTP side of the public API: the switch, the per-address limit, CORS for GET, the cache headers, and the one shape every answer has ({ data, meta } or
 * { error: { status, message } }). A route gives `respond` a builder from `lib/public-api.ts` and gets all of it. An error never carries the text of an exception.
 */
export const API_LIMIT = 60, API_WINDOW_MS = 60_000;
/**
 * A request with no X-Forwarded-For or X-Real-IP (a deployment with no proxy in front) has no address to tell it from another, so everyone shares one bucket. At 60 a minute
 * a handful of people would shut the whole API for everybody; that bucket stands for all of them, so its ceiling is ten times higher. Put the site behind a proxy that sets
 * X-Forwarded-For (the docs say so) and each address gets its own 60.
 */
export const API_SHARED_LIMIT = API_LIMIT * 10, SHARED_KEY = "unknown";
const limiter = makeLimiter({ limit: API_LIMIT, windowMs: API_WINDOW_MS });
const sharedLimiter = makeLimiter({ limit: API_SHARED_LIMIT, windowMs: API_WINDOW_MS, maxKeys: 1 });

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-expose-headers": "retry-after, x-ratelimit-limit, x-ratelimit-remaining" };
const json = (body: unknown, status: number, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extra } });
const fail = (status: number, message: string, extra: Record<string, string> = {}) => json({ error: { status, message } }, status, { "cache-control": "no-store", ...extra });

export const preflight = (): Response => new Response(null, { status: 204, headers: { ...CORS, "access-control-max-age": "86400" } });

/** Who is asking, for the limit: the first address in X-Forwarded-For (set by the proxy in front), then X-Real-IP, else one shared bucket. */
export const clientKey = (req: Request): string => (req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || SHARED_KEY).slice(0, 64);

export async function respond(req: Request, build: (c: Ctx, q: URLSearchParams) => Result | Promise<Result>, env?: Record<string, string | undefined>, lim = limiter, shared = sharedLimiter): Promise<Response> {
  const gate = publicApiGate(env);
  if (!gate.open) return fail(404, gate.why);
  const key = clientKey(req), cap = key === SHARED_KEY ? API_SHARED_LIMIT : API_LIMIT;
  const rate = (key === SHARED_KEY ? shared : lim).hit(key);
  if (!rate.ok) return fail(429, key === SHARED_KEY ? `The API is busy: try again in ${rate.retryAfterSec} seconds.` : `Too many requests: ${API_LIMIT} a minute per address. Try again in ${rate.retryAfterSec} seconds.`, { "retry-after": String(rate.retryAfterSec), "x-ratelimit-limit": String(cap), "x-ratelimit-remaining": "0" });
  try {
    const q = new URL(req.url).searchParams, lang = q.get("lang");
    const locale: Locale = lang && isLocale(lang) ? lang : "en";
    const w = await getWorld();
    const result = await build({ w, t: await getTFor(locale), url: (p) => abs(localePath(locale, p)) }, q);
    if ("error" in result) return fail(result.error, result.message);
    if ("raw" in result) return json(result.raw, 200, { "cache-control": "public, max-age=300, s-maxage=300" });
    return json({ data: result.data, meta: { ...apiMeta(w, env), lang: locale, ...result.meta } }, 200, { "cache-control": "public, max-age=300, s-maxage=300", "x-ratelimit-limit": String(cap), "x-ratelimit-remaining": String(rate.remaining) });
  } catch (e) {
    console.error("[ringside] public API error:", e instanceof Error ? e.message : e);
    return fail(500, "Something went wrong on our side.");
  }
}
