import test from "node:test";
import assert from "node:assert/strict";
import { currentYear, nowMs, todayIso } from "../lib/clock";

test("RINGSIDE_NOW pins the app's clock", () => {
  process.env.RINGSIDE_NOW = "2026-10-03";
  assert.equal(todayIso(), "2026-10-03");
  assert.equal(currentYear(), 2026);
  assert.equal(nowMs(), Date.parse("2026-10-03"));
});

test("an unparseable pin falls back to the real clock", () => {
  process.env.RINGSIDE_NOW = "not a date";
  assert.ok(Math.abs(nowMs() - Date.now()) < 5000);
  delete process.env.RINGSIDE_NOW;
  assert.ok(Math.abs(nowMs() - Date.now()) < 5000);
});
