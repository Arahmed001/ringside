/**
 * The gate (round 130): everything CI runs before a change is allowed onto main, as one command (`npm run gate`), so it can be run anywhere, in a fresh clone, and above
 * all when CI cannot run (on 2026-10-04 and again on 2026-10-07 GitHub refused to start the smoke job because of the account's billing). The steps and the smoke variants live
 * here, and tests/gate.test.ts fails if .github/workflows/ci.yml stops running what this file says, so the two cannot drift apart.
 */
export interface Step { id: string; label: string; cmd: string; args: string[]; env?: Record<string, string>; /** extra proof beyond the exit code, from the step's output */ proves?: (output: string) => string | null }

/** The leagues the smoke test visits, in CI's order: the default, nothing upcoming, no data at all, many facts unknown, a partial first load, and a hostile one. */
export const SMOKE_VARIANTS: string[][] = [[], ["--feed", "sparse"], ["--feed", "empty"], ["--facts", "unknown"], ["--feed", "partial"], ["--feed", "hostile", "--crawl", "60"]];

/** A smoke run passed only if its last line says every page was fine: "272/272 ok". (A line like "270/272 ok · 2 with problems" is a failure even when the exit code is lost.) */
export function smokeProof(output: string): string | null {
  const last = output.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
  const m = /^(\d+)\/(\d+) ok$/.exec(last);
  if (!m) return `the last line of the smoke run is not "N/N ok": ${JSON.stringify(last.slice(0, 80))}`;
  return m[1] === m[2] && Number(m[2]) > 0 ? null : `${m[1]} of ${m[2]} pages were fine`;
}
/** The test runner's own summary: no failures, and at least one test ran. */
export function testsProof(output: string): string | null {
  const pass = /^# pass (\d+)/m.exec(output), fail = /^# fail (\d+)/m.exec(output);
  if (!pass || !fail) return "no test summary in the output";
  return fail[1] === "0" && Number(pass[1]) > 0 ? null : `${fail[1]} failing, ${pass[1]} passing`;
}
export const auditProof = (output: string): string | null => (/found 0 vulnerabilities/.test(output) ? null : "npm audit did not report 0 vulnerabilities in what ships");

export const label = (args: string[]) => (args.length ? args.join(" ") : "the default league");

/** The steps, in order. `install` adds npm ci (a fresh clone needs it); `quick` stops after the build (no smoke runs, no audit). */
export function gateSteps(o: { install: boolean; quick: boolean }): Step[] {
  const s: Step[] = [];
  if (o.install) s.push({ id: "install", label: "npm ci", cmd: "npm", args: ["ci", "--no-audit", "--no-fund"] });
  s.push(
    { id: "typegen", label: "route types (next typegen)", cmd: "npx", args: ["next", "typegen"] },
    { id: "tsc", label: "type check", cmd: "npx", args: ["tsc", "--noEmit"] },
    { id: "lint", label: "lint", cmd: "npm", args: ["run", "lint"] },
    { id: "i18n", label: "translations complete", cmd: "npm", args: ["run", "i18n:check"] },
    { id: "data", label: "demo feed passes data validation", cmd: "npm", args: ["run", "data:check"], env: { RINGSIDE_NOW: "2026-10-03" } },
    { id: "tests", label: "tests", cmd: "npm", args: ["test"], proves: testsProof },
    { id: "build", label: "production build", cmd: "npm", args: ["run", "build"] },
  );
  if (!o.quick) {
    for (const v of SMOKE_VARIANTS) s.push({ id: `smoke ${v.join(" ") || "default"}`, label: `smoke: ${label(v)}`, cmd: "npm", args: ["run", "smoke", ...(v.length ? ["--", ...v] : [])], proves: smokeProof });
    s.push({ id: "audit", label: "npm audit of what ships", cmd: "npm", args: ["audit", "--omit=dev"], proves: auditProof });
  }
  return s;
}

export interface Result { step: Step; ok: boolean; seconds: number; why?: string }
/** The report: one line per step, then the verdict. */
export function summarize(results: Result[], planned: number): string[] {
  const lines = results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.step.label}${r.ok ? "" : `: ${r.why ?? "failed"}`}  (${r.seconds.toFixed(0)} s)`);
  const failed = results.filter((r) => !r.ok).length, notRun = planned - results.length;
  lines.push("", failed ? `GATE FAILED: ${failed} step${failed === 1 ? "" : "s"} failed${notRun ? `, ${notRun} not run` : ""}.` : notRun ? `GATE INCOMPLETE: ${notRun} step${notRun === 1 ? "" : "s"} not run.` : "GATE PASSED: everything CI runs before a change reaches main passed.");
  return lines;
}
