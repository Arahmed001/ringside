import test from "node:test";
import assert from "node:assert/strict";
import {
  METHODS, countsInRecord, endsEarly, hasScorecards, hasWinner, isDecision, isDrawResult, isRefereeStoppage, isStoppage, normalizeMethod,
} from "../lib/methods";

test("normalizeMethod maps vendor spellings", () => {
  const cases: [string, string][] = [
    ["KO", "KO"], ["Knockout", "KO"], ["TKO", "TKO"], ["Technical Knockout", "TKO"], ["Referee Stoppage", "TKO"], ["RTD", "RTD"], ["Corner Retirement", "RTD"], ["Retired", "RTD"],
    ["DQ", "DQ"], ["Disqualification", "DQ"], ["UD", "UD"], ["Unanimous Decision", "UD"], ["Decision - Unanimous", "UD"], ["Points", "UD"],
    ["Split Decision", "SD"], ["Decision (Split)", "SD"], ["Majority Decision", "MD"], ["Technical Decision", "TD"], ["Technical Draw", "TDRAW"],
    ["Draw", "DRAW"], ["Majority Draw", "DRAW"], ["No Contest", "NC"], ["NC", "NC"], ["N/C", "NC"],
  ];
  for (const [raw, want] of cases) assert.equal(normalizeMethod(raw), want, raw);
});

test("unknown or empty methods are null", () => {
  for (const raw of ["", "  ", "Walkover", "Forfeit", null, undefined]) assert.equal(normalizeMethod(raw as string | null | undefined), null, String(raw));
});

test("every canonical method is classified consistently", () => {
  for (const m of METHODS) {
    const groups = [isStoppage(m), isDecision(m), isDrawResult(m), m === "DQ", m === "NC"].filter(Boolean).length;
    assert.equal(groups, 1, `${m} must belong to exactly one result group`);
  }
});

test("records: a corner retirement is a knockout, a DQ is a win but not a knockout, a no-contest is not in the record", () => {
  assert.ok(isStoppage("RTD") && isStoppage("KO") && isStoppage("TKO"));
  assert.ok(!isStoppage("DQ") && hasWinner("DQ"));
  assert.ok(!isRefereeStoppage("RTD"), "referee statistics exclude corner retirements");
  assert.ok(!countsInRecord("NC") && !countsInRecord(null) && countsInRecord("DRAW") && countsInRecord("TDRAW"));
  assert.ok(!hasWinner("DRAW") && !hasWinner("TDRAW") && !hasWinner("NC") && !hasWinner(null));
  assert.ok(hasScorecards("UD") && hasScorecards("TD") && hasScorecards("TDRAW") && !hasScorecards("KO") && !hasScorecards("DQ"));
  assert.ok(endsEarly("KO") && endsEarly("RTD") && endsEarly("DQ") && endsEarly("TD") && !endsEarly("UD") && !endsEarly("DRAW"));
});
