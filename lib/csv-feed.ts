import type { FeedData } from "./feed";
import { emptyFeed } from "./feed";
import type { ProviderBout, ProviderBoxer, ProviderEvent } from "./providers";
import type { Sex, Stance } from "./types";
import { normalizeMethod } from "./methods";

/**
 * Turns three plain spreadsheet exports (fighters, events, fights; saved as CSV) into the FeedData shape the site loads.
 * It exists so that data a person can keep in a spreadsheet can be loaded without writing JSON by hand: the result goes through
 * `npm run data:check -- --file feed.json`, which says what the site itself would reject. Every complaint here names the file and the row.
 * Columns are matched by name, ignoring case, spaces and underscores ("Weight class", "weight_class" and "WeightClass" are the same column).
 */

export interface CsvProblem { file: "fighters" | "events" | "fights"; row: number; message: string }

/** A small RFC 4180 reader: quoted cells, doubled quotes, commas and line breaks inside quotes, a leading byte-order mark, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const key = (h: string) => h.toLowerCase().replace(/[\s_\-]+/g, "");
type Rec = Record<string, string>;
const table = (text: string): { rows: Rec[]; headers: string[] } => {
  const all = parseCsv(text);
  if (!all.length) return { rows: [], headers: [] };
  const headers = all[0].map(key);
  return { headers, rows: all.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))) };
};
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const yes = (s: string, dflt: boolean) => (s === "" ? dflt : /^(y|yes|true|1|active)$/i.test(s));
const int = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

export function convertCsv(input: { fighters: string; events: string; fights: string }): { feed: FeedData; problems: CsvProblem[] } {
  const problems: CsvProblem[] = [];
  const bad = (file: CsvProblem["file"], row: number, message: string) => problems.push({ file, row, message });
  const feed = emptyFeed();

  // ---- fighters
  const F = table(input.fighters);
  for (const need of ["name", "country", "weightclass"]) if (F.rows.length && !F.headers.includes(need)) bad("fighters", 1, `there is no "${need === "weightclass" ? "weight class" : need}" column`);
  const fighterByKey = new Map<string, string>(); // id or lower-case name -> externalId
  const nameCount = new Map<string, number>();
  F.rows.forEach((r) => nameCount.set(r.name.toLowerCase(), (nameCount.get(r.name.toLowerCase()) ?? 0) + 1));
  const usedIds = new Set<string>();
  F.rows.forEach((r, i) => {
    const row = i + 2;
    if (!r.name) return bad("fighters", row, "the name is empty");
    if (!r.country) return bad("fighters", row, `${r.name}: the country is empty`);
    if (!r.weightclass) return bad("fighters", row, `${r.name}: the weight class is empty`);
    const id = r.id || `f-${slug(r.name)}`;
    if (usedIds.has(id)) return bad("fighters", row, `${r.name}: the id "${id}" is already used by an earlier row (two fighters with the same name need an id column)`);
    usedIds.add(id);
    let stance: Stance | null = null;
    if (r.stance) {
      const s = r.stance.toLowerCase();
      stance = s.startsWith("o") ? "Orthodox" : s.startsWith("sw") ? "Switch" : s.startsWith("s") ? "Southpaw" : null;
      if (!stance) bad("fighters", row, `${r.name}: the stance "${r.stance}" is not Orthodox, Southpaw or Switch (left blank)`);
    }
    let sex: Sex = "male";
    if (r.sex) {
      if (/^(f|female|woman|women)$/i.test(r.sex)) sex = "female";
      else if (!/^(m|male|man|men)$/i.test(r.sex)) bad("fighters", row, `${r.name}: the sex "${r.sex}" is not male or female (taken as male)`);
    }
    const num = (col: string, label: string): number | null => {
      if (!r[col]) return null;
      const n = int(r[col]);
      if (n === null) bad("fighters", row, `${r.name}: ${label} "${r[col]}" is not a whole number (left blank)`);
      return n;
    };
    const b: ProviderBoxer = {
      externalId: id, name: r.name, country: r.country, birthYear: num("birthyear", "the birth year"), stance, sex,
      heightCm: num("heightcm", "the height"), reachCm: num("reachcm", "the reach"), weightClass: r.weightclass,
      turnedPro: num("turnedpro", "the turned-pro year"), active: yes(r.active ?? "", true),
      ...(r.nickname ? { nickname: r.nickname } : {}),
    };
    feed.boxers.push(b);
    fighterByKey.set(id.toLowerCase(), id);
    if (nameCount.get(r.name.toLowerCase()) === 1) fighterByKey.set(r.name.toLowerCase(), id);
  });

  // ---- events
  const E = table(input.events);
  for (const need of ["name", "date", "venue", "city", "country"]) if (E.rows.length && !E.headers.includes(need)) bad("events", 1, `there is no "${need}" column`);
  const eventByKey = new Map<string, string>();
  const eventNameCount = new Map<string, number>();
  E.rows.forEach((r) => eventNameCount.set(r.name.toLowerCase(), (eventNameCount.get(r.name.toLowerCase()) ?? 0) + 1));
  const usedEvents = new Set<string>();
  E.rows.forEach((r, i) => {
    const row = i + 2;
    if (!r.name) return bad("events", row, "the name is empty");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || Number.isNaN(Date.parse(r.date))) return bad("events", row, `${r.name}: the date "${r.date}" must be written year-month-day, for example 2026-10-12`);
    for (const c of ["venue", "city", "country"] as const) if (!r[c]) return bad("events", row, `${r.name}: the ${c} is empty`);
    const id = r.id || `e-${r.date}-${slug(r.name)}`;
    if (usedEvents.has(id)) return bad("events", row, `${r.name}: the id "${id}" is already used by an earlier row`);
    usedEvents.add(id);
    const ev: ProviderEvent = { externalId: id, name: r.name, date: r.date, venue: r.venue, city: r.city, country: r.country };
    if (r.status) {
      if (/^(cancel)/i.test(r.status)) ev.status = "cancelled";
      else if (/^(postpon)/i.test(r.status)) ev.status = "postponed";
    }
    if (r.broadcaster) ev.broadcaster = r.broadcaster;
    feed.events.push(ev);
    eventByKey.set(id.toLowerCase(), id);
    if (eventNameCount.get(r.name.toLowerCase()) === 1) eventByKey.set(r.name.toLowerCase(), id);
  });

  // ---- fights (first listed on an event = main event)
  const B = table(input.fights);
  for (const need of ["event", "red", "blue", "rounds"]) if (B.rows.length && !B.headers.includes(need)) bad("fights", 1, `there is no "${need}" column`);
  const perEvent = new Map<string, { r: Rec; row: number }[]>();
  B.rows.forEach((r, i) => {
    const row = i + 2;
    const ev = eventByKey.get(r.event.toLowerCase());
    if (!ev) return bad("fights", row, `the event "${r.event}" is not in the events file (or two events share that name: use the id)`);
    (perEvent.get(ev) ?? perEvent.set(ev, []).get(ev)!).push({ r, row });
  });
  const seenBout = new Set<string>();
  for (const [ev, list] of perEvent) {
    const n = list.length;
    list.forEach(({ r, row }, idx) => {
      const red = fighterByKey.get(r.red.toLowerCase()), blue = fighterByKey.get(r.blue.toLowerCase());
      if (!red) return bad("fights", row, `the red fighter "${r.red}" is not in the fighters file (or two fighters share that name: use the id)`);
      if (!blue) return bad("fights", row, `the blue fighter "${r.blue}" is not in the fighters file (or two fighters share that name: use the id)`);
      if (red === blue) return bad("fights", row, `${r.red} is listed against themselves`);
      const rounds = int(r.rounds);
      if (!rounds || rounds < 1 || rounds > 15) return bad("fights", row, `the rounds "${r.rounds}" must be a whole number from 1 to 15`);
      const redBox = feed.boxers.find((b) => b.externalId === red)!;
      const w = (r.winner ?? "").toLowerCase();
      let winnerExternalId: string | null = null, method: ProviderBout["method"] = null;
      const endRoundText = r.endround ?? "";
      if (w !== "" || r.method) {
        if (/^(red|r)$/.test(w) || r.winner.toLowerCase() === r.red.toLowerCase()) winnerExternalId = red;
        else if (/^(blue|b)$/.test(w) || r.winner.toLowerCase() === r.blue.toLowerCase()) winnerExternalId = blue;
        else if (/^(draw|d)$/.test(w)) method = "DRAW";
        else if (/^(nc|no contest|n\/c)$/.test(w)) method = "NC";
        else if (w !== "") return bad("fights", row, `the winner "${r.winner}" must be red, blue, draw or nc (or empty for a fight not yet fought)`);
        if (r.method) {
          const m = normalizeMethod(r.method);
          if (!m) return bad("fights", row, `the method "${r.method}" is not one the site knows (KO, TKO, UD, SD, MD, DQ, RTD, TD, DRAW, NC)`);
          method = m;
        } else if (winnerExternalId) return bad("fights", row, `a winner is given but the method is empty (say how it ended: KO, TKO, UD, SD, MD, DQ, RTD or TD)`);
      }
      const endRound = endRoundText ? int(endRoundText) : null;
      if (endRoundText && (endRound === null || endRound < 1 || endRound > rounds)) return bad("fights", row, `the end round "${endRoundText}" must be a whole number from 1 to ${rounds}`);
      const id = r.id || `${ev}-b${idx + 1}`;
      if (seenBout.has(id)) return bad("fights", row, `the id "${id}" is already used by an earlier row`);
      seenBout.add(id);
      feed.bouts.push({
        externalId: id, eventExternalId: ev, redExternalId: red, blueExternalId: blue,
        weightClass: r.weightclass || redBox.weightClass, rounds, winnerExternalId, method, endRound, title: r.title || null,
        position: n - 1 - idx,
      });
    });
  }
  return { feed, problems };
}
