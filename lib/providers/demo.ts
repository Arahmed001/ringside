import { mulberry32 } from "../prng";
import { demoMoney } from "./demo-money";
import { applyDemoBelts } from "./demo-belts";
import { WEIGHT_CLASSES } from "../types";
import type { Method } from "../types";
import { DIVISIONS } from "../divisions";
import { isRefereeStoppage } from "../methods";
import type {
  DataProvider, ProviderBout, ProviderBoxer, ProviderCorner, ProviderEvent, ProviderOfficial, ProviderOrg, ProviderPerson,
  ProviderPunchLine, ProviderScorecard, ProviderStint, ProviderWeighIn, TeamRole,
} from "./index";
import {
  BODIES, BROADCASTERS, CITIES, CITY_OF, COUNTRIES, FIRST_F, GYM_A, GYM_B, HEIGHT_BASE, NICKS, POOLS, PROMOTIONS, VENUE_CAP, WOMEN_CLASSES, gauss, iso, pick,
} from "./demo-data";

/**
 * A fully fictional boxing league used to develop the app before real data is licensed.
 * It generates every field the real contract supports: fighters, trainers and their career moves,
 * gyms, managers, promoters, officials, weigh-ins, scorecards, knockdowns, odds and punch stats.
 *
 * Some effects are baked in on purpose (a trainer's skill boost, a fight-night weight edge, judges who
 * favour home fighters) so the analytics and model-fitting code has real signal to find. They are
 * properties of this simulator, NOT claims about boxing.
 */

interface Tenure { ext: string; from: number; to: number } // epoch ms; to = Infinity while current
interface TrainerSim { ext: string; name: string; country: string; boost: number; gym: string }
interface JudgeSim { ext: string; name: string; country: string; bias: number }
interface RefSim { ext: string; name: string; country: string; quick: number }

interface Sim {
  ext: string;
  name: string;
  country: string;
  sex: "male" | "female";
  skill: number;
  power: number;
  chin: number;
  vol: number; // punch volume per round
  start: number;
  end: number;
  cls: number;
  jm?: boolean; // journeyman: low-rated opponent who feeds the contenders
  r: number; // live elo for matchmaking
  last: number;
  trainers: Tenure[];
  managers: Tenure[];
  promoters: Tenure[];
  strength: Tenure[];
  rehyd: number; // typical fight-night weight gain, lb
  offset: number; // how far under the limit he usually weighs in
  heavyBase: number; // heavyweights have no limit: their usual scale weight
}

const DAY = 86400000;
const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export interface DemoOptions {
  /** Multiplies the league: fighters, officials, gyms, trainers and cards per month. 1 is the default league the tests use. */
  scale?: number;
}

export function demoProvider(now = new Date(), opts: DemoOptions = {}): DataProvider {
  const scale = Math.max(1, Math.round(opts.scale ?? 1));
  const sqrtScale = Math.ceil(Math.sqrt(scale)); // officials and promotions grow more slowly than fighters
  const rnd = mulberry32(20261003);
  const nowMs = now.getTime();
  const startMs = Date.UTC(2014, 0, 1);

  const boxers: ProviderBoxer[] = [];
  const events: ProviderEvent[] = [];
  const bouts: ProviderBout[] = [];
  const people: ProviderPerson[] = [];
  const orgs: ProviderOrg[] = [];
  const stints: ProviderStint[] = [];
  const weighIns: ProviderWeighIn[] = [];
  const officials: ProviderOfficial[] = [];
  const scorecards: ProviderScorecard[] = [];
  const corners: ProviderCorner[] = [];
  const punches: ProviderPunchLine[] = [];
  const sims: Sim[] = [];

  const usedFighter = new Set<string>();
  const usedPeople = new Set<string>();
  const uniqueName = (country: string, used: Set<string>, sex: "male" | "female" = "male") => {
    const pool = POOLS[country];
    const firsts = sex === "female" ? FIRST_F[country] : pool.first;
    for (let attempt = 0; ; attempt++) {
      // plain name first; then one middle initial; then two, so a very large league can never loop forever
      const initial = () => String.fromCharCode(65 + Math.floor(rnd() * 26));
      const mid = attempt < 25 ? "" : attempt < 200 ? ` ${initial()}.` : ` ${initial()}. ${initial()}.`;
      const name = `${pick(rnd, firsts)}${mid} ${pick(rnd, pool.last)}`;
      if (!used.has(name)) { used.add(name); return name; }
    }
  };

  // ---------- organisations ----------
  const gymNames = new Set<string>();
  const gyms: { ext: string; name: string; country: string }[] = [];
  for (let i = 0; i < 64 * scale; i++) {
    const country = pick(rnd, COUNTRIES);
    let name = "";
    // 16 x 6 name parts give only 96 plain names, so a bigger league needs a fallback: the same name in another city, then a number
    let attempts = 0;
    do name = `${pick(rnd, GYM_A)} ${pick(rnd, GYM_B)}`; while (gymNames.has(name) && ++attempts < 40);
    const city = pick(rnd, CITY_OF[country]);
    if (gymNames.has(name)) name = `${name}, ${city}`;
    for (let n = 2; gymNames.has(name); n++) name = `${name.replace(/ #\d+$/, "")} #${n}`;
    gymNames.add(name);
    const g = { ext: `gym-${i}`, name, country };
    gyms.push(g);
    orgs.push({ externalId: g.ext, name, kind: "gym", country, city });
  }
  const promotions = PROMOTIONS.map((name, i) => {
    const country = pick(rnd, ["United States", "United States", "United Kingdom", "Mexico", "Japan", "Germany", "Saudi Arabia"]);
    orgs.push({ externalId: `promo-${i}`, name, kind: "promotion", country, city: pick(rnd, CITY_OF[country]) });
    return `promo-${i}`;
  });
  for (const b of BODIES) orgs.push({ externalId: b.ext, name: `${b.name} (${b.short})`, kind: "sanctioning_body" });

  // ---------- people ----------
  const trainers: TrainerSim[] = [];
  for (let i = 0; i < 150 * scale; i++) {
    const country = pick(rnd, COUNTRIES);
    const t: TrainerSim = { ext: `tr-${i}`, name: uniqueName(country, usedPeople), country, boost: clamp(gauss(rnd) * 45, -110, 110), gym: gyms[i % gyms.length].ext };
    trainers.push(t);
    people.push({ externalId: t.ext, name: t.name, country });
  }
  const trainerBy = new Map(trainers.map((t) => [t.ext, t]));
  const trainersByCountry = new Map<string, TrainerSim[]>();
  for (const t of trainers) (trainersByCountry.get(t.country) ?? trainersByCountry.set(t.country, []).get(t.country)!).push(t);
  const managers: { ext: string; name: string; country: string }[] = [];
  for (let i = 0; i < 70 * scale; i++) {
    const country = pick(rnd, COUNTRIES);
    const m = { ext: `mg-${i}`, name: uniqueName(country, usedPeople), country };
    managers.push(m);
    people.push({ externalId: m.ext, name: m.name, country });
  }
  const judges: JudgeSim[] = [];
  for (let i = 0; i < 64 * sqrtScale; i++) {
    const country = pick(rnd, COUNTRIES);
    const j: JudgeSim = { ext: `jd-${i}`, name: uniqueName(country, usedPeople), country, bias: clamp(0.025 + gauss(rnd) * 0.035, 0, 0.12) };
    judges.push(j);
    people.push({ externalId: j.ext, name: j.name, country });
  }
  const referees: RefSim[] = [];
  for (let i = 0; i < 40 * sqrtScale; i++) {
    const country = pick(rnd, COUNTRIES);
    const r: RefSim = { ext: `rf-${i}`, name: uniqueName(country, usedPeople), country, quick: gauss(rnd) };
    referees.push(r);
    people.push({ externalId: r.ext, name: r.name, country });
  }

  // ---------- career timelines ----------
  /** Splits [from, to] into k consecutive tenures. `to` of the last one is Infinity while still active. */
  const makeTenures = (from: number, to: number, active: boolean, k: number, choose: (prev: string | null) => string): Tenure[] => {
    const span = Math.max(DAY * 200, Math.min(to, nowMs + DAY * 365) - from);
    const w = Array.from({ length: k }, () => 0.5 + rnd());
    const total = w.reduce((a, b) => a + b, 0);
    const out: Tenure[] = [];
    let cur = from, prev: string | null = null;
    for (let i = 0; i < k; i++) {
      const last = i === k - 1;
      const next = last ? (active ? Infinity : to) : cur + (w[i] / total) * span;
      const ext = choose(prev);
      out.push({ ext, from: cur, to: next });
      prev = ext;
      cur = next;
    }
    return out;
  };
  const tenureAt = (list: Tenure[], t: number) => list.find((x) => x.from <= t && t < x.to) ?? null;
  const toIso = (ms: number) => (ms === Infinity ? null : iso(new Date(ms)));

  const makeFighter = (ci: number, i: number, jm: boolean, sex: "male" | "female" = "male") => {
    const country = pick(rnd, COUNTRIES);
    const name = uniqueName(country, usedFighter, sex);
    const debutYear = jm ? 2010 + Math.floor(rnd() * 15) : 2008 + Math.floor(rnd() * 17);
    const age = 19 + Math.floor(rnd() * (jm ? 6 : 3));
    const birthYear = debutYear - age;
    const height = Math.round(HEIGHT_BASE[ci] - (sex === "female" ? 9 : 0) + gauss(rnd) * 4);
    const reach = Math.round(height + clamp(2 + gauss(rnd) * 5, -8, 14));
    const skill = jm ? -330 + gauss(rnd) * 70 : gauss(rnd) * 190;
    const careerLen = (jm ? 3 + rnd() * 6 : 6 + rnd() * 11) * 365 * DAY;
    const start = Math.max(startMs - 3 * 365 * DAY, Date.UTC(debutYear, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27)));
    const end = start + careerLen;
    const active = end > nowMs;
    const ext = `demo-${ci}-${sex === "female" ? "w" : ""}${jm ? "j" : ""}${i}`;
    const limit = DIVISIONS[ci].lb;

    const kT = jm ? 1 + (rnd() < 0.3 ? 1 : 0) : 1 + (rnd() < 0.5 ? 1 : 0) + (rnd() < 0.22 ? 1 : 0) + (rnd() < 0.08 ? 1 : 0);
    const trainerPick = (prev: string | null) => {
      for (let n = 0; n < 12; n++) {
        const local = trainersByCountry.get(country) ?? [];
        const t = rnd() < 0.55 && local.length ? pick(rnd, local) : pick(rnd, trainers);
        if (t.ext !== prev) return t.ext;
      }
      return pick(rnd, trainers).ext;
    };
    const sim: Sim = {
      ext, name, country, skill, jm, sex,
      power: jm ? 0.1 + rnd() * 0.25 : clamp(0.3 + ci * 0.022 + gauss(rnd) * 0.18, 0.05, 0.9),
      chin: jm ? 0.2 + rnd() * 0.25 : clamp(0.5 + gauss(rnd) * 0.18, 0.1, 0.9),
      vol: 38 + rnd() * 40,
      start, end, cls: ci, r: 1500, last: 0,
      trainers: makeTenures(start, end, active, kT, trainerPick),
      managers: makeTenures(start, end, active, 1 + (rnd() < 0.3 ? 1 : 0), () => pick(rnd, managers).ext),
      promoters: makeTenures(start, end, active, 1 + (rnd() < 0.45 ? 1 : 0) + (rnd() < 0.15 ? 1 : 0), (prev) => { let p = pick(rnd, promotions); if (p === prev) p = pick(rnd, promotions); return p; }),
      strength: rnd() < 0.4 ? makeTenures(start + 200 * DAY, end, active, 1, () => pick(rnd, trainers).ext) : [],
      rehyd: limit ? 0.05 * limit * (0.5 + rnd() * 1.2) : 4 + rnd() * 3,
      offset: rnd() * 0.9,
      heavyBase: limit ? 0 : 218 + rnd() * 40,
    };
    sims.push(sim);

    const birthMonth = 1 + Math.floor(rnd() * 12), birthDay = 1 + Math.floor(rnd() * 28);
    const birthDate = `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`;
    const nick = rnd() < (jm ? 0.12 : 0.55) ? pick(rnd, NICKS) : undefined;
    boxers.push({
      externalId: ext, name, nickname: nick, country, birthYear, birthDate,
      birthPlace: `${pick(rnd, CITY_OF[country])}, ${country}`,
      residence: rnd() < 0.7 ? `${pick(rnd, CITY_OF[country])}, ${country}` : `${pick(rnd, CITY_OF["United States"])}, United States`,
      aliases: rnd() < 0.12 ? [`${name.split(" ")[0][0]}. ${name.split(" ").slice(-1)[0]}`] : undefined,
      sex, stance: ((st) => (st < 0.18 ? "Southpaw" : st < 0.22 ? "Switch" : "Orthodox") as "Southpaw" | "Switch" | "Orthodox")(rnd()), heightCm: height, reachCm: reach, weightClass: WEIGHT_CLASSES[ci],
      turnedPro: new Date(start).getUTCFullYear(), debutDate: iso(new Date(start)),
      retiredDate: active ? undefined : iso(new Date(end)), active,
    });

    // team history
    const push = (role: TeamRole, list: Tenure[], kind: "person" | "org") => {
      for (const t of list) stints.push({
        boxerExternalId: ext, role, start: iso(new Date(t.from)), end: toIso(t.to), source: "demo",
        ...(kind === "person" ? { personExternalId: t.ext } : { orgExternalId: t.ext }),
      });
    };
    push("head_trainer", sim.trainers, "person");
    push("strength_coach", sim.strength, "person");
    push("manager", sim.managers, "person");
    push("promoter", sim.promoters, "org");
    // gym follows the head trainer; merge neighbouring tenures at the same gym
    let prevGym: string | null = null, gymFrom = 0;
    sim.trainers.forEach((t, idx) => {
      const gym = trainerBy.get(t.ext)!.gym;
      if (gym !== prevGym) {
        if (prevGym) stints.push({ boxerExternalId: ext, role: "gym", orgExternalId: prevGym, start: iso(new Date(gymFrom)), end: iso(new Date(t.from)), source: "demo" });
        prevGym = gym; gymFrom = t.from;
      }
      if (idx === sim.trainers.length - 1 && prevGym) stints.push({ boxerExternalId: ext, role: "gym", orgExternalId: prevGym, start: iso(new Date(gymFrom)), end: toIso(t.to), source: "demo" });
    });
  };

  const STARS = 22 * scale;
  WEIGHT_CLASSES.forEach((_, ci) => { for (let i = 0; i < STARS + 22 * scale; i++) makeFighter(ci, i, i >= STARS); });
  // women's roster: a smaller pool in flyweight through super middleweight
  WEIGHT_CLASSES.forEach((_, ci) => { if (WOMEN_CLASSES.has(ci)) for (let i = 0; i < 20 * scale; i++) makeFighter(ci, i, i >= 10 * scale, "female"); });
  const simBy = new Map(sims.map((s) => [s.ext, s]));

  // ---------- bout simulation ----------
  const trainerBoost = (s: Sim, t: number) => { const tn = tenureAt(s.trainers, t); return tn ? trainerBy.get(tn.ext)!.boost : 0; };

  const weighInFor = (s: Sim, limit: number | null) => {
    let official: number, made = true;
    if (limit === null) official = round1(s.heavyBase + gauss(rnd) * 2.2);
    else if (rnd() < 0.045) { official = round1(limit + 0.2 + rnd() * 3.4); made = false; }
    else official = round1(limit - clamp(s.offset + gauss(rnd) * 0.5, 0, 3));
    const gain = Math.max(1.2, s.rehyd + gauss(rnd) * 1.6);
    return { official, fightNight: round1(official + gain), made };
  };

  const scoreRounds = (rounds: number, redQ: number, kdRed: Set<number>, kdBlue: Set<number>) => {
    let red = 0, blue = 0;
    for (let r = 1; r <= rounds; r++) {
      if (rnd() < 0.02 && !kdRed.has(r) && !kdBlue.has(r)) { red += 10; blue += 10; continue; }
      const redWins = rnd() < redQ;
      const win = 10, lose = (redWins ? kdRed.has(r) : kdBlue.has(r)) ? 8 : 9;
      if (redWins) { red += win; blue += lose; } else { red += lose; blue += win; }
    }
    return { red, blue };
  };
  /** One judge's card forced to favour 'red', 'blue' or 'even' (rejection sampling, with a small fallback). */
  const judgeCard = (rounds: number, target: "red" | "blue" | "even", close: boolean, kdRed: Set<number>, kdBlue: Set<number>) => {
    // q is the chance the favoured fighter wins a round: ~0.55-0.72 gives typical 115-113 to 117-111 cards
    const margin = close ? 0.01 + rnd() * 0.05 : 0.05 + rnd() * 0.17;
    const q = target === "red" ? 0.5 + margin : target === "blue" ? 0.5 - margin : 0.5;
    for (let n = 0; n < 60; n++) {
      const c = scoreRounds(rounds, q, kdRed, kdBlue);
      if (target === "red" && c.red > c.blue) return c;
      if (target === "blue" && c.blue > c.red) return c;
      if (target === "even" && c.red === c.blue) return c;
    }
    const c = scoreRounds(rounds, q, kdRed, kdBlue);
    if (target === "red" && c.red <= c.blue) c.red = c.blue + 1;
    if (target === "blue" && c.blue <= c.red) c.blue = c.red + 1;
    if (target === "even") c.blue = c.red;
    return c;
  };

  const kdSet = (n: number, rounds: number) => { const s = new Set<number>(); for (let i = 0; i < n; i++) s.add(1 + Math.floor(rnd() * rounds)); return s; };

  interface Card { red: Sim; blue: Sim; wc: number }

  const simulateBout = (c: Card, evExt: string, idx: number, t: number, headline: boolean, eventCountry: string, results: boolean) => {
    const { red, blue, wc } = c;
    const ext = `${evExt}-b${idx}`;
    const limitStd = DIVISIONS[wc].lb;
    const catchwt = limitStd !== null && rnd() < 0.04;
    const contractLb = catchwt ? limitStd + pick(rnd, [-2, 2, 3, 4, 5]) : undefined;
    const limit = contractLb ?? limitStd;
    const rounds = headline ? 12 : rnd() < 0.5 ? 10 : 8;

    const wr = results ? weighInFor(red, limit) : null, wb = results ? weighInFor(blue, limit) : null;
    const weightEdge = wr && wb ? clamp((wr.fightNight - wb.fightNight) * 2.2, -35, 35) : 0;
    const diff = (red.skill + trainerBoost(red, t)) - (blue.skill + trainerBoost(blue, t)) + weightEdge;
    const pRed = 1 / (1 + Math.pow(10, -diff / 400));

    const bookP = clamp(pRed + gauss(rnd) * 0.04, 0.04, 0.96);
    const oddsRed = Math.max(1.01, round2(1 / (bookP * 1.025))), oddsBlue = Math.max(1.01, round2(1 / ((1 - bookP) * 1.025)));

    const ref = pick(rnd, referees);
    const js = shuffle(judges).slice(0, 3);
    const homeR = red.country === eventCountry, homeB = blue.country === eventCountry;

    let winner: Sim | null = null;
    let method: Method | null = null;
    let endRound: number | null = null;
    let roundTime: string | undefined;
    let kdRed = 0, kdBlue = 0;
    const cardRows: ProviderScorecard[] = [];

    const stopTime = () => `${Math.floor(rnd() * 3)}:${String(5 + Math.floor(rnd() * 54)).padStart(2, "0")}`;
    if (results) {
      // unusual endings first: no contest, technical draw, technical decision (a cut stops it and the cards decide)
      const u0 = rnd();
      if (u0 < 0.004) { method = "NC"; endRound = 1 + Math.floor(rnd() * Math.min(4, rounds - 1)); roundTime = stopTime(); }
      else if (u0 < 0.007) { method = "TDRAW"; endRound = 4 + Math.floor(rnd() * Math.min(4, rounds - 4)); roundTime = stopTime(); }
      else if (u0 < 0.018) { winner = rnd() < pRed ? red : blue; method = "TD"; endRound = 4 + Math.floor(rnd() * Math.min(5, rounds - 4)); roundTime = stopTime(); }
      else if (u0 < 0.053) { method = "DRAW"; }
      else {
        const redWins = rnd() < pRed;
        winner = redWins ? red : blue;
        const loser = redWins ? blue : red;
        const finishP = Math.min(0.88, 0.15 + winner.power * 0.7 * (1.15 - loser.chin * 0.7));
        if (rnd() < 0.006) { method = "DQ"; endRound = 1 + Math.floor(rnd() * (rounds - 1)); roundTime = stopTime(); }
        else if (rnd() < finishP) {
          const m = rnd();
          method = m < 0.5 ? "KO" : m < 0.92 ? "TKO" : "RTD";
          endRound = 1 + Math.min(rounds - 1, Math.floor(-Math.log(1 - rnd()) * 3.2));
          if (method !== "RTD" && ref.quick > 0.8 && endRound > 1) endRound -= 1;
          const kd = method === "KO" ? 1 + (rnd() < 0.35 ? 1 : 0) : method === "RTD" ? (rnd() < 0.3 ? 1 : 0) : rnd() < 0.5 ? 0 : 1 + (rnd() < 0.25 ? 1 : 0);
          if (redWins) kdBlue = kd; else kdRed = kd;
          roundTime = method === "RTD" ? "3:00" : stopTime(); // a corner retires between rounds
        }
      }
      if (!method || method === "DRAW" || method === "TD" || method === "TDRAW") {
        const technical = method === "TD" || method === "TDRAW";
        const cardRounds = technical ? endRound! : rounds;
        if (!technical) { endRound = rounds; roundTime = "3:00"; }
        if (!technical && rnd() < 0.14) { if (rnd() < 0.8 && winner) { if (winner === red) kdBlue = 1; else kdRed = 1; } else if (rnd() < 0.5) kdRed = 1; else kdBlue = 1; }
        const kdR = kdSet(kdRed, cardRounds), kdB = kdSet(kdBlue, cardRounds);
        const drawLike = method === "DRAW" || method === "TDRAW";
        const sides = (target: ("red" | "blue" | "even")[], closeIdx: number) => target.map((tg, i) => judgeCard(cardRounds, tg, drawLike && closeIdx === -1 ? true : i === closeIdx || tg === "even", kdR, kdB));
        let cards: { red: number; blue: number }[];
        if (drawLike) {
          const pattern = rnd();
          // a draw is a close fight: every card is close
          if (pattern < 0.4) cards = sides(["even", "even", "even"], -1);
          else if (pattern < 0.75) cards = sides(shuffle(["even", "even", rnd() < 0.5 ? "red" : "blue"] as const), -1);
          else cards = sides(shuffle(["red", "blue", "even"] as const), -1);
        } else if (method === "TD") {
          const W: "red" | "blue" = winner === red ? "red" : "blue";
          cards = sides([W, W, W], -1);
        } else {
          const W: "red" | "blue" = winner === red ? "red" : "blue", L: "red" | "blue" = W === "red" ? "blue" : "red";
          const loserHome = winner === red ? homeB : homeR, winnerHome = winner === red ? homeR : homeB;
          const homeFactor = (loserHome ? 1 : 0) - (winnerHome ? 1 : 0);
          const m = rnd();
          const udP = loserHome ? 0.7 : winnerHome ? 0.81 : 0.78, sdP = loserHome ? 0.22 : winnerHome ? 0.13 : 0.15;
          method = m < udP ? "UD" : m < udP + sdP ? "SD" : "MD";
          if (method === "UD") cards = sides([W, W, W], -1);
          else if (method === "MD") { const d = Math.floor(rnd() * 3); cards = sides([0, 1, 2].map((k) => (k === d ? "even" : W)) as ("red" | "blue" | "even")[], d); }
          else {
            const wts = js.map((j) => 1 + 25 * Math.max(0, j.bias * homeFactor));
            let u = rnd() * wts.reduce((a, b) => a + b, 0), d = 0;
            for (; d < 2; d++) { u -= wts[d]; if (u <= 0) break; }
            cards = sides([0, 1, 2].map((k) => (k === d ? L : W)) as ("red" | "blue" | "even")[], d);
          }
        }
        cards.forEach((cd, k) => cardRows.push({ boutExternalId: ext, judgeExternalId: js[k].ext, seat: k + 1, red: cd.red, blue: cd.blue }));
      }
    }

    // elo bookkeeping for matchmaking
    if (results && method !== "NC") {
      const sA = winner === red ? 1 : winner === blue ? 0 : 0.5;
      const eA = 1 / (1 + Math.pow(10, (blue.r - red.r) / 400));
      red.r += 24 * (sA - eA); blue.r += 24 * (1 - sA - (1 - eA));
    }

    return { ext, rounds, winner, method, endRound, roundTime, kdRed, kdBlue, oddsRed, oddsBlue, contractLb, limit, wr, wb, ref, js, cardRows, pRed };
  };

  const round2 = (x: number) => Math.round(x * 100) / 100;
  function shuffle<T>(a: readonly T[]): T[] { const o = [...a]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; }

  const punchStats = (boutExt: string, o: ReturnType<typeof simulateBout>, red: Sim, blue: Sim, t: number) => {
    const end = o.endRound ?? o.rounds;
    for (const [side, s, opp] of [["red", red, blue], ["blue", blue, red]] as const) {
      const tot = { thrown: 0, landed: 0, pt: 0, pl: 0, jt: 0, jl: 0 };
      const edge = ((s.skill + trainerBoost(s, t)) - (opp.skill + trainerBoost(opp, t))) / 1700;
      for (let r = 1; r <= end; r++) {
        const frac = r === end && (isRefereeStoppage(o.method) || o.method === "DQ" || o.method === "NC") ? 0.6 : 1;
        const thrown = Math.max(6, Math.round(s.vol * (0.8 + rnd() * 0.4) * frac));
        // real pro accuracy sits around 20-45%; a big skill gap moves it by a few points, not tens
        const landed = Math.min(thrown, Math.max(1, Math.round(thrown * clamp(0.28 + edge * 0.3 + gauss(rnd) * 0.04, 0.12, 0.5))));
        const pt = Math.round(thrown * (0.3 + s.power * 0.25));
        const pl = Math.min(landed, Math.round(pt * clamp(0.38 + edge * 0.3 + gauss(rnd) * 0.05, 0.15, 0.62)));
        const jt = thrown - pt, jl = Math.max(0, landed - pl);
        punches.push({ boutExternalId: boutExt, boxerExternalId: s.ext, round: r, thrown, landed, powerThrown: pt, powerLanded: pl, jabThrown: jt, jabLanded: Math.min(jt, jl) });
        tot.thrown += thrown; tot.landed += landed; tot.pt += pt; tot.pl += pl; tot.jt += jt; tot.jl += Math.min(jt, jl);
      }
      punches.push({ boutExternalId: boutExt, boxerExternalId: s.ext, round: 0, thrown: tot.thrown, landed: tot.landed, powerThrown: tot.pt, powerLanded: tot.pl, jabThrown: tot.jt, jabLanded: tot.jl });
      void side;
    }
  };

  const groups = new Map<string, Sim[]>(); // fighters by division and sex, in creation order
  for (const s of sims) (groups.get(`${s.cls}|${s.sex}`) ?? groups.set(`${s.cls}|${s.sex}`, []).get(`${s.cls}|${s.sex}`)!).push(s);
  const eligible = (cls: number, sex: "male" | "female", t: number, minRest: number) =>
    (groups.get(`${cls}|${sex}`) ?? []).filter((s) => s.start <= t && s.end > t && t - s.last > minRest);

  const BELT = ["World Title", "Interim World Title", "Continental Title"];
  const titleFor = (headline: boolean) => {
    if (!headline || rnd() >= 0.55) return null;
    const title = pick(rnd, BELT);
    return { title, org: title === "Continental Title" ? "body-pcbu" : pick(rnd, ["body-gbc", "body-ira", "body-wpa"]), vacant: rnd() < 0.12 };
  };

  const eventByExt = new Map<string, ProviderEvent>();
  const makeEvent = (date: Date) => {
    const [city, country, venue] = pick(rnd, CITIES);
    const ext = `demo-ev-${events.length}`;
    const ev: ProviderEvent = {
      externalId: ext, name: "", date: iso(date), venue, city, country,
      broadcaster: pick(rnd, BROADCASTERS),
      attendance: Math.round((VENUE_CAP[venue] ?? 9000) * (0.45 + rnd() * 0.55)),
    };
    events.push(ev);
    eventByExt.set(ext, ev);
    return { ext, country };
  };

  const finalizeEvent = (evExt: string, mainCard: Card | undefined, t: number) => {
    const ev = eventByExt.get(evExt)!;
    if (mainCard) {
      ev.name = `${mainCard.red.name.split(" ").slice(-1)[0]} vs ${mainCard.blue.name.split(" ").slice(-1)[0]}`;
      const pr = tenureAt(mainCard.red.promoters, t) ?? tenureAt(mainCard.blue.promoters, t);
      ev.promoterExternalId = pr?.ext ?? pick(rnd, promotions);
    } else ev.name = "Fight Night";
  };

  const buildCards = (classes: number[], t: number, taken: Set<string>): Card[] => {
    const cards: Card[] = [];
    for (const cls of classes) for (const sex of ["male", "female"] as const) {
      if (sex === "female" && !(WOMEN_CLASSES.has(cls) && rnd() < 0.55)) continue;
      const pool = eligible(cls, sex, t, 40 * DAY).filter((s) => !taken.has(s.ext));
      const stars = pool.filter((s) => !s.jm);
      const jms = pool.filter((s) => s.jm);
      const pairsHere = sex === "male" && stars.length >= 4 && rnd() < 0.5 ? 2 : 1;
      for (let p = 0; p < pairsHere; p++) {
        let a: Sim | undefined, b: Sim | undefined;
        if (jms.length >= 2 && rnd() < 0.15) {
          a = jms.splice(Math.floor(rnd() * jms.length), 1)[0];
          b = jms.splice(Math.floor(rnd() * jms.length), 1)[0];
        } else if (stars.length) {
          a = stars.splice(Math.floor(rnd() * stars.length), 1)[0];
          if (jms.length && rnd() < 0.55) b = jms.splice(Math.floor(rnd() * jms.length), 1)[0];
          else if (stars.length) {
            const near = [...stars].sort((x, y) => Math.abs(x.r - a!.r) - Math.abs(y.r - a!.r)).slice(0, 3);
            b = near[Math.floor(rnd() * near.length)];
            stars.splice(stars.indexOf(b), 1);
          } else if (jms.length) b = jms.splice(Math.floor(rnd() * jms.length), 1)[0];
        }
        if (!a || !b) continue;
        taken.add(a.ext); taken.add(b.ext);
        const redFirst = rnd() < 0.5;
        cards.push({ red: redFirst ? a : b, blue: redFirst ? b : a, wc: cls });
      }
    }
    return cards.sort((x, y) => x.red.r + x.blue.r - (y.red.r + y.blue.r));
  };

  // ---------- past events (~4 a month) ----------
  const cursor = new Date(startMs);
  while (cursor.getTime() < nowMs - 3 * DAY) {
    for (let e = 0; e < 4 * scale; e++) {
      const d = new Date(cursor.getTime() + ((e % 4) * 7 + 2 + Math.floor(rnd() * 5)) * DAY);
      if (d.getTime() > nowMs - 3 * DAY) continue;
      const t = d.getTime();
      const { ext: evExt, country } = makeEvent(d);
      const boutsBefore = bouts.length;
      const evCancelled = rnd() < 0.008; // a card that never happened
      if (evCancelled) events[events.length - 1].status = "cancelled";
      const classes = shuffle([...Array(WEIGHT_CLASSES.length).keys()]).slice(0, 6 + Math.floor(rnd() * 3));
      const cards = buildCards(classes, t, new Set<string>());
      cards.forEach((c, idx) => {
        const main = idx === cards.length - 1;
        if (evCancelled || (!main && rnd() < 0.025)) { // fell off the card: no result, no weigh-in, no effect on either fighter
          bouts.push({ externalId: `${evExt}-b${idx}`, eventExternalId: evExt, redExternalId: c.red.ext, blueExternalId: c.blue.ext, weightClass: WEIGHT_CLASSES[c.wc],
            rounds: main ? 12 : 10, winnerExternalId: null, method: null, endRound: null, title: null, position: idx, status: "cancelled" });
          return;
        }
        const o = simulateBout(c, evExt, idx, t, main, country, true);
        c.red.last = t; c.blue.last = t;
        const ti = titleFor(main);
        bouts.push({
          externalId: o.ext, eventExternalId: evExt, redExternalId: c.red.ext, blueExternalId: c.blue.ext, weightClass: WEIGHT_CLASSES[c.wc],
          rounds: o.rounds, winnerExternalId: o.winner?.ext ?? null, method: o.method, endRound: o.endRound, title: ti?.title ?? null, position: idx,
          roundTime: o.roundTime, kdRed: o.kdRed, kdBlue: o.kdBlue, oddsRed: o.oddsRed, oddsBlue: o.oddsBlue, contractLb: o.contractLb,
          titleOrgExternalId: ti?.org, titleVacant: ti?.vacant,
        });
        for (const [s, w] of [[c.red, o.wr], [c.blue, o.wb]] as const) if (w) {
          weighIns.push({ boutExternalId: o.ext, boxerExternalId: s.ext, officialLb: w.official, fightNightLb: w.fightNight, limitLb: o.limit, madeWeight: w.made, source: "demo" });
          const tn = tenureAt(s.trainers, t);
          if (tn) corners.push({ boutExternalId: o.ext, boxerExternalId: s.ext, role: "head_trainer", personExternalId: tn.ext });
        }
        officials.push({ boutExternalId: o.ext, role: "referee", personExternalId: o.ref.ext });
        o.js.forEach((j, k) => officials.push({ boutExternalId: o.ext, role: "judge", personExternalId: j.ext, seat: k + 1 }));
        scorecards.push(...o.cardRows);
        if (rnd() < 0.45) punchStats(o.ext, o, c.red, c.blue, t);
      });
      finalizeEvent(evExt, cards[cards.length - 1], t);
      if (bouts.length === boutsBefore) events.pop(); // a card nobody could be found for
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  // ---------- upcoming: 6 cards over ~10 weeks, each fighter booked at most once ----------
  const booked = new Set<string>();
  const upcomingCards = 6 * sqrtScale;
  for (let e = 0; e < upcomingCards; e++) {
    const d = new Date(nowMs + (6 + (e % 6) * 11 + Math.floor(rnd() * 4)) * DAY);
    const t = d.getTime();
    const { ext: evExt, country } = makeEvent(d);
    const evStatus = e === 4 ? "postponed" : e === 5 ? "cancelled" : undefined; // exercise the calendar states
    if (evStatus) events[events.length - 1].status = evStatus;
    const taken = new Set<string>();
    const cards: Card[] = [];
    for (const cls of shuffle([...Array(WEIGHT_CLASSES.length).keys()]).slice(0, 7)) for (const sex of ["male", "female"] as const) {
      if (sex === "female" && !(WOMEN_CLASSES.has(cls) && rnd() < 0.4)) continue;
      const pool = (groups.get(`${cls}|${sex}`) ?? []).filter((s) => !s.jm && s.end > t && s.start < nowMs - 400 * DAY && !taken.has(s.ext) && !booked.has(s.ext))
        .sort((x, y) => y.r - x.r).slice(0, 8);
      if (pool.length < 2) continue;
      const a = pool.splice(Math.floor(rnd() * Math.min(3, pool.length)), 1)[0];
      const b = pool.splice(Math.floor(rnd() * Math.min(3, pool.length)), 1)[0];
      if (!a || !b) continue;
      taken.add(a.ext); taken.add(b.ext); if (evStatus !== "cancelled") { booked.add(a.ext); booked.add(b.ext); }
      const redFirst = rnd() < 0.5;
      cards.push({ red: redFirst ? a : b, blue: redFirst ? b : a, wc: cls });
    }
    cards.sort((x, y) => x.red.r + x.blue.r - (y.red.r + y.blue.r));
    cards.forEach((c, idx) => {
      const main = idx === cards.length - 1;
      if (evStatus === "cancelled") {
        bouts.push({ externalId: `${evExt}-b${idx}`, eventExternalId: evExt, redExternalId: c.red.ext, blueExternalId: c.blue.ext, weightClass: WEIGHT_CLASSES[c.wc], rounds: main ? 12 : 10, winnerExternalId: null, method: null, endRound: null, title: null, position: idx, status: "cancelled" });
        return;
      }
      const o = simulateBout(c, evExt, idx, t, main, country, false);
      const ti = main ? { title: pick(rnd, BELT), org: pick(rnd, ["body-gbc", "body-ira", "body-wpa"]), vacant: false } : null;
      bouts.push({
        externalId: o.ext, eventExternalId: evExt, redExternalId: c.red.ext, blueExternalId: c.blue.ext, weightClass: WEIGHT_CLASSES[c.wc],
        rounds: main ? 12 : 10, winnerExternalId: null, method: null, endRound: null, title: ti?.title ?? null, position: idx,
        oddsRed: o.oddsRed, oddsBlue: o.oddsBlue, contractLb: o.contractLb, titleOrgExternalId: ti?.org, titleVacant: ti?.vacant,
      });
      for (const s of [c.red, c.blue]) {
        const tn = tenureAt(s.trainers, t);
        if (tn) corners.push({ boutExternalId: o.ext, boxerExternalId: s.ext, role: "head_trainer", personExternalId: tn.ext });
      }
    });
    finalizeEvent(evExt, cards[cards.length - 1], t);
  }
  void simBy;

  // belts come from their own random stream, once every result exists; they relabel title fights and never touch a result
  applyDemoBelts(events, bouts, boxers, now);

  // money comes from its own random stream, after everything else, so the league itself is unchanged by it
  let money: ReturnType<typeof demoMoney> | undefined;
  const getMoney = () => (money ??= demoMoney(events, bouts, now));
  const moneyFetchers = {
    fetchFinancials: async () => getMoney().financials,
    fetchPurses: async () => getMoney().purses,
    fetchBroadcasts: async () => getMoney().broadcasts,
    fetchEarnings: async () => getMoney().earnings,
  };
  return {
    name: "demo",
    fetchBoxers: async () => boxers,
    fetchEvents: async () => events,
    fetchBouts: async () => bouts,
    fetchPeople: async () => people,
    fetchOrgs: async () => orgs,
    fetchStints: async () => stints,
    fetchWeighIns: async () => weighIns,
    fetchOfficials: async () => officials,
    fetchScorecards: async () => scorecards,
    fetchCorners: async () => corners,
    fetchPunchStats: async () => punches,
    ...moneyFetchers,
  };
}
