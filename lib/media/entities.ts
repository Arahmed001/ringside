import type { DatabaseSync } from "node:sqlite";
import { api, mediaByEntity, type Outcome } from "./wikimedia";

/**
 * Pictures of things that are not fighters, from Wikidata and Wikimedia Commons, under the same rules as the headshots: the thing is identified before a
 * picture is taken, the file must be under a free licence, and the credit travels with it. Nothing is guessed and nothing is copied: the database keeps the
 * address of Commons' own thumbnail, the licence and the author.
 *
 *   belt       a sanctioning body's championship belt: Wikidata's image (P18) of WBA, WBC, IBF or WBO, whose items were checked by hand
 *   org_logo   an organisation's logo (P154), for any promotion, sanctioning body or broadcaster in the organisations table
 *   venue      a venue already matched to Wikidata (lib/importers/venues.ts): its image (P18)
 *
 * What the first live look found (2026-10-03): the four sanctioning bodies each have a free-licensed belt photo (CC BY-SA), and none of the promotions
 * (Top Rank, Matchroom, Golden Boy, Queensberry, MVP, Zuffa) has a logo on Wikidata at all: a promotion's logo is a trademark and not free, so Commons does
 * not hold it. Those get no logo here, and that is the right answer, not a gap to fill by copying.
 */
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const Q_BOXING = "Q32112"; // the sport
const RECHECK_DAYS = 45;

/** The four sanctioning bodies, with the Wikidata item and the English label that item must still carry (a merged or vandalised item is refused). */
export const BODIES: Record<string, { qid: string; label: string }> = {
  WBA: { qid: "Q725676", label: "World Boxing Association" },
  WBC: { qid: "Q724450", label: "World Boxing Council" },
  IBF: { qid: "Q742944", label: "International Boxing Federation" },
  WBO: { qid: "Q830940", label: "World Boxing Organization" },
};

interface Claim { mainsnak?: { datavalue?: { value?: unknown } }; rank?: string }
interface Ent { id: string; labels?: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]>; descriptions?: Record<string, { value: string }>; claims?: Record<string, Claim[]> }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
const ids = (e: Ent, prop: string) => (e.claims?.[prop] ?? []).filter((c) => c.rank !== "deprecated").map((c) => (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id).filter((x): x is string => !!x);

async function entities(qids: string[]): Promise<Record<string, Ent>> {
  const r = await api<{ entities?: Record<string, Ent> }>(WIKIDATA, { action: "wbgetentities", ids: qids.join("|"), props: "labels|aliases|descriptions|claims", languages: "en" });
  return r.entities ?? {};
}

export type Linked = { status: "linked"; qid: string } | { status: "no_match"; reason: string };

/**
 * Which Wikidata item is this organisation? Accepted only when its English label or an alias is our name (ignoring case, accents and punctuation), it is
 * about boxing (its sport is boxing, or its description says boxing), and exactly one candidate qualifies. A name shared with a record label or a band
 * is not enough, and neither is a near miss.
 */
export async function findOrgQid(name: string): Promise<Linked> {
  const found = await api<{ search?: { id: string }[] }>(WIKIDATA, { action: "wbsearchentities", search: name, language: "en", type: "item", limit: "8" });
  const cand = (found.search ?? []).map((x) => x.id);
  if (!cand.length) return { status: "no_match", reason: "no Wikidata item with that name" };
  const ents = await entities(cand);
  const want = norm(name);
  const named = cand.map((id) => ents[id]).filter((e): e is Ent => !!e && [e.labels?.en?.value, ...(e.aliases?.en ?? []).map((a) => a.value)].some((n) => n && norm(n) === want));
  if (!named.length) return { status: "no_match", reason: "no item whose name is exactly this" };
  const boxing = named.filter((e) => ids(e, "P641").includes(Q_BOXING) || /\bboxing\b/i.test(e.descriptions?.en?.value ?? ""));
  if (!boxing.length) return { status: "no_match", reason: "the items with this name are not about boxing" };
  if (boxing.length > 1) return { status: "no_match", reason: "ambiguous: several boxing items share this name" };
  return { status: "linked", qid: boxing[0].id };
}

/** The logo of a Wikidata item (P154). SVG is welcome here: that is what logos are. */
export const logoByEntity = (qid: string): Promise<Outcome> => mediaByEntity(qid, "P154", "no logo on Wikidata", { allowSvg: true, minWidth: 100 });

/** The belt photo of one sanctioning body: only after the item still carries the label we recorded for it. */
export async function beltByBody(code: string): Promise<Outcome> {
  const body = BODIES[code];
  if (!body) return { status: "no_match", reason: "not one of the four bodies" };
  const e = (await entities([body.qid]))[body.qid];
  if (!e || norm(e.labels?.en?.value ?? "") !== norm(body.label)) return { status: "no_match", reason: "the Wikidata item is no longer labelled as this body" };
  return mediaByEntity(body.qid, "P18", "no image on Wikidata");
}

/** A venue's own image, for a venue already matched to Wikidata (the match was verified when it was made). */
export const venuePhoto = (qid: string): Promise<Outcome> => mediaByEntity(qid, "P18", "no image on Wikidata");

export interface EntityMediaSummary { checked: number; matched: number; noMatch: number; errors: number }
export type EntityKind = "belt" | "org_logo" | "venue";

/**
 * Worker: for each kind, the things that have no answer yet, or whose "no match" is older than RECHECK_DAYS (Wikidata may have been updated since).
 * `limit` caps each kind, so a small request budget covers every kind a little.
 */
export async function resolveEntityMedia(db: DatabaseSync, opts: { limit?: number; kinds?: EntityKind[]; log?: (m: string) => void } = {}): Promise<EntityMediaSummary> {
  const { limit = 50, log = () => {}, kinds = ["belt", "org_logo", "venue"] } = opts;
  const cutoff = new Date(Date.now() - RECHECK_DAYS * 86400000).toISOString();
  const s: EntityMediaSummary = { checked: 0, matched: 0, noMatch: 0, errors: 0 };
  const save = db.prepare(`INSERT INTO entity_media (kind, ref, status, reason, wikidata_id, file_title, thumb_url, page_url, license, license_url, credit, checked_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(kind, ref) DO UPDATE SET status=excluded.status, reason=excluded.reason, wikidata_id=excluded.wikidata_id, file_title=excluded.file_title,
    thumb_url=excluded.thumb_url, page_url=excluded.page_url, license=excluded.license, license_url=excluded.license_url, credit=excluded.credit, checked_at=excluded.checked_at`);
  const due = (kind: EntityKind, ref: string) => {
    const r = db.prepare("SELECT status, checked_at FROM entity_media WHERE kind = ? AND ref = ?").get(kind, ref) as { status: string; checked_at: string } | undefined;
    return !r || (r.status === "no_match" && r.checked_at < cutoff);
  };
  const record = (kind: EntityKind, ref: string, label: string, qid: string | null, out: Outcome | { status: "no_match"; reason: string }) => {
    const now = new Date().toISOString();
    s.checked++;
    if (out.status === "matched") {
      const m = out.match;
      save.run(kind, ref, "matched", null, m.wikidataId, m.fileTitle, m.thumbUrl, m.pageUrl, m.license, m.licenseUrl, m.credit, now);
      s.matched++; log(`✓ ${label} → ${m.fileTitle} (${m.license})`);
    } else {
      save.run(kind, ref, "no_match", out.reason, qid, null, null, null, null, null, null, now);
      s.noMatch++; log(`– ${label}: ${out.reason}`);
    }
  };
  const guarded = async (label: string, work: () => Promise<void>) => {
    try { await work(); } catch (e) {
      s.errors++; log(`! ${label}: ${(e as Error).message}`);
      if (/WIKIMEDIA_CONTACT/.test((e as Error).message)) throw e; // misconfiguration: stop, don't burn the list
    }
  };

  if (kinds.includes("belt")) {
    for (const code of Object.keys(BODIES).filter((c) => due("belt", c)).slice(0, limit)) await guarded(`${code} belt`, async () => record("belt", code, `${code} belt`, BODIES[code].qid, await beltByBody(code)));
  }
  if (kinds.includes("org_logo")) {
    const orgs = db.prepare("SELECT id, name, wikidata_id AS qid FROM orgs WHERE kind IN ('promotion', 'sanctioning_body', 'magazine', 'broadcaster') ORDER BY id").all() as { id: number; name: string; qid: string | null }[];
    for (const o of orgs.filter((x) => due("org_logo", String(x.id))).slice(0, limit)) {
      await guarded(o.name, async () => {
        let qid = o.qid;
        if (!qid) {
          const l = await findOrgQid(o.name);
          if (l.status === "no_match") return record("org_logo", String(o.id), o.name, null, l);
          qid = l.qid;
          db.prepare("UPDATE orgs SET wikidata_id = ? WHERE id = ?").run(qid, o.id);
        }
        record("org_logo", String(o.id), o.name, qid, await logoByEntity(qid));
      });
    }
  }
  if (kinds.includes("venue")) {
    const venues = db.prepare("SELECT name, city, wikidata_id AS qid FROM venues WHERE status = 'matched' AND wikidata_id IS NOT NULL ORDER BY name, city").all() as { name: string; city: string; qid: string }[];
    for (const v of venues.filter((x) => due("venue", `${x.name}|${x.city}`)).slice(0, limit)) await guarded(v.name, async () => record("venue", `${v.name}|${v.city}`, v.name, v.qid, await venuePhoto(v.qid)));
  }
  return s;
}
