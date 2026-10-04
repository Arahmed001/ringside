import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoxer, miniFeed, tempDb } from "./helpers";

/**
 * Names the way a real league has them, which the generated demo league has none of: letters that do not fold by accent (Ł, Ø, Đ, ı, ß), an apostrophe,
 * a suffix (Jr., III), a middle name, a particle (van der, dos, De La, bin). Each is found by the palette's search and read by the Ask planner when it is
 * typed the way a fan types it. A variant is only guessed at when it points to one fighter: "Jose Castillo" is nobody's when two fighters share it.
 */
const cleanup = tempDb("real-names");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-rn-"));
after(() => { cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

const NAMES = [
  "Łukasz Różański", "Søren Østergaard", "Đorđe Petrović", "Mehmet Yıldız", "Jürgen Weiß", "Lê Văn Đức", "Conor O'Brien", "Dennis D'Amato",
  "Roy Jones Jr.", "Eddie Hearn III", "Carlos Sanchez Sr.", "Maria Elena Garcia", "Jose Luis Castillo", "Jose Antonio Castillo",
  "Sven van der Berg", "Maria dos Santos", "Oscar De La Fuente", "Karim bin Hassan", "Rakan Al-Qahtani", "Anthony Joshua", "Jean-Pierre Fournier",
];

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let search: typeof import("../lib/fighter-search").searchFighters;
let plan: typeof import("../lib/ask/rules").planByRules;
const NO_NAMES = {};

before(async () => {
  const feed = miniFeed();
  feed.boxers = NAMES.map((n, i) => makeBoxer(`x${i}`, "Lightweight", { name: n }));
  feed.bouts = []; feed.weighIns = []; feed.scorecards = []; feed.officials = []; feed.corners = []; feed.punches = []; feed.stints = [];
  const file = path.join(dir, "feed.json");
  fs.writeFileSync(file, JSON.stringify(feed));
  process.env.BOXING_PROVIDER = "file"; process.env.BOXING_FILE = file;
  w = await (await import("../lib/world")).getWorld();
  search = (await import("../lib/fighter-search")).searchFighters;
  plan = (await import("../lib/ask/rules")).planByRules;
});

/** [what is typed, who is meant] */
const BOTH: [string, string][] = [
  ["lukasz rozanski", "Łukasz Różański"], ["Soren Ostergaard", "Søren Østergaard"], ["dorde petrovic", "Đorđe Petrović"], ["mehmet yildiz", "Mehmet Yıldız"], ["Jurgen Weiss", "Jürgen Weiß"],
  ["Le Van Duc", "Lê Văn Đức"], ["Conor OBrien", "Conor O'Brien"], ["Conor O’Brien", "Conor O'Brien"], ["dennis damato", "Dennis D'Amato"],
  ["Roy Jones Junior", "Roy Jones Jr."], ["Roy Jones", "Roy Jones Jr."], ["Eddie Hearn 3rd", "Eddie Hearn III"], ["Eddie Hearn", "Eddie Hearn III"], ["Carlos Sanchez Senior", "Carlos Sanchez Sr."],
  ["Sven vanderberg", "Sven van der Berg"], ["Oscar delafuente", "Oscar De La Fuente"], ["Jean Pierre Fournier", "Jean-Pierre Fournier"], ["Rakan Alqahtani", "Rakan Al-Qahtani"],
];
/** read by the Ask planner (the palette finds these by any word anyway): a middle name or a particle left out */
const ASK_ONLY: [string, string][] = [["Maria Garcia", "Maria Elena Garcia"], ["Sven Berg", "Sven van der Berg"], ["Maria Santos", "Maria dos Santos"], ["Oscar Fuente", "Oscar De La Fuente"], ["Karim Hassan", "Karim bin Hassan"]];

test("the palette's search finds each name as a fan types it", () => {
  const bad = BOTH.filter(([typed, name]) => !search(w, typed, { limit: 8, names: NO_NAMES }).some((b) => b.name === name)).map(([t, n]) => `"${t}" does not find ${n}`);
  assert.deepEqual(bad, []);
});

test("the Ask planner reads each name as a fan types it, from the question alone", () => {
  const bad = [...BOTH, ...ASK_ONLY].flatMap(([typed, name]) => {
    const c = plan(`tell me about ${typed}`, w, NO_NAMES)[0];
    return c && c.tool === "fighter" && c.args.name === name ? [] : [`"${typed}" -> ${c ? c.tool + JSON.stringify(c.args) : "none"}, wanted ${name}`];
  });
  assert.deepEqual(bad, []);
  const pair = plan("Roy Jones vs Eddie Hearn", w, NO_NAMES)[0];
  assert.deepEqual([pair?.tool, pair?.args.a, pair?.args.b], ["head_to_head", "Roy Jones Jr.", "Eddie Hearn III"], "two names with a suffix left off are a head to head");
});

test("a variant that could be two fighters is nobody's, and the full names still work", () => {
  assert.equal(plan("tell me about Jose Castillo", w, NO_NAMES).length, 0, "Jose Luis and Jose Antonio Castillo both shorten to it");
  assert.equal(plan("tell me about Jose Luis Castillo", w, NO_NAMES)[0].args.name, "Jose Luis Castillo");
  assert.equal(plan("tell me about Jose Antonio Castillo", w, NO_NAMES)[0].args.name, "Jose Antonio Castillo");
  // a first name or a surname alone is still not a name
  for (const q of ["tell me about Roy", "tell me about Jones", "tell me about Maria", "tell me about Hearn"]) assert.ok(!plan(q, w, NO_NAMES).some((c) => c.tool === "fighter"), q);
});

test("a word like 'senior' or 'junior' in an ordinary question is not read as a fighter's suffix", () => {
  for (const q of ["who are the best junior welterweights", "senior boxers over 35", "junior middleweight rankings", "who is the most dangerous fighter"]) assert.ok(!plan(q, w, NO_NAMES).some((c) => c.tool === "fighter" && c.args.name), q);
});

test("normalize: letters that do not fold by accent, and a suffix as it is written and as it is typed", async () => {
  const { normalize } = await import("../lib/fighter-search");
  assert.equal(normalize("Łódź Đồng Ørn Yıldız Weiß Æther Œuvre Þór Ðor"), "lodz dong orn yildiz weiss aether oeuvre thor dor");
  assert.equal(normalize("Roy Jones Junior and Senior, the 2nd, 3rd and 4th"), "roy jones jr and sr, the ii, iii and iv");
  assert.equal(normalize("juniors seniority 23rd"), "juniors seniority 23rd", "only whole words");
  assert.equal(normalize("Jr."), "jr.", "the written suffix is left as it is");
});

test("name variants: suffix, middle names, particles, particles run on, apostrophe; never the full name, always two words or more", async () => {
  const { nameVariants } = await import("../lib/ask/rules");
  const sorted = (n: string) => nameVariants(n).sort();
  assert.deepEqual(sorted("roy jones jr"), ["roy jones"]);
  assert.deepEqual(sorted("maria elena garcia"), ["maria garcia"]);
  assert.deepEqual(sorted("sven van der berg"), ["sven berg", "sven vanderberg"]);
  assert.deepEqual(sorted("oscar de la fuente"), ["oscar delafuente", "oscar fuente"]);
  assert.deepEqual(sorted("maria elena de la cruz"), ["maria cruz", "maria elena cruz", "maria elena delacruz"], "the particles go, and the middle name stays or goes");
  assert.deepEqual(sorted("conor o'brien"), ["conor obrien"]);
  assert.deepEqual(sorted("conor o’brien"), ["conor obrien"]);
  assert.deepEqual(sorted("carlos sanchez sr"), ["carlos sanchez"]);
  assert.deepEqual(sorted("anthony joshua"), [], "a plain name has no variants");
  assert.deepEqual(sorted("cher"), [], "one word has none");
  for (const n of ["jose luis castillo", "al-qahtani rakan", "kim jr", "van der"]) for (const v of nameVariants(n)) assert.ok(v !== n && v.split(" ").length >= 2, `${n} -> ${v}`);
});

test("a shortened name that is another fighter's full name belongs to that fighter, and a shortened name two fighters share to neither", async () => {
  const { planByRules } = await import("../lib/ask/rules");
  const fake = { boxers: ["Roy Jones", "Roy Jones Jr.", "Roy Lee Jones", "Ada Maria Cole", "Ada Rose Cole", "Bea Rose Cole", "Bea Cole"].map((name, i) => ({ id: i + 1, name, country: "Mexico" })), people: new Map(), roles: new Map(), today: "2026-10-03" } as unknown as World;
  const who = (q: string) => { const c = planByRules(q, fake, NO_NAMES)[0]; return c ? String(c.args.name) : "none"; };
  assert.equal(who("tell me about Roy Jones"), "Roy Jones", "the full name of one, a shortened name of the others");
  assert.equal(who("tell me about Roy Jones Jr"), "Roy Jones Jr.");
  assert.equal(who("tell me about Roy Lee Jones"), "Roy Lee Jones");
  assert.equal(who("tell me about Ada Cole"), "none", "Ada Maria and Ada Rose Cole both shorten to it");
  assert.equal(who("tell me about Ada Rose Cole"), "Ada Rose Cole");
  assert.equal(who("tell me about Bea Cole"), "Bea Cole", "Bea Rose Cole shortens to Bea Cole, which is another fighter's own name");
  assert.equal(who("tell me about Bea Rose Cole"), "Bea Rose Cole");
});
