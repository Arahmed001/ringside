import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCsv, convertCsv } from "../lib/csv-feed";
import { sanitizeFeed } from "../lib/validate";

const dir = "docs/sample-csv";
const sample = () => ({
  fighters: fs.readFileSync(`${dir}/fighters.csv`, "utf8"),
  events: fs.readFileSync(`${dir}/events.csv`, "utf8"),
  fights: fs.readFileSync(`${dir}/fights.csv`, "utf8"),
});

test("parseCsv handles quotes, doubled quotes, line breaks in cells, BOM and CRLF", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\r\n\r\n'), [["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "z"]]);
});

test("the sample spreadsheets convert with no problems and pass the site's own validation", () => {
  const { feed, problems } = convertCsv(sample());
  assert.deepEqual(problems, []);
  assert.ok(feed.boxers.length >= 10);
  const r = sanitizeFeed(JSON.parse(JSON.stringify(feed)));
  assert.equal(r.issues.length, 0);
});

test("columns match whatever the capitalisation or spacing", () => {
  const s = sample();
  const first = s.fighters.split("\n")[0];
  const shouted = { ...s, fighters: s.fighters.replace(first, first.toUpperCase().replace(/ /g, "_")) };
  assert.deepEqual(convertCsv(shouted).problems, []);
});

test("mistakes are reported with the file and the row, and nothing is guessed", () => {
  const s = sample();
  const bad = { ...s, fights: s.fights + "Nowhere Night,Sample Boxer 01,Nobody Known,12,red,UD,,,\n" };
  const { problems } = convertCsv(bad);
  assert.ok(problems.length > 0);
  assert.ok(problems.every((p) => p.file && p.row >= 2 && p.message.length > 5));
});

test("a missing required column is named", () => {
  const s = sample();
  const { problems } = convertCsv({ ...s, fighters: "name,country\nA B,Saudi Arabia\n" });
  assert.ok(problems.some((p) => p.file === "fighters" && /weight class/.test(p.message)));
});
