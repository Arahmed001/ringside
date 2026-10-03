import type { World } from "../lib/world";
import { mulberry32 } from "../lib/prng";
import type { Names } from "../lib/i18n/t";

/**
 * Questions that name a fighter or trainer with a slip in the spelling ("tell me about Marcus Brightwel", "Lukas Hartmnan vs Tomas Villalba"), made from the
 * league's own names so the same battery works for any league. `tests/ask-battery.ts` has the questions people ask; this one has the names they get a little
 * wrong, which the rule-based planner (no API key) used to read as no name at all. The groups:
 *   A  the slips the name matching was designed for (a letter missing, swapped or wrong; accents or capitals left off)
 *   B  related ones it was not tuned on (a doubled letter, a vowel confused, a slip in each name, two slips in a long surname, spelt by ear)
 *   C  written after A and B were passing, and measured once before the matching was touched again: a neighbouring key hit, a stray letter, a space inside a
 *      name, SHOUTING, a name in the middle of a long sentence, a three-part name with a letter dropped, and the Arabic names with the slips Arabic has
 *   N  names that are nobody's (nothing near any fighter or trainer): the honest answer is that no one was named
 * `names` are the people the answer must be about: each has to appear in what the first tool call finds, and it has to be the right tool.
 */
export interface NameCase { q: string; tool: string | null; names: string[]; kind: string; group: "A" | "B" | "C" | "N"; ar?: boolean }

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const swapAdjacent = (s: string, i: number) => s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
const VOWELS = "aeiou";

const SINGLE = ["tell me about {x}", "what is {x}'s record", "how old is {x}", "{x} stats", "who is {x}", "is {x} a southpaw", "what was {x}'s last fight"];
const PAIR = ["{x} vs {y}", "compare {x} and {y}", "who would win between {x} and {y}", "has {x} fought {y}", "{x} versus {y}: who is better"];
const TRAINER = ["how good is {x} as a trainer", "trainer {x}", "what is {x}'s impact as a coach"];

export function nameCases(w: World, ar: Names = {}, seed = 23): NameCase[] {
  const r = mulberry32(seed);
  const pick = (n: number) => Math.floor(r() * n);
  const fmt = (t: string, x: string, y = "") => t.replace("{x}", x).replace("{y}", y);
  const out: NameCase[] = [];
  const pool = w.boxers.filter((b) => b.bouts >= 1);
  const byBouts = [...pool].sort((a, b) => b.bouts - a.bouts || a.id - b.id);
  const targets = byBouts.slice(0, 50);
  for (let i = 0; i < 400 && targets.length < 110; i++) { const b = pool[pick(pool.length)]; if (!targets.includes(b)) targets.push(b); }
  // a surname that two fighters share, or a name one slip from another fighter's, cannot be told apart by a slip: leave those out
  const lastCount = new Map<string, number>();
  for (const b of w.boxers) { const l = strip(b.name).toLowerCase().split(" ").slice(-1)[0]; lastCount.set(l, (lastCount.get(l) ?? 0) + 1); }
  const trainers = [...w.people.values()].filter((p) => w.roles.get(p.id)?.has("trainer")).slice(0, 40);

  /** The name with one kind of slip, as [text, kind, group]; the same name each time for a fighter so a pair can mix them. */
  const slipsOf = (full: string): { t: string; kind: string; group: "A" | "B" }[] => {
    const parts = full.split(" "), first = parts[0], last = parts[parts.length - 1];
    const F = strip(first), L = strip(last);
    const s: { t: string; kind: string; group: "A" | "B" }[] = [];
    const rep = (nl: string, nf = first) => [nf, ...parts.slice(1, -1), nl].join(" ");
    if (L.length >= 5) { const i = 1 + pick(L.length - 2); s.push({ t: rep(L.slice(0, i) + L.slice(i + 1)), kind: "a letter missing from the surname", group: "A" }); }
    if (F.length >= 5) { const i = 1 + pick(F.length - 2); s.push({ t: rep(last, F.slice(0, i) + F.slice(i + 1)), kind: "a letter missing from the first name", group: "A" }); }
    if (L.length >= 5) { const i = 1 + pick(L.length - 3); s.push({ t: rep(swapAdjacent(L, i)), kind: "two letters swapped in the surname", group: "A" }); }
    if (L.length >= 5) { const i = 1 + pick(L.length - 2); const c = "bcdfghjklmnpqrstvwz".replace(L[i], "")[pick(18)]; s.push({ t: rep(L.slice(0, i) + c + L.slice(i + 1)), kind: "a letter wrong in the surname", group: "A" }); }
    s.push({ t: full.toLowerCase(), kind: "all lower case", group: "A" });
    if (strip(full) !== full) s.push({ t: strip(full), kind: "accents left off", group: "A" });
    if (L.length >= 4) { const i = 1 + pick(L.length - 1); s.push({ t: rep(L.slice(0, i) + L[i] + L.slice(i)), kind: "a doubled letter in the surname", group: "B" }); }
    if (L.length >= 5) { const idx = [...L].map((c, i) => [c, i] as const).filter(([c, i]) => VOWELS.includes(c) && i > 0); if (idx.length) { const [c, i] = idx[pick(idx.length)]; s.push({ t: rep(L.slice(0, i) + VOWELS.replace(c, "")[pick(4)] + L.slice(i + 1)), kind: "a vowel confused in the surname", group: "B" }); } }
    if (L.length >= 5 && F.length >= 5) { const i = 1 + pick(L.length - 2), j = 1 + pick(F.length - 2); s.push({ t: rep(L.slice(0, i) + L.slice(i + 1), F.slice(0, j) + F.slice(j + 1)), kind: "a letter missing from each name", group: "B" }); }
    if (L.length >= 8) { const i = 1 + pick(3), j = 4 + pick(L.length - 5); s.push({ t: rep(L.slice(0, i) + L.slice(i + 1, j) + L.slice(j + 1)), kind: "two letters missing from a long surname", group: "B" }); }
    const ph = L.replace(/ph/g, "f").replace(/ck/g, "k").replace(/ch/g, "sh").replace(/c(?=[aou])/g, "k").replace(/y/g, "i").replace(/z/g, "s");
    if (ph !== L) s.push({ t: rep(ph), kind: "spelt by ear (c/k, ph/f, ch/sh, y/i, z/s)", group: "B" });
    return s;
  };

  targets.forEach((b, n) => {
    const own = (lastCount.get(strip(b.name).toLowerCase().split(" ").slice(-1)[0]) ?? 0) <= 8;
    if (!own) return;
    out.push({ q: fmt(SINGLE[pick(SINGLE.length)], b.name), tool: "fighter", names: [b.name], kind: "the name as written (control)", group: "A" });
    for (const s of slipsOf(b.name)) out.push({ q: fmt(SINGLE[pick(SINGLE.length)], s.t), tool: "fighter", names: [b.name], kind: s.kind, group: s.group });
    // two fighters, one or both spelt with a slip
    const o = targets[(n + 1) % targets.length];
    if (o.id === b.id) return;
    const sa = slipsOf(b.name), so = slipsOf(o.name);
    if (!sa.length || !so.length) return;
    const x = sa[pick(sa.length)], y = so[pick(so.length)];
    out.push({ q: fmt(PAIR[pick(PAIR.length)], x.t, o.name), tool: "head_to_head", names: [b.name, o.name], kind: `two fighters, one with a slip (${x.kind})`, group: x.group });
    out.push({ q: fmt(PAIR[pick(PAIR.length)], x.t, y.t), tool: "head_to_head", names: [b.name, o.name], kind: "two fighters, each with a slip", group: x.group === "A" && y.group === "A" ? "A" : "B" });
  });

  for (const p of trainers) {
    out.push({ q: fmt(TRAINER[pick(TRAINER.length)], p.name), tool: "trainers", names: [p.name], kind: "a trainer's name as written (control)", group: "A" });
    for (const s of slipsOf(p.name).filter((x) => x.kind !== "accents left off")) out.push({ q: fmt(TRAINER[pick(TRAINER.length)], s.t), tool: "trainers", names: [p.name], kind: `a trainer: ${s.kind}`, group: s.group });
  }

  // ---- C
  const NEAR: Record<string, string> = { a: "s", e: "r", i: "o", o: "p", u: "y", t: "r", n: "m", l: "k", r: "t", s: "d", d: "f", m: "n", b: "v", c: "x", g: "h", h: "j", p: "o", k: "l", v: "b", w: "q", y: "u", f: "g", j: "k", z: "x", q: "w", x: "z" };
  const LONG = ["who would win if {x} fought {y} next year, in your opinion", "i was watching a replay last night and wondered how {x} compares with {y} overall", "{x}, {y}: which of them has the better record?"];
  const LONG1 = ["i keep hearing about {x} lately, so what is the story", "my friend says {x} is overrated, is that true?", "quick question about {x}: how many fights has he won"];
  const nearKey = (full: string) => { const parts = full.split(" "), L = strip(parts[parts.length - 1]); if (L.length < 5) return null; const i = 1 + pick(L.length - 2); return [...parts.slice(0, -1), L.slice(0, i) + (NEAR[L[i]] ?? "x") + L.slice(i + 1)].join(" "); };
  const strayEnd = (full: string) => { const parts = full.split(" "); if (strip(parts[0]).length < 4) return null; parts[0] = parts[0] + "e"; return parts.join(" "); };
  const spaced = (full: string) => { const parts = full.split(" "), L = strip(parts[parts.length - 1]); if (L.length < 6 || /-/.test(L)) return null; const i = 2 + pick(L.length - 4); return [...parts.slice(0, -1), L.slice(0, i) + " " + L.slice(i)].join(" "); };
  const dropEnd = (full: string) => { const parts = full.split(" "); return parts.length >= 3 ? [...parts.slice(0, -1), parts[parts.length - 1].slice(0, -1)].join(" ") : null; };
  targets.forEach((b, n) => {
    if ((lastCount.get(strip(b.name).toLowerCase().split(" ").slice(-1)[0]) ?? 0) > 8) return;
    const o = targets[(n + 3) % targets.length];
    const one = (q: string, kind: string) => out.push({ q: fmt(SINGLE[pick(SINGLE.length)], q), tool: "fighter", names: [b.name], kind, group: "C" });
    const k = nearKey(b.name); if (k) one(k, "a neighbouring key hit in the surname");
    const e = strayEnd(b.name); if (e) one(e, "a stray letter at the end of the first name");
    const sp = spaced(b.name); if (sp) one(sp, "a space inside the surname");
    const de = dropEnd(b.name); if (de) one(de, "a three-part name with its last letter dropped");
    const kk = nearKey(b.name); if (kk) out.push({ q: fmt(LONG1[pick(LONG1.length)], kk), tool: "fighter", names: [b.name], kind: "a slip, in the middle of a long sentence", group: "C" });
    const shout = nearKey(b.name); if (shout) out.push({ q: fmt(SINGLE[pick(SINGLE.length)], shout.toUpperCase()) + "!!", tool: "fighter", names: [b.name], kind: "SHOUTED with a slip", group: "C" });
    if (o.id !== b.id && (lastCount.get(strip(o.name).toLowerCase().split(" ").slice(-1)[0]) ?? 0) <= 8) {
      const x = nearKey(b.name), y = nearKey(o.name);
      if (x && y) out.push({ q: fmt(LONG[pick(LONG.length)], x, y), tool: "head_to_head", names: [b.name, o.name], kind: "two slips, in a long sentence", group: "C" });
    }
  });
  // Arabic: the same names as the site writes them, with the slips Arabic has
  const AR_SINGLE = ["من هو {x}", "ما هو سجل {x}", "كم عمر {x}", "أخبرني عن {x}"];
  const AR_PAIR = ["قارن بين {x} و{y}", "{x} ضد {y}", "من يفوز بين {x} و{y}"];
  const LOOK: Record<string, string> = { س: "ص", ص: "س", ت: "ط", ط: "ت", ذ: "ز", ز: "ذ", د: "ض", ض: "د", ك: "ق", ق: "ك", ح: "خ", خ: "ح", ع: "غ", غ: "ع" };
  const arSlips = (name: string): { t: string; kind: string }[] => {
    const ap = name.split(" "), al = ap[ap.length - 1], head = ap.slice(0, -1);
    const s: { t: string; kind: string }[] = [];
    const set = (last: string) => [...head, last].join(" ");
    if (al.length >= 4) { const i = 1 + pick(al.length - 2); s.push({ t: set(al.slice(0, i) + al.slice(i + 1)), kind: "Arabic: a letter missing from the surname" }); }
    if (al.length >= 4) { const i = 1 + pick(al.length - 3); s.push({ t: set(al.slice(0, i) + al[i + 1] + al[i] + al.slice(i + 2)), kind: "Arabic: two letters swapped in the surname" }); }
    const j = [...al].findIndex((c) => LOOK[c]);
    if (j >= 0 && al.length >= 4) s.push({ t: set(al.slice(0, j) + LOOK[al[j]] + al.slice(j + 1)), kind: "Arabic: a look-alike letter in the surname" });
    s.push({ t: name.replace(/ا/g, "أ"), kind: "Arabic: alef with a hamza where there was none" });
    s.push({ t: name.replace(/ي/g, "ى").replace(/ه/g, "ة"), kind: "Arabic: ya and ta marbuta variants" });
    return s;
  };
  targets.forEach((b, n) => {
    const name = ar[b.name];
    if (!name || (lastCount.get(strip(b.name).toLowerCase().split(" ").slice(-1)[0]) ?? 0) > 8) return;
    out.push({ q: fmt(AR_SINGLE[pick(AR_SINGLE.length)], name), tool: "fighter", names: [b.name], kind: "Arabic: the name as written (control)", group: "C", ar: true });
    for (const s of arSlips(name)) out.push({ q: fmt(AR_SINGLE[pick(AR_SINGLE.length)], s.t), tool: "fighter", names: [b.name], kind: s.kind, group: "C", ar: true });
    const o = targets[(n + 1) % targets.length], on = ar[o.name];
    if (on && o.id !== b.id) { const a = arSlips(name), c = arSlips(on); out.push({ q: fmt(AR_PAIR[pick(AR_PAIR.length)], a[pick(a.length)].t, c[pick(c.length)].t), tool: "head_to_head", names: [b.name, o.name], kind: "Arabic: two fighters, each with a slip", group: "C", ar: true }); }
  });

  // names that are nobody's: the right answer is that nobody was named, not the nearest fighter
  for (const g of ["Zebulon Quackenbush", "Ignatius Fothergill", "Wilhelmina Strudwick", "Osvaldo Pemberthwaite", "Quentin Oyelaran", "Ysolde Marchetti-Vane", "Bartholomew Nkemelu", "Thaddeus Grimsditch"]) {
    for (const t of [...SINGLE.slice(0, 4), PAIR[0]]) out.push({ q: fmt(t, g, "Zebulon Quackenbush"), tool: null, names: [], kind: "a name that is nobody's", group: "N" });
  }
  return out;
}

/**
 * Plans the question with the rule-based planner, runs its first call, and says what is wrong with the outcome (null when it is right): the wrong tool, or a
 * name missing from what the tool found. A `tool: null` case is right only if the planner names no one.
 */
export async function judge(w: World, c: NameCase, ar: Names = {}): Promise<string | null> {
  const { planByRules } = await import("../lib/ask/rules");
  const { toolByName } = await import("../lib/ask/tools");
  const { tEn } = await import("../lib/i18n/t");
  const calls = planByRules(c.q, w, c.ar ? ar : {});
  const first = calls[0];
  const NAMING = new Set(["fighter", "head_to_head"]);
  if (c.tool === null) {
    if (!first) return null;
    const named = NAMING.has(first.tool) || (first.tool === "trainers" && !!first.args.name);
    return named ? `named someone: ${first.tool}${JSON.stringify(first.args)}` : null;
  }
  if (!first) return `no tool; wanted ${c.tool}`;
  if (first.tool !== c.tool) return `${first.tool}${JSON.stringify(first.args)}; wanted ${c.tool}`;
  const res = toolByName(first.tool)!.run({ w, t: tEn, names: {} }, first.args);
  const text = [res.summary, ...res.lines, ...res.tables.flatMap((t) => [t.title, ...t.rows.flat().map((x) => (typeof x === "string" ? x : x.text))])].join(" | ");
  const missing = c.names.filter((n) => !text.includes(n));
  return missing.length ? `${first.tool}${JSON.stringify(first.args)} does not show ${missing.join(", ")}` : null;
}
