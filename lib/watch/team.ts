import type { DatabaseSync } from "node:sqlite";
import { fetchPage } from "../importers/wikipedia-champions";
import { slugify } from "../slug";
import type { ApplyOutcome, Change, WatchContext, WatchResult, WatchSource } from "./types";

/**
 * Who stands in a fighter's corner, read from the prose of the fighter's own Wikipedia article ("his trainer, X", "was trained by X", "trains out of the Y Gym", "signed with Z Promotions").
 * Wikipedia's boxer infobox has no trainer field and Wikidata names a teacher for only 23 of 19,651 boxers, so there is no structured open source for corners; this reads sentences.
 *
 * A sentence is easy to misread (an article also names the opponent's trainer, a former trainer, a football club's manager), so nothing here is written by itself: every candidate is a
 * PENDING proposal with the sentence it came from and a link to the article, and only an administrator's approval writes a team stint. The stint has no dates (an article's
 * sentence is "now", not "from 2019 to 2022"), so it names the corner without claiming any fight for it, and the trainer-impact figures, which need a tenure, ignore it.
 */
export const TEAM_SOURCE_ID = "wikipedia:team";
export type TeamRoleFound = "head_trainer" | "manager" | "promoter" | "gym";
export interface Candidate { role: TeamRoleFound; title: string; display: string; quote: string }

const stripMarkup = (wt: string): string => {
  let s = wt.replace(/<!--[\s\S]*?-->/g, "").replace(/<ref\b[^>/]*\/>/gi, "").replace(/<ref\b[\s\S]*?<\/ref>/gi, "");
  for (let i = 0; i < 6; i++) s = s.replace(/\{\{[^{}]*\}\}/g, "");   // templates, innermost first
  return s.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, "").replace(/'''?/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
};
const sentencesOf = (text: string): string[] => text.split(/\n+/).flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z[])/)).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 20 && s.length < 600);

/** "[[Billy Nelson (Boxer)|Billy Nelson]]" → the page title and what the article shows. */
const linkOf = (raw: string): { title: string; display: string } => {
  const [t, d] = raw.split("|");
  const title = t.trim().replace(/_/g, " ");
  return { title, display: (d ?? t).trim().replace(/\s*\((?:boxer|trainer|boxing|manager|promoter)\)$/i, "") };
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SUFFIX = /^(?:jr|sr|ii|iii|iv)\.?$/i;
const surnameOf = (name: string): string => { const t = name.split(/\s+/).filter((x) => !SUFFIX.test(x)); return t[t.length - 1] ?? name; };
const PERSON = (t: string) => /^[A-ZÀ-Ý][^ ]* \S/.test(t) && !/\d|F\.?C\.?\b|\b(?:Boxing|Club|Gym|Association|Commission|Council|Union|Promotions?|Sports?|Entertainment|League|University|College|School|Army|Navy|Olympics?|Championships?|Federation|Organi[sz]ation|United|City|County|State|Show)\b/i.test(t) && t.split(" ").length <= 4;
const PROMOTER = /\b(?:Promotions?|Boxing Promotions?|Matchroom|Top Rank|Golden Boy|Queensberry|Sauerland|Hennessy|Boxxer|Probellum|Premier Boxing Champions|Zuffa Boxing|Most Valuable Promotions|Salita|Warriors Boxing|Lou DiBella|DiBella|Bob Arum|Don King|Frank Warren|Eddie Hearn|Ringstar|Splash|Cleverly|Wasserman|Main Events|Goossen|Thompson Boxing|Bellator|Sela|Riyadh Season|Team Sauerland|Mayweather Promotions|Tom Loeffler|Peltz|Gary Shaw|Kalle Sauerland|Warren)\b/i;
const GYM = /\b(?:gym|boxing club|boxing academy|academy|boxing camp|boxing centre|boxing center|boxing gym|athletic club)\b/i;
const FORMER = /\b(?:former(?:ly)?|previous(?:ly)?|ex-|until|left|parted|split|sacked|fired|replaced|after leaving|no longer|opponent|rival)\b/i;

/** What the article's sentences say about the fighter's own corner. At most one candidate per role and page. */
export function extractTeam(wikitext: string, fighter: string): Candidate[] {
  const sur = esc(surnameOf(fighter)), full = esc(fighter);
  const lead = new RegExp(`^(?:(?:In|On|After|Before|During|Early|Later|At|By|Since|For|From|With)\\b[^,]{0,60},\\s*)?(?:${full}|${sur}|He|She)\\b(?![’'][a-z])`);
  const L = "\\[\\[([^\\]]+)\\]\\]", WORDS = "(?:[A-Za-z’'.-]+\\s+){0,3}?";
  const out = new Map<string, Candidate>();
  const add = (role: TeamRoleFound, link: string, quote: string) => {
    const { title, display } = linkOf(link);
    if (!title || title.toLowerCase() === fighter.toLowerCase() || new RegExp(`^${full}`, "i").test(title)) return;
    if ((role === "head_trainer" || role === "manager") && !PERSON(title)) return;
    if (role === "promoter" && !PROMOTER.test(title)) return;
    if (role === "gym" && !GYM.test(title)) return;
    const key = `${role}|${title.toLowerCase()}`;
    if (!out.has(key)) out.set(key, { role, title, display, quote: quote.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").slice(0, 280) });
  };
  for (const s of sentencesOf(stripMarkup(wikitext))) {
    if (FORMER.test(s)) continue;
    // "Briggs's trainer, [[Teddy Atlas]]" / "Fury's new trainer [[Ben Davison]]"
    for (const m of s.matchAll(new RegExp(`${sur}(?:’|')s\\s+(?:(?:long-?time|new|current|head|chief|longtime)\\s+)*(trainer|coach|manager|promoter)\\s*,?\\s*${WORDS}${L}`, "gi"))) {
      const noun = m[1].toLowerCase();
      add(noun === "manager" ? "manager" : noun === "promoter" ? "promoter" : "head_trainer", m[2], s);
    }
    if (!lead.test(s)) continue;
    for (const m of s.matchAll(new RegExp(`\\b(?:is|was|been|being|are)\\s+(?:currently\\s+|now\\s+)?(trained|coached|managed)\\s+by\\s+${WORDS}${L}`, "gi"))) add(m[1].toLowerCase() === "managed" ? "manager" : "head_trainer", m[2], s);
    for (const m of s.matchAll(new RegExp(`\\b(?:trains|trained|training)\\s+(?:out of|at)\\s+(?:the\\s+)?${L}`, "gi"))) add("gym", m[1], s);
    for (const m of s.matchAll(new RegExp(`\\b(?:signed|joined)\\s+(?:a\\s+)?(?:\\w+\\s+){0,4}?(?:with|to)\\s+${L}`, "gi"))) add("promoter", m[1], s);
    for (const m of s.matchAll(new RegExp(`\\bpromoted\\s+by\\s+${WORDS}${L}`, "gi"))) add("promoter", m[1], s);
  }
  return [...out.values()];
}

/** The name a page goes by without a section ("Jake Paul#Most Valuable Promotions" is Most Valuable Promotions) or a disambiguation ("Billy Nelson (boxer)", "Don King (boxing promoter)"): two articles that call one person or company by different page titles are one. */
export const cleanTitle = (title: string): string => (title.includes("#") ? title.split("#").pop()! : title).replace(/\s*\([^)]*\)\s*$/, "").trim();
const norm = (title: string) => slugify(cleanTitle(title));
export const ROLE_WORD: Record<TeamRoleFound, string> = { head_trainer: "trainer", manager: "manager", promoter: "promoter", gym: "gym" };

/** Fighters with a Wikipedia article, the best-rated first (the people a visitor looks for). */
export function fightersToRead(main: DatabaseSync, limit?: number): { id: number; ext: string; name: string; title: string }[] {
  return main.prepare(`SELECT id, external_id ext, name, wikipedia_title title FROM boxers WHERE wikipedia_title IS NOT NULL AND wikipedia_title <> '' AND external_id IS NOT NULL
    ORDER BY (SELECT COUNT(*) FROM bouts WHERE red_id = boxers.id OR blue_id = boxers.id) DESC, id${limit ? ` LIMIT ${Math.floor(limit)}` : ""}`).all() as { id: number; ext: string; name: string; title: string }[];
}

/** Whether the fighter already has this corner (the same person or organisation in the same role). */
function held(main: DatabaseSync, boxerId: number, role: TeamRoleFound, title: string): boolean {
  const ext = `wikipedia:${norm(title)}`;
  return !!main.prepare(`SELECT 1 x FROM team_stints s LEFT JOIN people p ON p.id = s.person_id LEFT JOIN orgs o ON o.id = s.org_id WHERE s.boxer_id = ? AND s.role = ? AND (p.external_id = ? OR o.external_id = ?) LIMIT 1`).get(boxerId, role, ext, ext);
}

export const teamSource: WatchSource = {
  id: TEAM_SOURCE_ID,
  label: "Wikipedia articles (trainers, managers, gyms and promoters named in a fighter's own article)",
  kind: "details",
  terms: "Text CC BY-SA 4.0 (credit Wikipedia, link the article); read through the MediaWiki API with a contact header, cached, one request at a time. Read from sentences, so every candidate is shown to the approver with its sentence; nothing is written without approval.",
  enabled: true,
  async run(ctx: WatchContext): Promise<WatchResult> {
    const res: WatchResult = { changes: [], scope: [], refused: [], compared: 0 };
    for (const f of fightersToRead(ctx.main, ctx.limit)) {
      let page;
      try { page = await fetchPage(f.title, { ...ctx.fetch, log: ctx.log }); } catch (e) { res.refused.push({ scope: f.name, reason: `could not read the article: ${(e as Error).message}` }); continue; }
      res.compared++;
      res.scope.push(`team|${f.ext}|`);
      for (const c of extractTeam(page.wikitext, f.name)) {
        if (held(ctx.main, f.id, c.role, c.title)) continue;
        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(f.title.replace(/ /g, "_"))}`;
        res.changes.push({
          kind: "team_added", targetKey: `team|${f.ext}|${c.role}|${norm(c.title)}`,
          label: `${f.name}: ${ROLE_WORD[c.role]} ${c.display} (${f.name}'s Wikipedia article)`,
          old: null, new: { role: c.role, name: c.display, page: c.title },
          evidence: { page: f.title.replace(/ /g, "_"), revision: page.revision, url, quote: c.quote, corroboration: "single unofficial source: read from a sentence",
            apply: { boxerExternalId: f.ext, role: c.role, title: c.title, display: c.display, url } },
        } as Change);
      }
    }
    return res;
  },
  apply: (main, p) => applyTeam(main, p),
};

/** Writes one approved corner: the person or organisation (made if new) and an undated stint with its source. Safe to run twice; refuses a boxer that is gone. */
export function applyTeam(main: DatabaseSync, p: { kind: string; targetKey: string; old: unknown; new: unknown; evidence: unknown }): ApplyOutcome {
  const a = ((p.evidence ?? {}) as { quote?: string; apply?: { boxerExternalId?: string; role?: string; title?: string; display?: string; url?: string } }).apply;
  const roles: TeamRoleFound[] = ["head_trainer", "manager", "promoter", "gym"];
  if (p.kind !== "team_added" || !a?.boxerExternalId || !a.title || !a.display || !roles.includes(a.role as TeamRoleFound)) return { ok: false, error: "bad_proposal" };
  const role = a.role as TeamRoleFound;
  const boxer = main.prepare("SELECT id FROM boxers WHERE external_id = ?").get(a.boxerExternalId) as { id: number } | undefined;
  if (!boxer) return { ok: false, error: "gone" };
  if (held(main, boxer.id, role, a.title)) return { ok: true, changed: false };
  const ext = `wikipedia:${norm(a.title)}`;
  const unique = (table: "people" | "orgs", base: string) => { let s = slugify(base) || "x", n = 2; const base0 = s; while (main.prepare(`SELECT 1 x FROM ${table} WHERE slug = ?`).get(s)) s = `${base0}-${n++}`; return s; };
  let personId: number | null = null, orgId: number | null = null;
  if (role === "head_trainer" || role === "manager") {
    const row = main.prepare("SELECT id FROM people WHERE external_id = ?").get(ext) as { id: number } | undefined;
    const shown = a.display.replace(/[’']s$/, "").trim();
    personId = row?.id ?? (main.prepare("INSERT INTO people (external_id, slug, name) VALUES (?, ?, ?) RETURNING id").get(ext, unique("people", shown), shown) as { id: number }).id;
  } else {
    const row = main.prepare("SELECT id FROM orgs WHERE external_id = ?").get(ext) as { id: number } | undefined;
    const shown = cleanTitle(a.title); // an organisation goes by its page's name ("Golden Boy Promotions"), not by how one sentence wrote it ("Golden Boy", "Frank Warren's")
    orgId = row?.id ?? (main.prepare("INSERT INTO orgs (external_id, slug, name, kind) VALUES (?, ?, ?, ?) RETURNING id").get(ext, unique("orgs", shown), shown, role === "gym" ? "gym" : "promotion") as { id: number }).id;
  }
  main.prepare("INSERT INTO team_stints (boxer_id, role, person_id, org_id, start_date, end_date, source, source_url, note) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)")
    .run(boxer.id, role, personId, orgId, "Wikipedia (CC BY-SA 4.0)", a.url ?? null, `Named in the fighter's Wikipedia article: "${(((p.evidence ?? {}) as { quote?: string }).quote ?? "").slice(0, 280)}"; no dates`);
  return { ok: true, changed: true };
}

/** Puts every approved corner back after the database was loaded again. Safe to run twice. */
export function replayTeam(main: DatabaseSync, acc: DatabaseSync): { applied: number; alreadyThere: number; skipped: number } {
  const rows = acc.prepare("SELECT kind, target_key, old_json, new_json, evidence_json FROM proposals WHERE source = ? AND status = 'approved' AND kind = 'team_added'").all(TEAM_SOURCE_ID) as { kind: string; target_key: string; old_json: string | null; new_json: string | null; evidence_json: string | null }[];
  const out = { applied: 0, alreadyThere: 0, skipped: 0 };
  for (const r of rows) {
    const res = applyTeam(main, { kind: r.kind, targetKey: r.target_key, old: JSON.parse(r.old_json ?? "null"), new: JSON.parse(r.new_json ?? "null"), evidence: JSON.parse(r.evidence_json ?? "{}") });
    if (!res.ok) out.skipped++; else if (res.changed) out.applied++; else out.alreadyThere++;
  }
  return out;
}
