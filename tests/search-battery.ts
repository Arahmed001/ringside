import type { World } from "../lib/world";
import type { Names } from "../lib/i18n/t";
import { mulberry32 } from "../lib/prng";

/**
 * Misspelt, abbreviated and re-ordered queries for fighters that exist, made from the world's own names, so the same battery works for any league.
 * Each case has the fighter who should be among the type-ahead's eight results. The kinds are in three groups:
 *   A  the mistakes the matcher was designed for (a letter missing, swapped or wrong; an initial; a hyphen dropped; a nickname)
 *   B  related ones it was not tuned on (an extra letter, a vowel confused, two slips, a slip in each name)
 *   C  respellings by ear (c/k, ph/f, y/i, z/s)
 *   D  written after the matcher was built and measured once before it was touched again: keyboard-neighbour slips, a stray letter at the start, stray
 *      spaces and punctuation, a space inside a name, shouting; and in Arabic a swap and a look-alike letter
 * `ambiguous` cases (a bare surname shared by more than eight fighters) are left out: there is no right answer to find.
 */
export interface SearchCase { q: string; target: number; kind: string; group: "A" | "B" | "C" | "D" | "AR"; ar?: boolean }

const VOWELS = "aeiou";
const swapAdjacent = (s: string, i: number) => s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

export function searchCases(w: World, names: Names, seed = 7): SearchCase[] {
  const r = mulberry32(seed);
  const pool = w.boxers.filter((b) => b.bouts >= 1);
  const byBouts = [...pool].sort((a, b) => b.bouts - a.bouts || a.id - b.id);
  const targets = new Map<number, (typeof pool)[number]>();
  for (const b of byBouts.slice(0, 60)) targets.set(b.id, b);
  for (let i = 0; i < 400 && targets.size < 140; i++) { const b = pool[Math.floor(r() * pool.length)]; targets.set(b.id, b); }
  const lastCount = new Map<string, number>();
  for (const b of w.boxers) { const l = strip(b.name).toLowerCase().split(" ").slice(-1)[0]; lastCount.set(l, (lastCount.get(l) ?? 0) + 1); }
  const nickCount = new Map<string, number>();
  for (const b of w.boxers) if (b.nickname) nickCount.set(b.nickname.toLowerCase(), (nickCount.get(b.nickname.toLowerCase()) ?? 0) + 1);
  const out: SearchCase[] = [];
  const add = (q: string, target: number, kind: string, group: SearchCase["group"], ar = false) => { if (q.trim()) out.push({ q, target, kind, group, ...(ar ? { ar } : {}) }); };
  const pick = (n: number) => Math.floor(r() * n);
  for (const b of targets.values()) {
    const parts = b.name.split(" ");
    const first = parts[0], last = parts[parts.length - 1];
    const L = strip(last).toLowerCase(), F = strip(first).toLowerCase();
    // ---- A
    add(b.name, b.id, "the full name, as written (control)", "A");
    if (strip(b.name) !== b.name) add(strip(b.name), b.id, "accents left off", "A");
    if ((lastCount.get(L) ?? 0) <= 8) add(L, b.id, "surname only", "A");
    add(`${last} ${first}`, b.id, "surname first", "A");
    if (L.length >= 5) { const i = 1 + pick(L.length - 2); add(`${F} ${L.slice(0, i)}${L.slice(i + 1)}`, b.id, "a letter missing from the surname", "A"); }
    if (F.length >= 5) { const i = 1 + pick(F.length - 2); add(`${F.slice(0, i)}${F.slice(i + 1)} ${L}`, b.id, "a letter missing from the first name", "A"); }
    if (L.length >= 5) { const i = 1 + pick(L.length - 3); add(`${F} ${swapAdjacent(L, i)}`, b.id, "two letters swapped in the surname", "A"); }
    if (L.length >= 5) { const i = 1 + pick(L.length - 2); const c = "bcdfghjklmnpqrstvwz".replace(L[i], "")[pick(18)]; add(`${F} ${L.slice(0, i)}${c}${L.slice(i + 1)}`, b.id, "a letter wrong in the surname", "A"); }
    add(`${F[0]} ${L}`, b.id, "initial and surname", "A");
    add(`${F[0]}. ${L}`, b.id, "initial with a full stop, and surname", "A");
    add(`${F} ${L.slice(0, Math.max(2, Math.ceil(L.length / 2)))}`, b.id, "typed so far (first name and half the surname)", "A");
    if (/-/.test(last)) add(`${F} ${strip(last).toLowerCase().replace(/-/g, "")}`, b.id, "hyphen dropped from the surname", "A");
    if (b.nickname && (nickCount.get(b.nickname.toLowerCase()) ?? 0) <= 8) add(b.nickname, b.id, "nickname", "A");
    // ---- B
    if (L.length >= 4) { const i = 1 + pick(L.length - 1); add(`${F} ${L.slice(0, i)}${L[i]}${L.slice(i)}`, b.id, "an extra (doubled) letter in the surname", "B"); }
    if (L.length >= 5) { const idx = [...L].map((c, i) => [c, i] as const).filter(([c, i]) => VOWELS.includes(c) && i > 0); if (idx.length) { const [c, i] = idx[pick(idx.length)]; add(`${F} ${L.slice(0, i)}${VOWELS.replace(c, "")[pick(4)]}${L.slice(i + 1)}`, b.id, "a vowel confused in the surname", "B"); } }
    if (L.length >= 8) { const i = 1 + pick(3), j = 4 + pick(L.length - 5); add(`${F} ${L.slice(0, i)}${L.slice(i + 1, j)}${L.slice(j + 1)}`, b.id, "two letters missing from a long surname", "B"); }
    if (L.length >= 5 && F.length >= 5) { const i = 1 + pick(L.length - 2), j = 1 + pick(F.length - 2); add(`${F.slice(0, j)}${F.slice(j + 1)} ${L.slice(0, i)}${L.slice(i + 1)}`, b.id, "a letter missing from each name", "B"); }
    if (F.length >= 4) { const i = 1 + pick(F.length - 2); add(`${swapAdjacent(F, Math.min(i, F.length - 2))} ${L}`, b.id, "two letters swapped in the first name", "B"); }
    // ---- C: how a person might spell it by ear
    const ph = L.replace(/ph/g, "f").replace(/ck/g, "k").replace(/ch/g, "sh").replace(/c(?=[aou])/g, "k").replace(/y/g, "i").replace(/z/g, "s");
    if (ph !== L) add(`${F} ${ph}`, b.id, "spelt by ear (c/k, ph/f, ch/sh, y/i, z/s)", "C");
    // ---- D
    const NEAR: Record<string, string> = { a: "s", e: "r", i: "o", o: "p", u: "y", t: "r", n: "m", l: "k", r: "t", s: "d", d: "f", m: "n", b: "v", c: "x", g: "h", h: "j", p: "o", k: "l", v: "b", w: "q", y: "u", f: "g", j: "k", z: "x", q: "w", x: "z" };
    if (L.length >= 5) { const i = 1 + pick(L.length - 2); add(`${F} ${L.slice(0, i)}${NEAR[L[i]] ?? "x"}${L.slice(i + 1)}`, b.id, "a neighbouring key hit in the surname", "D"); }
    add(`${"x"}${F} ${L}`, b.id, "a stray letter before the first name", "D");
    add(`  ${b.name.toUpperCase()}!! `, b.id, "SHOUTED, with extra spaces and punctuation", "D");
    if (L.length >= 6) { const i = 2 + pick(L.length - 4); add(`${F} ${L.slice(0, i)} ${L.slice(i)}`, b.id, "a space inside the surname", "D"); }
    if (F.length >= 4) { const i = 1 + pick(F.length - 2); add(`${F.slice(0, i)}${NEAR[F[i]] ?? "x"}${F.slice(i + 1)} ${L}`, b.id, "a neighbouring key hit in the first name", "D"); }
    if (parts.length >= 3) { const mid = strip(parts[1]).toLowerCase().replace(/\./g, ""); add(`${F} ${mid} ${L.slice(0, -1)}`, b.id, "a three-part name with the last letter dropped", "D"); }
    // ---- Arabic
    const ar = names[b.name];
    if (ar) {
      add(ar, b.id, "the Arabic name, as written (control)", "AR", true);
      const ap = ar.split(" "), al = ap[ap.length - 1];
      if (al.length >= 4) { const i = 1 + pick(al.length - 2); add(`${ap.slice(0, -1).join(" ")} ${al.slice(0, i)}${al.slice(i + 1)}`.trim(), b.id, "a letter missing from the Arabic surname", "AR", true); }
      if (al.length >= 4) { const i = 1 + pick(al.length - 3); add(`${ap.slice(0, -1).join(" ")} ${al.slice(0, i)}${al[i + 1]}${al[i]}${al.slice(i + 2)}`.trim(), b.id, "two letters swapped in the Arabic surname", "D", true); }
      const LOOK: Record<string, string> = { س: "ص", ص: "س", ت: "ط", ط: "ت", ذ: "ز", ز: "ذ", د: "ض", ض: "د", ك: "ق", ق: "ك", ح: "خ", خ: "ح", ع: "غ", غ: "ع" };
      const j = [...al].findIndex((c) => LOOK[c]);
      if (j >= 0 && al.length >= 4) add(`${ap.slice(0, -1).join(" ")} ${al.slice(0, j)}${LOOK[al[j]]}${al.slice(j + 1)}`.trim(), b.id, "a look-alike letter in the Arabic surname", "D", true);
      add(ar.replace(/ا/g, "أ"), b.id, "alef with a hamza where there was none", "AR", true);
      add(ar.replace(/ي/g, "ى").replace(/ه/g, "ة"), b.id, "ya and ta marbuta spelling variants", "AR", true);
    }
  }
  return out;
}

/**
 * The same kinds of slip for the other things the ⌘K palette finds: corner people (trainers, managers, judges, referees), gyms, promotions and sanctioning bodies,
 * and events by venue or city. The thing meant is any hit whose address is in `hrefs` (a venue hosts many events: any of them is right).
 */
export interface EntityCase { q: string; hrefs: string[]; kind: string; entity: "person" | "org" | "venue" | "city"; group: "A" | "B" }

export function entityCases(w: World, seed = 11): EntityCase[] {
  const r = mulberry32(seed);
  const pick = (n: number) => Math.floor(r() * n);
  const out: EntityCase[] = [];
  const word = (s: string) => strip(s).toLowerCase().split(/[\s\-]+/).filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)[0];
  const slips = (name: string, entity: EntityCase["entity"], hrefs: string[]) => {
    const key = word(name);
    if (!key) return;
    const rest = strip(name).toLowerCase();
    const sub = (f: (k: string) => string) => rest.replace(key, f(key));
    const add = (q: string, kind: string, group: "A" | "B") => { if (q !== rest || kind.includes("control")) out.push({ q, hrefs, kind, entity, group }); };
    add(rest, "as written (control)", "A");
    { const i = 1 + pick(key.length - 2); add(sub((k) => k.slice(0, i) + k.slice(i + 1)), "a letter missing", "A"); }
    { const i = 1 + pick(key.length - 2); const c = "bcdfghjklmnpqrstvwz".replace(key[i], "")[pick(18)]; add(sub((k) => k.slice(0, i) + c + k.slice(i + 1)), "a letter wrong", "A"); }
    if (key.length >= 5) { const i = 1 + pick(key.length - 3); add(sub((k) => k.slice(0, i) + k[i + 1] + k[i] + k.slice(i + 2)), "two letters swapped", "A"); }
    { const i = 1 + pick(key.length - 1); add(sub((k) => k.slice(0, i) + k[i] + k.slice(i)), "an extra (doubled) letter", "B"); }
    { const vs = [...key].map((c, i) => [c, i] as const).filter(([c, i]) => "aeiou".includes(c) && i > 0); if (vs.length) { const [c, i] = vs[pick(vs.length)]; add(sub((k) => k.slice(0, i) + "aeiou".replace(c, "")[pick(4)] + k.slice(i + 1)), "a vowel confused", "B"); } }
    if (/-/.test(name)) add(rest.replace(/-/g, ""), "a hyphen dropped", "A");
  };
  const roles = (id: number) => w.roles.get(id);
  const people = [...w.people.values()].filter((p) => roles(p.id)?.size).sort((a, b) => a.id - b.id);
  for (let i = 0; i < people.length && i < 400; i += Math.max(1, Math.floor(people.length / 90))) slips(people[i].name, "person", [`/people/${people[i].slug}`]);
  const orgs = [...w.orgs.values()].sort((a, b) => a.id - b.id);
  for (let i = 0; i < orgs.length; i += Math.max(1, Math.floor(orgs.length / 90))) slips(orgs[i].name, "org", [`/orgs/${orgs[i].slug}`]);
  const venues = new Map<string, string[]>(), cities = new Map<string, string[]>();
  for (const e of w.events) { if (e.status === "cancelled") continue; (venues.get(e.venue) ?? venues.set(e.venue, []).get(e.venue)!).push(`/events/${e.id}`); (cities.get(e.city) ?? cities.set(e.city, []).get(e.city)!).push(`/events/${e.id}`); }
  for (const [v, hrefs] of [...venues].slice(0, 60)) slips(v, "venue", hrefs);
  for (const [c, hrefs] of [...cities].slice(0, 40)) slips(c, "city", hrefs);
  return out;
}
