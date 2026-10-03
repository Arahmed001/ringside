import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("search");
after(cleanup);
let ai: typeof import("../lib/ai");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
const countries = ["United States", "Mexico", "Japan", "Saudi Arabia"];

before(async () => { ai = await import("../lib/ai"); w = await (await import("../lib/world")).getWorld(); });

test("rule-based parser: divisions, stance, sex, record", () => {
  const p = (q: string) => ai.heuristicParse(q, countries);
  assert.deepEqual(p("undefeated southpaw welterweights"), { weightClass: "Welterweight", stance: "Southpaw", undefeated: true });
  assert.equal(p("women's flyweights").sex, "female");
  assert.equal(p("women's flyweights").weightClass, "Flyweight");
  assert.equal(p("female boxers").sex, "female");
  assert.equal(p("men's heavyweights").sex, "male", "'men's' must not be mistaken for 'women's' or vice versa");
  assert.equal(p("heavyweights").sex, undefined);
  assert.equal(p("switch hitters").stance, "Switch");
  assert.equal(p("knockout artists with 15+ KOs").minKOs, 15);
  assert.equal(p("knockout artists with 15+ KOs").archetype, "Knockout Artist");
  assert.equal(p("fighters with 20+ wins").minWins, 20);
  assert.equal(p("active middleweights over 33").minAge, 34, "'over 33' means 34 and up");
  assert.equal(p("young heavyweights").maxAge, 26);
});

test("rule-based parser: corner and business phrases", () => {
  const p = (q: string) => ai.heuristicParse(q, countries);
  assert.equal(p("fighters trained by Saud Al-Dosari").trainer, "Saud Al-Dosari");
  assert.equal(p("currently trained by Saud Al-Dosari").trainerCurrent, true);
  assert.equal(p("fighters managed by Jane Roe").manager, "Jane Roe");
  assert.equal(p("promoted by Marquee Fight Co.").promoter, "Marquee Fight Co.");
  assert.equal(p("welterweights out of the Iron Hand gym").gym, "Iron Hand");
  assert.equal(p("Mexican fighters born in Tijuana").bornIn, "Tijuana");
  assert.equal(p("welterweights who missed weight").missedWeight, true);
  assert.equal(p("fighters with a new trainer").newTrainer, true);
  // the phrase is peeled out so the name doesn't leak into other rules
  const f = p("fighters trained by Saud Al-Dosari with 10+ wins");
  assert.equal(f.trainer, "Saud Al-Dosari");
  assert.equal(f.minWins, 10);
  assert.equal(f.country, undefined, "'Saud' must not be read as Saudi Arabia");
});

test("filters apply against real data", () => {
  const all = w.boxers.filter((b) => b.bouts > 0);
  const women = ai.applyFilters(all, { sex: "female" }, w);
  assert.ok(women.length > 50 && women.every((b) => b.sex === "female"));
  const sw = ai.applyFilters(all, { stance: "Switch" }, w);
  assert.ok(sw.length > 0 && sw.every((b) => b.stance === "Switch"));
  const heavy = ai.applyFilters(all, { weightClass: "Heavyweight", sex: "female" }, w);
  assert.equal(heavy.length, 0, "no women's heavyweights in the demo");
  const trainer = [...w.people.values()].find((p) => w.roles.get(p.id)?.has("trainer") && (w.stintsByPerson.get(p.id)?.length ?? 0) > 8)!;
  const trained = ai.applyFilters(all, { trainer: trainer.name }, w);
  assert.ok(trained.length > 0);
  for (const b of trained) assert.ok((w.stintsByBoxer.get(b.id) ?? []).some((s) => s.personId === trainer.id && s.role.includes("trainer")));
  const missed = ai.applyFilters(all, { missedWeight: true }, w);
  assert.ok(missed.length > 20 && missed.length < all.length / 2);
  assert.ok(ai.applyFilters(all, { undefeated: true }, w).every((b) => b.losses === 0 && b.bouts > 0));
});

test("describeFilters explains what was understood", () => {
  const chips = ai.describeFilters({ sex: "female", weightClass: "Flyweight", trainer: "A B", missedWeight: true, minAge: 34 });
  for (const want of ["Women", "Flyweight", "Trained by A B", "Has missed weight", "Age ≥ 34"]) assert.ok(chips.includes(want), `${want} in ${chips.join("|")}`);
});
