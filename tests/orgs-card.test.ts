import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("orgs-card");
after(cleanup);
let team: typeof import("../lib/team");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
before(async () => { team = await import("../lib/team"); w = await (await import("../lib/world")).getWorld(); });

/** The organisations list prints three numbers per card from `orgCard`; they must be the ones the organisation's own page prints from `orgStable`. */
test("an organisation's card shows the same fighters, current fighters and record as its full stable", () => {
  let checked = 0;
  for (const o of w.orgs.values()) {
    const roles: import("../lib/types").TeamRole[] = o.kind === "gym" ? ["gym"] : ["promoter"];
    if (o.kind !== "gym" && o.kind !== "promotion") continue;
    const full = team.orgStable(w, o.id, roles), card = team.orgCard(w, o.id, roles);
    assert.deepEqual(card, { record: full.record, fighters: full.fighters, currentFighters: full.currentFighters }, o.name);
    checked++;
  }
  assert.ok(checked > 10, "the demo league has gyms and promotions to compare");
});

test("the card is kept: asking twice gives the same object, and another role is another card", () => {
  const o = [...w.orgs.values()].find((x) => x.kind === "promotion")!;
  assert.equal(team.orgCard(w, o.id, ["promoter"]), team.orgCard(w, o.id, ["promoter"]));
  assert.notEqual(team.orgCard(w, o.id, ["promoter"]), team.orgCard(w, o.id, ["gym"]));
});
