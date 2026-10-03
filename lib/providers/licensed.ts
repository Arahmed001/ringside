import type { DataProvider } from "./index";

/**
 * Placeholder for the licensed API adapter. Fill in once a provider is chosen:
 * map the vendor's payloads to ProviderBoxer/Event/Bout and respect the
 * licence's rate limits and caching terms. Nothing here scrapes any site.
 */
export function licensedProvider(): DataProvider {
  const baseUrl = process.env.BOXING_API_URL;
  const key = process.env.BOXING_API_KEY;
  if (!baseUrl || !key) {
    throw new Error("Set BOXING_API_URL and BOXING_API_KEY to use the licensed provider.");
  }
  const notImplemented = async () => {
    throw new Error("Licensed provider mapping not implemented yet (see lib/providers/licensed.ts).");
  };
  return {
    name: "licensed",
    fetchBoxers: notImplemented,
    fetchEvents: notImplemented,
    fetchBouts: notImplemented,
  };
}
