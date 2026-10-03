import type { DataProvider } from "./index";
import { boxingDataApiProvider } from "./boxing-data-api";

/**
 * BOXING_PROVIDER=licensed: the Boxing Data API adapter (lib/providers/boxing-data-api.ts).
 *   BOXING_API_KEY                  the RapidAPI key
 *   BOXING_API_URL                  optional; defaults to https://boxing-data-api.p.rapidapi.com
 *   BOXING_API_MAX_REQUESTS         optional request cap per load (default 90, under the free tier's 100 a month)
 *   BOXING_API_SINCE                optional yyyy-mm-dd; only fights from this date
 *   BOXING_API_STORAGE_CONFIRMED=1  required to fill the database: set it only once the operator has confirmed in writing that stored data may be kept
 * Another vendor means another adapter behind the same DataProvider contract. Nothing here scrapes any site.
 */
export function licensedProvider(): DataProvider {
  const key = process.env.BOXING_API_KEY;
  if (!key) throw new Error("Set BOXING_API_KEY (and optionally BOXING_API_URL) to use the licensed provider.");
  return boxingDataApiProvider({
    key, baseUrl: process.env.BOXING_API_URL || undefined, purpose: "ingest", gapMs: 250, log: console.log,
    maxRequests: process.env.BOXING_API_MAX_REQUESTS ? Number(process.env.BOXING_API_MAX_REQUESTS) : undefined,
    since: process.env.BOXING_API_SINCE || undefined,
  });
}
