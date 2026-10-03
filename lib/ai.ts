import type { BoxerFull } from "./types";
import { WEIGHT_CLASSES } from "./types";
import type { World } from "./world";
import { recordStr } from "./world";
import { archetype } from "./style";
import { predict } from "./predict";
import { missCount } from "./weights";
import { recentTrainerChanges } from "./team";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
const hasKey = () => !!process.env.ANTHROPIC_API_KEY;

async function claude(system: string, user: string, maxTokens = 600): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const j = (await res.json()) as { content: { type: string; text?: string }[] };
  return j.content.filter((c) => c.type === "text").map((c) => c.text).join("");
}

/* ---------- Natural-language search ---------- */

export interface Filters {
  weightClass?: string;
  stance?: "Orthodox" | "Southpaw" | "Switch";
  sex?: "male" | "female";
  country?: string;
  active?: boolean;
  undefeated?: boolean;
  minWins?: number;
  minKOs?: number;
  minKoRate?: number; // 0-1
  maxKoRate?: number;
  minLosses?: number;
  debutAfter?: number;
  debutBefore?: number;
  minReach?: number;
  minAge?: number;
  maxAge?: number;
  archetype?: string;
  text?: string; // name fragment
  trainer?: string; // head trainer name fragment (ever)
  trainerCurrent?: boolean; // ...restricted to the current head trainer
  manager?: string;
  gym?: string;
  promoter?: string;
  missedWeight?: boolean; // has missed weight at least once
  newTrainer?: boolean; // changed head trainer in the last 9 months
  bornIn?: string; // birthplace fragment
  sort?: "rating" | "wins" | "kos" | "koRate" | "age" | "reach";
}

const COUNTRY_ALIASES: Record<string, string> = {
  american: "United States", usa: "United States", us: "United States", mexican: "Mexico", british: "United Kingdom", uk: "United Kingdom",
  english: "United Kingdom", japanese: "Japan", ukrainian: "Ukraine", filipino: "Philippines", nigerian: "Nigeria", argentine: "Argentina",
  argentinian: "Argentina", saudi: "Saudi Arabia", german: "Germany",
};
const CLASS_ALIASES: Record<string, string> = {
  fly: "Flyweight", bantam: "Bantamweight", feather: "Featherweight", lightweight: "Lightweight", welter: "Welterweight",
  middle: "Middleweight", "light heavy": "Light Heavyweight", "light-heavy": "Light Heavyweight", heavy: "Heavyweight", cruiser: "Light Heavyweight",
};

const NAME = "([\\p{L}.'\\- ]+?)";
const END = "(?=$|,| with | and | who | in | from | over | under | after | before | at )";

/** Pulls "trained by X", "managed by X", "promoted by X", "out of the X gym" out of the query so names don't trip the other rules. */
function peelTeam(q: string, f: Filters): string {
  const take = (re: RegExp, set: (m: RegExpMatchArray) => void) => { const m = q.match(re); if (m) { set(m); q = q.replace(m[0], " "); } };
  take(new RegExp(`(?:currently |now )?(?:trained|coached) by ${NAME}${END}`, "iu"), (m) => { f.trainer = m[1].trim(); if (/currently|now/i.test(m[0])) f.trainerCurrent = true; });
  take(new RegExp(`managed by ${NAME}${END}`, "iu"), (m) => { f.manager = m[1].trim(); });
  take(new RegExp(`(?:promoted by|signed to|with promoter) ${NAME}${END}`, "iu"), (m) => { f.promoter = m[1].trim(); });
  take(new RegExp(`(?:out of|from|at|training at) (?:the )?${NAME} (?:gym|boxing club|academy|training camp|club)${END}`, "iu"), (m) => { f.gym = m[1].trim(); });
  take(new RegExp(`born in ${NAME}${END}`, "iu"), (m) => { f.bornIn = m[1].trim(); });
  take(/(?:ever )?(?:missed|failed to make|came in over)\s*(?:the )?weight|weight (?:miss|cut problems)/i, () => { f.missedWeight = true; });
  take(/new trainer|changed trainers?|switched trainers?|recently (?:changed|switched) (?:trainers?|corners?)/i, () => { f.newTrainer = true; });
  return q;
}

export function heuristicParse(q: string, countries: string[]): Filters {
  const f: Filters = {};
  q = peelTeam(q, f);
  const s = q.toLowerCase();
  for (const wc of [...WEIGHT_CLASSES].sort((a, b) => b.length - a.length)) if (s.includes(wc.toLowerCase())) { f.weightClass = wc; break; }
  if (!f.weightClass) {
    for (const [k, v] of Object.entries(CLASS_ALIASES).sort((a, b) => b[0].length - a[0].length)) if (new RegExp(`\\b${k}`).test(s)) { f.weightClass = v; break; }
  }
  if (/southpaw|lefty|left-hand/.test(s)) f.stance = "Southpaw";
  if (/orthodox|right-hand/.test(s)) f.stance = "Orthodox";
  if (/\bswitch\b|ambidextrous|switch-hitter/.test(s)) f.stance = "Switch";
  if (/\bwom[ae]n['’]?s?\b|\bfemale\b|\bladies\b/.test(s)) f.sex = "female";
  else if (/\bmen['’]?s?\b|\bmale\b|\bguys\b/.test(s)) f.sex = "male";
  for (const c of countries) if (s.includes(c.toLowerCase())) f.country = c;
  for (const [k, v] of Object.entries(COUNTRY_ALIASES)) if (new RegExp(`\\b${k}\\b`).test(s)) f.country = v;
  if (/undefeated|unbeaten|perfect record|0 losses/.test(s)) f.undefeated = true;
  if (/\bretired\b/.test(s)) f.active = false;
  else if (/\bactive\b|currently/.test(s)) f.active = true;
  const wins = s.match(/(\d+)\+?\s*wins/); if (wins) f.minWins = +wins[1];
  const kos = s.match(/(\d+)\+?\s*(?:kos?|knockouts?)/); if (kos) f.minKOs = +kos[1];
  const kor = s.match(/(\d+)\s*%\s*(?:ko|knockout)/); if (kor) f.minKoRate = +kor[1] / 100;
  if (/big puncher|heavy hand|power puncher|knockout artist|devastating/.test(s)) f.archetype = "Knockout Artist";
  if (/technician|technical|skilled boxer/.test(s)) f.archetype = "Technician";
  if (/counter/.test(s)) f.archetype = "Counter-Puncher";
  if (/brawler/.test(s)) f.archetype = "Iron-Chin Brawler";
  if (/volume|workrate|work rate/.test(s)) f.archetype = "Volume Boxer";
  if (/journeyman|journeymen|gatekeeper/.test(s)) f.archetype = "Journeyman";
  const after = s.match(/(?:after|since|from)\s+(20\d\d)/); if (after) f.debutAfter = +after[1];
  const before = s.match(/before\s+(20\d\d)/); if (before) f.debutBefore = +before[1];
  const reach = s.match(/reach\s*(?:over|above|>|of)?\s*(\d{3})/); if (reach) f.minReach = +reach[1];
  const over = s.match(/(?:over|older than)\s*(\d{2})\b(?!\s*(?:wins|kos))/); if (over && +over[1] >= 25) f.minAge = +over[1] + 1; // "over 33" means 34+
  const under = s.match(/(?:under|younger than)\s*(\d{2})\b/); if (under) f.maxAge = +under[1];
  if (/young|prospect/.test(s) && !f.maxAge) f.maxAge = 26;
  if (/veteran|old/.test(s) && !f.minAge) f.minAge = 35;
  if (/best|top|highest rated|greatest/.test(s)) f.sort = "rating";
  if (/most (?:ko|knockout)/.test(s)) f.sort = "kos";
  if (/most wins/.test(s)) f.sort = "wins";
  if (!Object.keys(f).length && q.trim()) f.text = q.trim();
  return f;
}

export async function parseQuery(q: string, w: World): Promise<{ filters: Filters; source: "ai" | "rules" }> {
  const countries = [...new Set(w.boxers.map((b) => b.country))];
  if (hasKey()) {
    try {
      const sys = `You turn boxing database search requests into JSON filters. Respond with ONLY a JSON object, no prose.
Allowed keys: weightClass (one of ${WEIGHT_CLASSES.join(", ")}), stance (Orthodox|Southpaw|Switch), sex (male|female), country (one of ${countries.join(", ")}), active (bool), undefeated (bool), minWins, minKOs (ints), minKoRate, maxKoRate (0-1), minLosses, debutAfter, debutBefore (years), minReach (cm), minAge, maxAge, archetype (Knockout Artist|Volume Boxer|Technician|Iron-Chin Brawler|Counter-Puncher|Journeyman|Prospect), text (name fragment), trainer, manager, gym, promoter, bornIn (name fragments), trainerCurrent, missedWeight, newTrainer (bools), sort (rating|wins|kos|koRate|age|reach). Omit keys that do not apply.`;
      const out = await claude(sys, q, 300);
      const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
      return { filters: sanitize(json, countries), source: "ai" };
    } catch {
      /* fall through to rules */
    }
  }
  return { filters: heuristicParse(q, countries), source: "rules" };
}

function sanitize(j: Record<string, unknown>, countries: string[]): Filters {
  const f: Filters = {};
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);
  if (typeof j.weightClass === "string" && (WEIGHT_CLASSES as readonly string[]).includes(j.weightClass)) f.weightClass = j.weightClass;
  if (j.stance === "Orthodox" || j.stance === "Southpaw" || j.stance === "Switch") f.stance = j.stance;
  if (j.sex === "male" || j.sex === "female") f.sex = j.sex;
  if (typeof j.country === "string" && countries.includes(j.country)) f.country = j.country;
  if (typeof j.active === "boolean") f.active = j.active;
  if (typeof j.undefeated === "boolean") f.undefeated = j.undefeated;
  for (const k of ["minWins", "minKOs", "minKoRate", "maxKoRate", "minLosses", "debutAfter", "debutBefore", "minReach", "minAge", "maxAge"] as const) {
    const v = num(j[k]); if (v !== undefined) f[k] = v;
  }
  if (typeof j.archetype === "string") f.archetype = j.archetype;
  if (typeof j.text === "string") f.text = j.text.slice(0, 60);
  for (const k of ["trainer", "manager", "gym", "promoter", "bornIn"] as const) if (typeof j[k] === "string" && j[k]) f[k] = (j[k] as string).slice(0, 60);
  for (const k of ["trainerCurrent", "missedWeight", "newTrainer"] as const) if (typeof j[k] === "boolean") f[k] = j[k] as boolean;
  if (typeof j.sort === "string" && ["rating", "wins", "kos", "koRate", "age", "reach"].includes(j.sort)) f.sort = j.sort as Filters["sort"];
  return f;
}

/** Boxer ids linked to people/orgs whose name matches, through stints in the given roles. */
function idsVia(w: World, frag: string, source: "person" | "org", roles: string[], currentOnly = false): Set<number> {
  const q = frag.toLowerCase();
  const ids = new Set<number>();
  if (source === "person") {
    for (const p of w.people.values()) if (p.name.toLowerCase().includes(q)) for (const st of w.stintsByPerson.get(p.id) ?? []) if (roles.includes(st.role) && (!currentOnly || st.end === null)) ids.add(st.boxerId);
  } else {
    for (const o of w.orgs.values()) if (o.name.toLowerCase().includes(q)) for (const st of w.stintsByOrg.get(o.id) ?? []) if (roles.includes(st.role) && (!currentOnly || st.end === null)) ids.add(st.boxerId);
  }
  return ids;
}

export function applyFilters(boxers: BoxerFull[], f: Filters, w?: World): BoxerFull[] {
  const via = new Map<string, Set<number>>();
  if (w) {
    if (f.trainer) via.set("trainer", idsVia(w, f.trainer, "person", ["head_trainer", "assistant_trainer"], !!f.trainerCurrent));
    if (f.manager) via.set("manager", idsVia(w, f.manager, "person", ["manager"], false));
    if (f.gym) via.set("gym", idsVia(w, f.gym, "org", ["gym"], false));
    if (f.promoter) via.set("promoter", idsVia(w, f.promoter, "org", ["promoter"], false));
    if (f.newTrainer) via.set("newTrainer", new Set(recentTrainerChanges(w, 9).map((c) => c.boxer.id)));
  }
  const out = boxers.filter((b) =>
    (!via.has("trainer") || via.get("trainer")!.has(b.id)) && (!via.has("manager") || via.get("manager")!.has(b.id)) &&
    (!via.has("gym") || via.get("gym")!.has(b.id)) && (!via.has("promoter") || via.get("promoter")!.has(b.id)) &&
    (!via.has("newTrainer") || via.get("newTrainer")!.has(b.id)) &&
    (!f.missedWeight || (!!w && missCount(w, b.id) > 0)) &&
    (!f.bornIn || (b.birthPlace ?? "").toLowerCase().includes(f.bornIn.toLowerCase())) &&
    (!f.weightClass || b.weightClass === f.weightClass) &&
    (!f.stance || b.stance === f.stance) &&
    (!f.sex || b.sex === f.sex) &&
    (!f.country || b.country === f.country) &&
    (f.active === undefined || b.active === f.active) &&
    (!f.undefeated || (b.losses === 0 && b.bouts > 0)) &&
    (f.minWins === undefined || b.wins >= f.minWins) &&
    (f.minKOs === undefined || b.kos >= f.minKOs) &&
    (f.minKoRate === undefined || b.koRate >= f.minKoRate) &&
    (f.maxKoRate === undefined || b.koRate <= f.maxKoRate) &&
    (f.minLosses === undefined || b.losses >= f.minLosses) &&
    (f.debutAfter === undefined || b.turnedPro >= f.debutAfter) &&
    (f.debutBefore === undefined || b.turnedPro <= f.debutBefore) &&
    (f.minReach === undefined || b.reachCm >= f.minReach) &&
    (f.minAge === undefined || b.age >= f.minAge) &&
    (f.maxAge === undefined || b.age <= f.maxAge) &&
    (!f.archetype || archetype(b) === f.archetype) &&
    (!f.text || `${b.name} ${b.nickname ?? ""}`.toLowerCase().includes(f.text.toLowerCase())),
  );
  const key = f.sort ?? "rating";
  const val = (b: BoxerFull) => ({ rating: b.rating, wins: b.wins, kos: b.kos, koRate: b.koRate, age: -b.age, reach: b.reachCm })[key];
  return out.sort((a, b) => val(b) - val(a));
}

export function describeFilters(f: Filters): string[] {
  const c: string[] = [];
  if (f.weightClass) c.push(f.weightClass);
  if (f.stance) c.push(f.stance);
  if (f.sex) c.push(f.sex === "female" ? "Women" : "Men");
  if (f.country) c.push(f.country);
  if (f.active !== undefined) c.push(f.active ? "Active" : "Retired");
  if (f.undefeated) c.push("Undefeated");
  if (f.minWins !== undefined) c.push(`${f.minWins}+ wins`);
  if (f.minKOs !== undefined) c.push(`${f.minKOs}+ KOs`);
  if (f.minKoRate !== undefined) c.push(`KO rate ≥ ${Math.round(f.minKoRate * 100)}%`);
  if (f.maxKoRate !== undefined) c.push(`KO rate ≤ ${Math.round(f.maxKoRate * 100)}%`);
  if (f.minLosses !== undefined) c.push(`${f.minLosses}+ losses`);
  if (f.debutAfter !== undefined) c.push(`Pro debut ≥ ${f.debutAfter}`);
  if (f.debutBefore !== undefined) c.push(`Pro debut ≤ ${f.debutBefore}`);
  if (f.minReach !== undefined) c.push(`Reach ≥ ${f.minReach}cm`);
  if (f.minAge !== undefined) c.push(`Age ≥ ${f.minAge}`);
  if (f.maxAge !== undefined) c.push(`Age ≤ ${f.maxAge}`);
  if (f.archetype) c.push(f.archetype);
  if (f.text) c.push(`Name “${f.text}”`);
  if (f.trainer) c.push(`${f.trainerCurrent ? "Currently trained" : "Trained"} by ${f.trainer}`);
  if (f.manager) c.push(`Managed by ${f.manager}`);
  if (f.promoter) c.push(`Promoter ${f.promoter}`);
  if (f.gym) c.push(`Gym ${f.gym}`);
  if (f.bornIn) c.push(`Born in ${f.bornIn}`);
  if (f.missedWeight) c.push("Has missed weight");
  if (f.newTrainer) c.push("New trainer (9 months)");
  if (f.sort) c.push(`Sorted by ${f.sort}`);
  return c;
}

/* ---------- Scouting reports ---------- */

const reportCache = new Map<string, { text: string; source: "ai" | "rules" }>();

export function rulesReport(b: BoxerFull, w: World): string {
  const a = archetype(b);
  const rank = w.boxers.filter((x) => x.weightClass === b.weightClass && x.active && x.rating > b.rating).length + 1;
  const parts: string[] = [];
  parts.push(`${b.name}${b.nickname ? ` “${b.nickname}”` : ""} is a ${b.age}-year-old ${b.stance.toLowerCase()} ${b.weightClass.toLowerCase()} from ${b.country}, ${recordStr(b)} with ${b.kos} knockouts (${Math.round(b.koRate * 100)}% of wins).`);
  const style: Record<string, string> = {
    "Knockout Artist": "He fights to finish: short fights, heavy shots, and opponents who rarely hear the final bell.",
    "Volume Boxer": "He wins by accumulation, throwing in volume and trusting the scorecards over a single big shot.",
    Technician: "A clean, economical boxer who wins on timing and distance rather than raw power.",
    "Iron-Chin Brawler": "A pressure fighter who walks through return fire and bets his chin beats yours.",
    "Counter-Puncher": "He lets opponents lead, punishing mistakes — outcomes hinge on who forces the pace.",
    Journeyman: "A durable professional who takes tough fights on short notice; he tests rising contenders more often than he beats them.",
    Prospect: "Too few rounds on the record to pin down a style; every fight right now is a data point.",
  };
  parts.push(`Style: ${a}. ${style[a]}`);
  parts.push(`Rated ${Math.round(b.rating)} Elo, currently #${rank} among all ${b.weightClass.toLowerCase()} fighters in the database.${b.streak.type === "W" && b.streak.count >= 3 ? ` He arrives on a ${b.streak.count}-fight win streak.` : b.streak.type === "L" && b.streak.count >= 2 ? ` He has lost his last ${b.streak.count} and needs a response.` : ""}`);
  if (b.reachCm - b.heightCm >= 5) parts.push(`A ${b.reachCm - b.heightCm}cm reach-over-height advantage gives him a natural jab.`);
  if (b.losses && b.koLosses / b.losses >= 0.6) parts.push("Concern: most of his defeats came by stoppage.");
  return parts.join(" ");
}

export async function scoutingReport(b: BoxerFull, w: World) {
  const cached = reportCache.get(b.slug + w.today);
  if (cached) return cached;
  let result = { text: rulesReport(b, w), source: "rules" as "ai" | "rules" };
  if (hasKey()) {
    try {
      const recent = (w.boutsByBoxer.get(b.id) ?? []).filter((x) => !x.upcoming && x.method).slice(-6).map((x) => {
        const opp = x.redId === b.id ? x.blueName : x.redName;
        const r = x.winnerId === null ? "D" : x.winnerId === b.id ? "W" : "L";
        return `${r} ${x.method}${x.endRound ? " R" + x.endRound : ""} vs ${opp}`;
      });
      const facts = `${b.name} (${b.nickname ?? "no nickname"}), ${b.age}, ${b.country}, ${b.stance}, ${b.weightClass}, ${b.heightCm}cm/${b.reachCm}cm reach, record ${recordStr(b)}, ${b.kos} KOs, ${b.koLosses} KO losses, Elo ${Math.round(b.rating)}, style archetype ${archetype(b)}, avg fight length ${b.avgRounds.toFixed(1)} rounds. Last fights: ${recent.join("; ")}.`;
      const text = await claude(
        "You are a boxing analyst writing a short scouting report (90-130 words, 2 paragraphs) for a stats site. Use ONLY the facts supplied; do not invent opponents, titles, or biography. Note that this is a fictional demo dataset only if asked. Plain text, no headings.",
        facts, 400,
      );
      result = { text: text.trim(), source: "ai" };
    } catch { /* keep rules */ }
  }
  reportCache.set(b.slug + w.today, result);
  return result;
}

export function matchupBlurb(a: BoxerFull, b: BoxerFull): string {
  const p = predict(a, b);
  const fav = p.pA >= p.pB ? a : b;
  const pf = Math.max(p.pA, p.pB);
  return `${p.confidence}: ${fav.name} ${Math.round(pf * 100)}%. ${p.koProb > 0.5 ? "Expect a stoppage." : "Likely goes the distance."}`;
}
