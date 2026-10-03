/**
 * Wikidata → Wikimedia Commons headshot lookup.
 *
 * Deliberately conservative: a wrong face on a real person's profile is worse than no
 * photo. A candidate is accepted only if Wikidata says it is a boxer, its birth year matches
 * ours, and its Commons image is under a free licence. Nothing here guesses with an LLM or
 * scrapes search results; every accepted image carries its licence and author for attribution.
 *
 * Wikimedia asks API clients to send a descriptive User-Agent with contact details, so set
 * WIKIMEDIA_CONTACT (email or URL) before running.
 */

const WIKIDATA = "https://www.wikidata.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const Q_BOXER = "Q11338576";
const GAP_MS = Number(process.env.WIKIMEDIA_GAP_MS ?? 250); // tests set this to 0

let lastCall = 0;

export function userAgent(): string {
  const contact = process.env.WIKIMEDIA_CONTACT;
  if (!contact) throw new Error("Set WIKIMEDIA_CONTACT (an email or URL) so Wikimedia can reach you if the bot misbehaves.");
  return `RingsideBot/0.1 (${contact})`;
}

async function api<T>(base: string, params: Record<string, string>): Promise<T> {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const url = `${base}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    lastCall = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": userAgent(), "Accept-Encoding": "gzip" }, signal: AbortSignal.timeout(15000) });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`Wikimedia ${res.status} for ${base}`);
    return (await res.json()) as T;
  }
  throw new Error("Wikimedia unavailable after retries");
}

export interface Subject { name: string; birthYear: number }

export interface MediaMatch {
  wikidataId: string;
  fileTitle: string;
  thumbUrl: string;
  pageUrl: string; // Commons file description page
  license: string;
  licenseUrl: string | null;
  credit: string; // plain-text attribution, e.g. "Jane Doe, CC BY-SA 4.0"
  confidence: "high";
}

export type Outcome =
  | { status: "matched"; match: MediaMatch }
  | { status: "no_match"; reason: string };

interface Claim { mainsnak?: { datavalue?: { value?: unknown } }; rank?: string }
interface Entity { id: string; claims?: Record<string, Claim[]>; descriptions?: Record<string, { value: string }> }

const claimValues = (e: Entity, prop: string): unknown[] =>
  (e.claims?.[prop] ?? []).filter((c) => c.rank !== "deprecated").map((c) => c.mainsnak?.datavalue?.value).filter((v) => v !== undefined);

const isBoxer = (e: Entity) => claimValues(e, "P106").some((v) => (v as { id?: string })?.id === Q_BOXER);
const birthYears = (e: Entity) =>
  claimValues(e, "P569").map((v) => Number(String((v as { time?: string }).time ?? "").match(/[+-]?(\d{4})/)?.[1])).filter((y) => y > 0);

/**
 * Licences we are willing to display commercially. Two gates, both must pass:
 *  1. NON_FREE denylist: anything non-commercial, no-derivatives or fair-use is rejected outright.
 *  2. FREE_LICENCE allowlist, anchored at both ends, so unknown strings are rejected by default.
 * (An optional trailing 2-3 letter token allows jurisdiction ports such as "CC BY 3.0 DE".)
 */
const NON_FREE = /\b(nc|nd)\b|non-?commercial|no[- ]derivs?|no derivatives|fair use/i;
const FREE_LICENCE = /^(cc0(?:[- ]1\.0)?|cc[- ]by(?:[- ]sa)?(?:[- ]\d(?:\.\d)?)?(?:[- ][a-z]{2,3})?|public domain|pd[- ][\w-]+|no restrictions)$/i;

/** True only for licences we can display commercially with attribution. Exported so the rule can be tested directly. */
export const licenceAccepted = (license: string): boolean => !NON_FREE.test(license) && FREE_LICENCE.test(license);

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

async function imageFor(fileName: string): Promise<Omit<MediaMatch, "wikidataId" | "confidence"> | { reject: string }> {
  const r = await api<{ query?: { pages?: { missing?: boolean; imageinfo?: { thumburl?: string; url: string; width: number; mime: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }[] } }>(COMMONS, {
    action: "query", titles: `File:${fileName}`, prop: "imageinfo", iiprop: "url|extmetadata|mime|size", iiurlwidth: "480",
  });
  const info = r.query?.pages?.[0]?.imageinfo?.[0];
  if (!info) return { reject: "image not on Commons" };
  if (!/^image\/(jpeg|png|webp)$/.test(info.mime)) return { reject: `unsupported type ${info.mime}` };
  if (info.width < 250) return { reject: "image too small" };
  const m = info.extmetadata ?? {};
  if (m.NonFree?.value === "true") return { reject: "non-free image" };
  const license = stripHtml(m.LicenseShortName?.value ?? "");
  if (!licenceAccepted(license)) return { reject: `licence not accepted: ${license || "unknown"}` };
  const artist = stripHtml(m.Artist?.value ?? "") || stripHtml(m.Credit?.value ?? "") || "Unknown author";
  return {
    fileTitle: fileName, thumbUrl: info.thumburl ?? info.url, pageUrl: info.descriptionurl,
    license, licenseUrl: m.LicenseUrl?.value ?? null, credit: `${artist.slice(0, 120)}, ${license}`,
  };
}

export async function findHeadshot(s: Subject): Promise<Outcome> {
  const found = await api<{ search?: { id: string }[] }>(WIKIDATA, {
    action: "wbsearchentities", search: s.name, language: "en", type: "item", limit: "8",
  });
  const ids = (found.search ?? []).map((x) => x.id);
  if (!ids.length) return { status: "no_match", reason: "no Wikidata entity with that name" };

  const ents = await api<{ entities?: Record<string, Entity> }>(WIKIDATA, {
    action: "wbgetentities", ids: ids.join("|"), props: "claims|descriptions", languages: "en",
  });
  const boxers = ids.map((id) => ents.entities?.[id]).filter((e): e is Entity => !!e && isBoxer(e));
  if (!boxers.length) return { status: "no_match", reason: "no boxer with that name" };

  const matching = boxers.filter((e) => birthYears(e).includes(s.birthYear));
  if (matching.length !== 1) {
    return { status: "no_match", reason: matching.length ? "ambiguous: several boxers share name and birth year" : "no boxer with matching birth year" };
  }
  const e = matching[0];
  const files = claimValues(e, "P18").filter((v): v is string => typeof v === "string");
  if (!files.length) return { status: "no_match", reason: "boxer has no image on Wikidata" };

  let lastReject = "no usable image";
  for (const f of files) {
    const img = await imageFor(f);
    if ("reject" in img) { lastReject = img.reject; continue; }
    return { status: "matched", match: { wikidataId: e.id, confidence: "high", ...img } };
  }
  return { status: "no_match", reason: lastReject };
}

/** Headshot for a Wikidata entity we are ALREADY linked to (by BoxRec ID or name + birth year), so no name search or birth-year check is needed. */
export async function headshotByEntity(qid: string): Promise<Outcome> {
  const ents = await api<{ entities?: Record<string, Entity> }>(WIKIDATA, { action: "wbgetentities", ids: qid, props: "claims", languages: "en" });
  const e = ents.entities?.[qid];
  if (!e) return { status: "no_match", reason: "entity not found" };
  const files = claimValues(e, "P18").filter((v): v is string => typeof v === "string");
  if (!files.length) return { status: "no_match", reason: "boxer has no image on Wikidata" };
  let lastReject = "no usable image";
  for (const f of files) {
    const img = await imageFor(f);
    if ("reject" in img) { lastReject = img.reject; continue; }
    return { status: "matched", match: { wikidataId: qid, confidence: "high", ...img } };
  }
  return { status: "no_match", reason: lastReject };
}
