import type { DatabaseSync } from "node:sqlite";
import { demoProvider } from "./providers/demo";
import { licensedProvider } from "./providers/licensed";
import type { DataProvider } from "./providers";
import { normalizeDivision } from "./divisions";

const K = 24;

export function getProvider(): DataProvider {
  return process.env.BOXING_PROVIDER === "licensed" ? licensedProvider() : demoProvider();
}

export const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function division(raw: string): string {
  const d = normalizeDivision(raw);
  if (!d) throw new Error(`Unknown weight class from provider: "${raw}"`);
  return d;
}

/** Unique slugs across a table, including rows that already exist from earlier ingests. */
function slugger(db: DatabaseSync, table: "boxers" | "people" | "orgs") {
  const taken = new Set((db.prepare(`SELECT slug FROM ${table}`).all() as { slug: string }[]).map((r) => r.slug));
  return (name: string) => {
    const base = slugify(name) || "x";
    let slug = base, n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;
    taken.add(slug);
    return slug;
  };
}

const num = (v: number | null | undefined) => (v === undefined || v === null || Number.isNaN(v) ? null : v);

export async function ingest(db: DatabaseSync, provider = getProvider()) {
  const [boxers, events, bouts] = await Promise.all([provider.fetchBoxers(), provider.fetchEvents(), provider.fetchBouts()]);
  const [people, orgs, stints, weighIns, officials, scorecards, corners, punches] = await Promise.all([
    provider.fetchPeople?.() ?? [], provider.fetchOrgs?.() ?? [], provider.fetchStints?.() ?? [], provider.fetchWeighIns?.() ?? [],
    provider.fetchOfficials?.() ?? [], provider.fetchScorecards?.() ?? [], provider.fetchCorners?.() ?? [], provider.fetchPunchStats?.() ?? [],
  ]);
  const src = (s?: string) => s ?? `provider:${provider.name}`;

  db.exec("BEGIN");
  try {
    // ----- organisations & people -----
    const orgSlug = slugger(db, "orgs");
    const og = new Map<string, number>();
    const insO = db.prepare(`INSERT INTO orgs (external_id, slug, name, kind, country, city) VALUES (?,?,?,?,?,?)
      ON CONFLICT(external_id) DO UPDATE SET name=excluded.name, kind=excluded.kind, country=COALESCE(excluded.country, orgs.country), city=COALESCE(excluded.city, orgs.city) RETURNING id`);
    for (const o of orgs) og.set(o.externalId, (insO.get(o.externalId, orgSlug(o.name), o.name, o.kind, o.country ?? null, o.city ?? null) as { id: number }).id);

    const personSlug = slugger(db, "people");
    const pe = new Map<string, number>();
    const insP = db.prepare(`INSERT INTO people (external_id, slug, name, country, wikidata_id) VALUES (?,?,?,?,?)
      ON CONFLICT(external_id) DO UPDATE SET name=excluded.name, country=COALESCE(excluded.country, people.country), wikidata_id=COALESCE(excluded.wikidata_id, people.wikidata_id) RETURNING id`);
    for (const p of people) pe.set(p.externalId, (insP.get(p.externalId, personSlug(p.name), p.name, p.country ?? null, p.wikidataId ?? null) as { id: number }).id);

    // ----- boxers -----
    const boxerSlug = slugger(db, "boxers");
    const bx = new Map<string, number>();
    const insB = db.prepare(`INSERT INTO boxers (external_id, slug, name, nickname, country, birth_year, stance, height_cm, reach_cm, weight_class, turned_pro, active, photo_url,
        birth_date, birth_place, residence, wikidata_id, boxrec_id, aliases, debut_date, retired_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(external_id) DO UPDATE SET name=excluded.name, active=excluded.active, reach_cm=excluded.reach_cm, height_cm=excluded.height_cm,
        photo_credit = CASE WHEN excluded.photo_url IS NOT NULL THEN NULL ELSE boxers.photo_credit END,
        photo_url = COALESCE(excluded.photo_url, boxers.photo_url),
        birth_date = COALESCE(excluded.birth_date, boxers.birth_date), birth_place = COALESCE(excluded.birth_place, boxers.birth_place),
        residence = COALESCE(excluded.residence, boxers.residence), wikidata_id = COALESCE(excluded.wikidata_id, boxers.wikidata_id),
        boxrec_id = COALESCE(excluded.boxrec_id, boxers.boxrec_id), aliases = COALESCE(excluded.aliases, boxers.aliases),
        debut_date = COALESCE(excluded.debut_date, boxers.debut_date), retired_date = excluded.retired_date
      RETURNING id`);
    for (const b of boxers) {
      const row = insB.get(b.externalId, boxerSlug(b.name), b.name, b.nickname ?? null, b.country, b.birthYear, b.stance, b.heightCm, b.reachCm,
        division(b.weightClass), b.turnedPro, b.active ? 1 : 0, b.photoUrl ?? null, b.birthDate ?? null, b.birthPlace ?? null, b.residence ?? null,
        b.wikidataId ?? null, b.boxrecId ?? null, b.aliases?.length ? JSON.stringify(b.aliases) : null, b.debutDate ?? null, b.retiredDate ?? null) as { id: number };
      bx.set(b.externalId, row.id);
    }

    // ----- events & bouts -----
    const ev = new Map<string, number>();
    const insE = db.prepare(`INSERT INTO events (external_id, name, date, venue, city, country, poster_url, promoter_org_id, broadcaster, attendance) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(external_id) DO UPDATE SET name=excluded.name, date=excluded.date, poster_url=excluded.poster_url,
        promoter_org_id=COALESCE(excluded.promoter_org_id, events.promoter_org_id), broadcaster=COALESCE(excluded.broadcaster, events.broadcaster),
        attendance=COALESCE(excluded.attendance, events.attendance) RETURNING id`);
    for (const e of events) {
      ev.set(e.externalId, (insE.get(e.externalId, e.name, e.date, e.venue, e.city, e.country, e.posterUrl ?? null,
        e.promoterExternalId ? og.get(e.promoterExternalId) ?? null : null, e.broadcaster ?? null, num(e.attendance)) as { id: number }).id);
    }
    const bo = new Map<string, number>();
    const insBo = db.prepare(`INSERT INTO bouts (external_id, event_id, red_id, blue_id, weight_class, rounds, winner_id, method, end_round, title, position,
        round_time, kd_red, kd_blue, odds_red, odds_blue, contract_lb, title_org_id, title_vacant)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(external_id) DO UPDATE SET winner_id=excluded.winner_id, method=excluded.method, end_round=excluded.end_round,
        round_time=excluded.round_time, kd_red=excluded.kd_red, kd_blue=excluded.kd_blue, odds_red=excluded.odds_red, odds_blue=excluded.odds_blue,
        contract_lb=excluded.contract_lb, title_org_id=excluded.title_org_id, title_vacant=excluded.title_vacant RETURNING id`);
    for (const b of bouts) {
      bo.set(b.externalId, (insBo.get(b.externalId, ev.get(b.eventExternalId)!, bx.get(b.redExternalId)!, bx.get(b.blueExternalId)!, division(b.weightClass), b.rounds,
        b.winnerExternalId ? bx.get(b.winnerExternalId)! : null, b.method, b.endRound, b.title, b.position,
        b.roundTime ?? null, num(b.kdRed), num(b.kdBlue), num(b.oddsRed), num(b.oddsBlue), num(b.contractLb),
        b.titleOrgExternalId ? og.get(b.titleOrgExternalId) ?? null : null, b.titleVacant === undefined ? null : b.titleVacant ? 1 : 0) as { id: number }).id);
    }

    // ----- detail rows: replaced per source / per bout so a re-ingest never duplicates, and other sources' rows survive -----
    if (stints.length) {
      const sources = [...new Set(stints.map((s) => src(s.source)))];
      for (const s of sources) db.prepare("DELETE FROM team_stints WHERE source = ?").run(s);
      const ins = db.prepare("INSERT INTO team_stints (boxer_id, role, person_id, org_id, start_date, end_date, source) VALUES (?,?,?,?,?,?,?)");
      for (const s of stints) {
        const bid = bx.get(s.boxerExternalId);
        if (!bid) continue;
        ins.run(bid, s.role, s.personExternalId ? pe.get(s.personExternalId) ?? null : null, s.orgExternalId ? og.get(s.orgExternalId) ?? null : null, s.start ?? null, s.end ?? null, src(s.source));
      }
    }
    if (weighIns.length) {
      const ins = db.prepare(`INSERT INTO weigh_ins (bout_id, boxer_id, official_lb, fight_night_lb, limit_lb, made_weight, source) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(bout_id, boxer_id) DO UPDATE SET official_lb=excluded.official_lb, fight_night_lb=excluded.fight_night_lb, limit_lb=excluded.limit_lb, made_weight=excluded.made_weight, source=excluded.source`);
      for (const w of weighIns) {
        const b = bo.get(w.boutExternalId), x = bx.get(w.boxerExternalId);
        if (b && x) ins.run(b, x, num(w.officialLb), num(w.fightNightLb), num(w.limitLb), w.madeWeight === undefined ? null : w.madeWeight ? 1 : 0, src(w.source));
      }
    }
    const boutIds = [...bo.values()];
    const wipe = (table: "officials" | "scorecards" | "corners" | "punch_stats") => {
      const del = db.prepare(`DELETE FROM ${table} WHERE bout_id = ?`);
      for (const id of boutIds) del.run(id);
    };
    if (officials.length) {
      wipe("officials");
      const ins = db.prepare("INSERT INTO officials (bout_id, role, person_id, seat) VALUES (?,?,?,?)");
      for (const o of officials) { const b = bo.get(o.boutExternalId), p = pe.get(o.personExternalId); if (b && p) ins.run(b, o.role, p, num(o.seat)); }
    }
    if (scorecards.length) {
      wipe("scorecards");
      const ins = db.prepare("INSERT INTO scorecards (bout_id, judge_id, seat, red_score, blue_score) VALUES (?,?,?,?,?)");
      for (const s of scorecards) { const b = bo.get(s.boutExternalId), p = pe.get(s.judgeExternalId); if (b && p) ins.run(b, p, s.seat, s.red, s.blue); }
    }
    if (corners.length) {
      wipe("corners");
      const ins = db.prepare("INSERT INTO corners (bout_id, boxer_id, role, person_id) VALUES (?,?,?,?)");
      for (const c of corners) { const b = bo.get(c.boutExternalId), x = bx.get(c.boxerExternalId), p = pe.get(c.personExternalId); if (b && x && p) ins.run(b, x, c.role, p); }
    }
    if (punches.length) {
      wipe("punch_stats");
      const ins = db.prepare("INSERT INTO punch_stats (bout_id, boxer_id, round, thrown, landed, power_thrown, power_landed, jab_thrown, jab_landed) VALUES (?,?,?,?,?,?,?,?,?)");
      for (const p of punches) {
        const b = bo.get(p.boutExternalId), x = bx.get(p.boxerExternalId);
        if (b && x) ins.run(b, x, p.round, p.thrown, p.landed, p.powerThrown, p.powerLanded, num(p.jabThrown), num(p.jabLanded));
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  recomputeRatings(db);

  // New profiles get headshots straight away when the resolver is enabled (real data only: the demo fighters are fictional).
  if (process.env.MEDIA_RESOLVER === "wikimedia") {
    const { resolveMissingMedia } = await import("./media/resolve");
    await resolveMissingMedia(db, { limit: Number(process.env.MEDIA_RESOLVER_BATCH ?? 100), log: (m) => console.log("[media]", m) });
  }
}

/** Replays every completed bout chronologically with Elo (K=24, KO bonus). */
export function recomputeRatings(db: DatabaseSync) {
  const rows = db.prepare(`SELECT b.id, e.date, b.red_id r, b.blue_id u, b.winner_id w, b.method m
    FROM bouts b JOIN events e ON e.id=b.event_id WHERE b.method IS NOT NULL AND b.method != 'NC' ORDER BY e.date, b.id`).all() as
    { id: number; date: string; r: number; u: number; w: number | null; m: string }[];
  const rating = new Map<number, number>();
  const get = (id: number) => rating.get(id) ?? 1500;
  db.exec("BEGIN; DELETE FROM rating_history; UPDATE boxers SET rating = 1500;");
  const ins = db.prepare("INSERT INTO rating_history (boxer_id, bout_id, date, rating, opp_rating) VALUES (?,?,?,?,?)");
  for (const x of rows) {
    const ra = get(x.r), rb = get(x.u);
    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const sa = x.w === x.r ? 1 : x.w === x.u ? 0 : 0.5;
    const k = K * (x.m === "KO" || x.m === "TKO" ? 1.15 : 1);
    const na = ra + k * (sa - ea), nb = rb + k * (1 - sa - (1 - ea));
    rating.set(x.r, na); rating.set(x.u, nb);
    ins.run(x.r, x.id, x.date, na, rb);
    ins.run(x.u, x.id, x.date, nb, ra);
  }
  const upd = db.prepare("UPDATE boxers SET rating=? WHERE id=?");
  for (const [id, r] of rating) upd.run(r, id);
  db.exec("COMMIT");
}
