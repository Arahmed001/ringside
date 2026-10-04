import { RANKING_BODIES, type RankingBody } from "./providers";

/**
 * The sanctioning bodies' official lists, as stored (table `official_rankings`) and as the pages use them: by division and by fighter. These are the bodies' own
 * standings, relayed by the data supplier; they are never mixed into Ringside's Elo ranking. A place held by a fighter we do not hold keeps the name it came with.
 */
export interface OfficialEntry { rank: number | null; boxerId: number | null; name: string | null; titleType: "full" | "regular" | "interim" | null; vacant: boolean }
export interface OfficialList { body: RankingBody; division: string; sex: "male" | "female"; updatedAt: string | null; champions: OfficialEntry[]; contenders: OfficialEntry[] }
/** where a fighter stands on a body's list: a belt or a place */
export interface OfficialPlace { body: RankingBody; division: string; sex: "male" | "female"; place: "champion" | number; titleType: OfficialEntry["titleType"]; updatedAt: string | null }
export interface OfficialIndex { byDivision: Map<string, OfficialList[]>; byBoxer: Map<number, OfficialPlace[]> }

export interface OfficialRow { body: string; division: string; sex: string; kind: string; rank: number | null; boxer_id: number | null; name: string | null; title_type: string | null; vacant: number; updated_at: string | null; position: number }

export const officialKey = (sex: string, division: string) => `${sex}|${division}`;
const order = (b: RankingBody) => RANKING_BODIES.indexOf(b);

/** Rows (in the order stored) to the index. Anything that is not one of the four bodies is ignored, and a list keeps its champions apart from its contenders. */
export function buildOfficial(rows: OfficialRow[]): OfficialIndex {
  const lists = new Map<string, OfficialList>();
  const byBoxer = new Map<number, OfficialPlace[]>();
  for (const r of [...rows].sort((a, b) => a.position - b.position)) {
    if (!(RANKING_BODIES as readonly string[]).includes(r.body)) continue;
    const body = r.body as RankingBody, sex = r.sex === "female" ? "female" : "male";
    const key = `${officialKey(sex, r.division)}|${body}`;
    const list = lists.get(key) ?? lists.set(key, { body, division: r.division, sex, updatedAt: r.updated_at, champions: [], contenders: [] }).get(key)!;
    const titleType = r.title_type === "full" || r.title_type === "regular" || r.title_type === "interim" ? r.title_type : null;
    const e: OfficialEntry = { rank: r.rank, boxerId: r.boxer_id, name: r.name, titleType, vacant: r.vacant === 1 };
    (r.kind === "champion" ? list.champions : list.contenders).push(e);
    if (r.boxer_id !== null && !e.vacant) {
      const places = byBoxer.get(r.boxer_id) ?? byBoxer.set(r.boxer_id, []).get(r.boxer_id)!;
      places.push({ body, division: r.division, sex, place: r.kind === "champion" ? "champion" : (r.rank as number), titleType, updatedAt: r.updated_at });
    }
  }
  for (const l of lists.values()) l.contenders.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const byDivision = new Map<string, OfficialList[]>();
  for (const l of lists.values()) (byDivision.get(officialKey(l.sex, l.division)) ?? byDivision.set(officialKey(l.sex, l.division), []).get(officialKey(l.sex, l.division))!).push(l);
  for (const ls of byDivision.values()) ls.sort((a, b) => order(a.body) - order(b.body));
  for (const ps of byBoxer.values()) ps.sort((a, b) => order(a.body) - order(b.body) || (a.place === "champion" ? -1 : b.place === "champion" ? 1 : (a.place as number) - (b.place as number)));
  return { byDivision, byBoxer };
}
