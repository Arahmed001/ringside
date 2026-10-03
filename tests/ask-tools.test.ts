import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { askResultProblems as problems, tempDb } from "./helpers";
import { makeT, tEn, type Dict, type Names } from "../lib/i18n/t";
import type { ArgSpec, Ctx, ToolResult } from "../lib/ask/types";

/**
 * Every tool "Ask the data" can run, with its default arguments and with each argument set alone to each kind of value it accepts, in English
 * and Arabic, over the demo league. What must hold for all of them: it does not throw, it says what it found in a finished sentence, its tables
 * are rectangular, its links are site paths, and nothing is "undefined" or NaN. (The planner can only ever call these tools with arguments
 * `sanitizeArgs` allows, so this covers what a visitor or a model can make happen.)
 */
const cleanup = tempDb("ask-tools");
after(cleanup);
const AR = JSON.parse(fs.readFileSync(path.join(process.cwd(), "i18n", "ar.json"), "utf8")) as Dict;
let ctxEn: Ctx, ctxAr: Ctx;
let TOOLS: typeof import("../lib/ask/tools");

before(async () => {
  const w = await (await import("../lib/world")).getWorld();
  TOOLS = await import("../lib/ask/tools");
  ctxEn = { w, t: tEn, names: {} as Names }; ctxAr = { w, t: makeT("ar", AR), names: {} as Names };
});

const samples = (a: ArgSpec): unknown[] => a.kind === "enum" ? [...a.values] : a.kind === "number" ? [a.min, a.max, Math.round((a.min + a.max) / 2)] : a.kind === "boolean" ? [true, false] : ["Mexico", "a", "Ramil Abad", "zzzz-nobody"];

test("every tool answers well with default arguments and with each argument alone, in both languages", () => {
  let runs = 0; const bad: string[] = [];
  for (const tool of TOOLS.TOOLS) {
    const variants: Record<string, unknown>[] = [{}];
    for (const a of tool.args) for (const v of samples(a)) variants.push({ [a.name]: v });
    for (const [lang, ctx] of [["en", ctxEn], ["ar", ctxAr]] as const) for (const raw of variants) {
      const args = TOOLS.sanitizeArgs(tool, raw);
      let r: ToolResult;
      try { r = tool.run(ctx, args); } catch (e) { bad.push(`${tool.name} ${lang} ${JSON.stringify(raw)} threw: ${(e as Error).message}`); continue; }
      runs++;
      for (const p of problems(r, tool.name)) bad.push(`${tool.name} ${lang} ${JSON.stringify(raw)}: ${p}`);
    }
  }
  assert.deepEqual(bad.slice(0, 15), [], `${bad.length} problems in ${runs} runs`);
  assert.ok(runs > 300, `${runs} runs`);
});

test("limits are honoured, junk arguments are dropped, and a name that matches nobody gets an honest empty answer", () => {
  const find = (n: string) => TOOLS.toolByName(n)!;
  const run = (n: string, raw: unknown) => find(n).run(ctxEn, TOOLS.sanitizeArgs(find(n), raw));
  assert.ok(run("fighters", { limit: 3 }).tables[0].rows.length <= 3);
  assert.ok(run("fighters", { limit: 9999 }).tables[0].rows.length <= 25, "capped at 25");
  assert.ok(run("fighters", { limit: -5 }).tables[0].rows.length >= 1, "a negative limit falls back to a usable one");
  assert.deepEqual(TOOLS.sanitizeArgs(find("fighters"), { sex: "robot", evil: "x", division: "Moon class", limit: "ten" }), {}, "unknown names and values are dropped");
  const nobody = run("fighter", { name: "zzzz-nobody" });
  assert.ok(nobody.tables.length === 0 && /zzzz|find|no /i.test(nobody.summary + nobody.lines.join(" ")), `an unknown fighter says so: ${nobody.summary}`);
  assert.equal(run("events", { when: "recent", limit: 2 }).tables[0].rows.length, 2);
  assert.ok(run("fight_of_the_year", { year: 1900 }).tables.length === 0, "a year with no scored fights is an empty answer, not an error");
  assert.ok(run("bouts", { year: 2100 }).tables.length === 0);
});
