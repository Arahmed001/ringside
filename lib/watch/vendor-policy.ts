/**
 * What the vendor update gate does with each change the daily feed makes to a row we already hold (docs/vendor-gate-plan.md, section 4; the owner's decisions of 2026-10-09).
 * One table, so the rule for any field is read in one place and tested in one place.
 *
 *  - "wait"  the change is held for an administrator (a blank filled counts: decision 1);
 *  - "pass"  the change goes in without approval (odds, picture paths);
 *  - a column in a `group` is decided together: a fight's result (winner, method, end round, round time, knockdowns, status, the judges' scores) is ONE change per fight, and a
 *    fighter's career totals follow the result they are explained by.
 *
 * A brand-new row is never in this table: it goes in at once. Only the columns `lib/ingest.ts` can overwrite on an existing row are listed.
 */
export type Table = "boxers" | "events" | "bouts" | "orgs" | "people";
export type Rule = "wait" | "pass";
export interface FieldPolicy {
  table: Table;
  column: string;
  rule: Rule;
  /** columns that move together */
  group?: "result" | "totals";
  /** the change passes anyway when this says so (an event that has finished: its fights carry the news) */
  passIf?: (oldValue: unknown, newValue: unknown) => boolean;
  /** a number whose size of change is worth reporting (median and largest) */
  numeric?: boolean;
}

const w = (table: Table, column: string, more: Partial<FieldPolicy> = {}): FieldPolicy => ({ table, column, rule: "wait", ...more });
const p = (table: Table, column: string): FieldPolicy => ({ table, column, rule: "pass" });

export const POLICY: FieldPolicy[] = [
  // a person's facts
  ...["name", "active", "stance", "sex", "weight_class", "country", "nickname", "birth_date", "birth_place", "residence", "wikidata_id", "boxrec_id", "aliases", "debut_date", "retired_date", "record_disputed"].map((c) => w("boxers", c)),
  ...["reach_cm", "height_cm", "birth_year", "turned_pro"].map((c) => w("boxers", c, { numeric: true })),
  // career totals: held with the result that explains them, else on their own
  ...["vendor_wins", "vendor_losses", "vendor_draws", "vendor_ko_wins", "vendor_stopped"].map((c) => w("boxers", c, { group: "totals", numeric: true })),
  p("boxers", "photo_url"), p("boxers", "photo_credit"),
  // cards
  w("events", "name"), w("events", "date"), w("events", "promoter_org_id"), w("events", "broadcaster"), w("events", "attendance", { numeric: true }),
  w("events", "status", { passIf: (_o, n) => n === "completed" }),
  p("events", "poster_url"),
  // fights: the result is one change
  ...["winner_id", "method", "end_round", "round_time", "kd_red", "kd_blue", "status", "vendor_scores"].map((c) => w("bouts", c, { group: "result" })),
  ...["title", "contract_lb", "title_org_id", "title_vacant"].map((c) => w("bouts", c)),
  p("bouts", "odds_red"), p("bouts", "odds_blue"),
  // organisations and people
  ...["name", "kind", "country", "city"].map((c) => w("orgs", c)),
  ...["name", "country", "wikidata_id"].map((c) => w("people", c)),
];

export const TABLE_OF: Record<string, Table> = { boxer: "boxers", event: "events", bout: "bouts", org: "orgs", person: "people" };

export const policyFor = (table: Table, column: string) => POLICY.find((f) => f.table === table && f.column === column);

// ---- settings -----------------------------------------------------------------------------------------------------------------------------------

export type GateMode = "off" | "observe" | "hold";
export interface GateSettings { mode: GateMode; maxFieldShare: number; maxFieldRows: number; maxNight: number; warnings: string[] }
export const DEFAULT_MAX_FIELD_SHARE = 0.3, DEFAULT_MAX_FIELD_ROWS = 100, DEFAULT_MAX_NIGHT = 2000;

type GateEnv = Partial<Record<"VENDOR_GATE" | "VENDOR_GATE_MAX_FIELD_SHARE" | "VENDOR_GATE_MAX_FIELD_ROWS" | "VENDOR_GATE_MAX_NIGHT", string | undefined>>;
export const gateEnv = (): GateEnv => ({
  VENDOR_GATE: process.env.VENDOR_GATE, VENDOR_GATE_MAX_FIELD_SHARE: process.env.VENDOR_GATE_MAX_FIELD_SHARE,
  VENDOR_GATE_MAX_FIELD_ROWS: process.env.VENDOR_GATE_MAX_FIELD_ROWS, VENDOR_GATE_MAX_NIGHT: process.env.VENDOR_GATE_MAX_NIGHT,
});

/** Reads VENDOR_GATE (off | observe | hold) and the three flood-guard numbers. A value that is not usable is ignored with a warning: the update never refuses to run for a typo here. */
export function gateSettings(env: GateEnv = gateEnv()): GateSettings {
  const warnings: string[] = [];
  const raw = (env.VENDOR_GATE ?? "").trim().toLowerCase();
  const mode: GateMode = raw === "observe" ? "observe" : raw === "hold" ? "hold" : "off";
  if (raw && !["0", "off", "observe", "hold"].includes(raw)) warnings.push(`VENDOR_GATE="${env.VENDOR_GATE}" is not off, observe or hold: the gate stays off.`);
  const num = (name: keyof GateEnv, def: number, ok: (n: number) => boolean) => {
    const v = env[name]?.trim();
    if (!v) return def;
    const n = Number(v);
    if (Number.isFinite(n) && ok(n)) return n;
    warnings.push(`${name}="${v}" is not usable: using ${def}.`);
    return def;
  };
  return {
    mode,
    maxFieldShare: num("VENDOR_GATE_MAX_FIELD_SHARE", DEFAULT_MAX_FIELD_SHARE, (n) => n > 0 && n <= 1),
    maxFieldRows: num("VENDOR_GATE_MAX_FIELD_ROWS", DEFAULT_MAX_FIELD_ROWS, (n) => Number.isInteger(n) && n >= 1),
    maxNight: num("VENDOR_GATE_MAX_NIGHT", DEFAULT_MAX_NIGHT, (n) => Number.isInteger(n) && n >= 1),
    warnings,
  };
}
