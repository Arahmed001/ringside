# Dependencies: what `npm ci` and `npm audit` say, and what they mean

Checked 2026-10-07 on the lockfile at that date. Re-check with `npm audit --omit=dev` (what ships; the gate and CI require it to say 0), `npm audit` (everything, including tools) and `npm outdated`.

## "5 high severity vulnerabilities" after `npm ci`

All five are one advisory seen through a chain of five packages: `braces` (GHSA-vfj7-8cjw-p6xm, "stack exhaustion through deeply nested patterns") ← `micromatch` ← `fast-glob` ← `@next/eslint-plugin-next` ← `eslint-config-next`.

- **Nothing that ships contains it.** The chain is the linter's. `npm audit --omit=dev` (what a visitor's server runs) reports 0.
- **It is not reachable here.** The flaw is a crash from a pattern with thousands of nested braces; the only patterns the linter globs are the ones in this repository's own configuration, written by us.
- **It cannot be fixed by upgrading.** No patched version of `braces` exists (3.0.3 is the latest and the affected one: the advisory's range is "<= 3.0.3"), `@next/eslint-plugin-next` pins `fast-glob` 3.3.1 in 16.3.8 and in 16.4.0, and the suggestion `npm audit fix --force` offers (`eslint-config-next@14.2.35`) is a downgrade of two major versions that would break the lint setup. So the five stay until Next's plugin moves off `fast-glob` or `braces` is patched. Do not run `npm audit fix --force`.

## "eslint@9.39.5: This version is no longer supported"

ESLint's 9 line has reached its last release (its npm tag is `maintenance`) and the notice is the registry's deprecation flag, not a defect. Moving to ESLint 10 is blocked by the plugins `eslint-config-next` brings: `eslint-plugin-import`, `eslint-plugin-jsx-a11y` and `eslint-plugin-react` declare support for ESLint up to 9 only, so installing 10 fails on peer dependencies. Revisit when they publish a version that accepts 10 (`npm view eslint-plugin-import peerDependencies.eslint`).

## Newer versions that exist and were left alone

`next` 16.4.0 (released 2026-10-06; it does not change either finding above), `typescript` 7, `@types/node` 26 (we run Node 22: its types stay on 22). Each is a choice for when there is a reason, with `npm run gate -- --fresh` as the check.

## The rule

A change that makes `npm audit --omit=dev` report anything, or that makes `npm run gate` fail, does not go in. Findings in the development tools are written down here instead of silenced.
