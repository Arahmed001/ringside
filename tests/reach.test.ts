import test from "node:test";
import assert from "node:assert/strict";
import { reachIndex, MIN_PEERS } from "../lib/reach";

const peers = (n: number, h = 175, r = 178) => Array.from({ length: n }, () => ({ heightCm: h, reachCm: r }));

test("reach minus height, against the division's own average", () => {
  const x = reachIndex({ heightCm: 180, reachCm: 190 }, peers(MIN_PEERS))!;
  assert.equal(x.diff, 10);
  assert.equal(x.divisionDiff, 3);
});

test("a reach shorter than the height is negative", () => {
  assert.equal(reachIndex({ heightCm: 185, reachCm: 180 }, [])!.diff, -5);
});

test("no figure when either measure is unknown or zero; no division average from too few peers", () => {
  assert.equal(reachIndex({ heightCm: null, reachCm: 180 }, []), null);
  assert.equal(reachIndex({ heightCm: 180, reachCm: null }, []), null);
  assert.equal(reachIndex({ heightCm: 0, reachCm: 180 }, []), null);
  assert.equal(reachIndex({ heightCm: 180, reachCm: 185 }, peers(MIN_PEERS - 1))!.divisionDiff, null);
});

test("peers missing a measure are not counted", () => {
  const mixed = [...peers(MIN_PEERS), { heightCm: null, reachCm: 200 }, { heightCm: 170, reachCm: null }];
  const x = reachIndex({ heightCm: 180, reachCm: 185 }, mixed)!;
  assert.equal(x.peers, MIN_PEERS);
  assert.equal(x.divisionDiff, 3);
});
