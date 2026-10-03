import fs from "node:fs";
import path from "node:path";
import { dynamicKeys } from "./dynamic-keys";
import type { Dict } from "./t";

const ROOT = process.cwd();
const SCAN = ["app", "components", "lib"];
const SKIP = [/^lib[\\/]providers/, /^lib[\\/]importers/, /^lib[\\/]media/, /^lib[\\/]i18n[\\/]/, /^lib[\\/]validate/, /^lib[\\/]ingest/];

export interface Found { key: string; client: boolean; plural?: string; files: string[] }

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !SKIP.some((re) => re.test(rel))) out.push(rel);
  }
  return out;
}

// a JS string literal: "…", '…' or a backtick string with no ${}
const LIT = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`[^`$\\\\]*`)";
const unq = (lit: string) => {
  const body = lit.slice(1, -1);
  return lit[0] === "`" ? body : body.replace(/\\(["'\\])/g, "$1").replace(/\\n/g, "\n").replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
};

/** Every t("…"), t.n(n, "one", "other"), t.rich("…") and msg("…") in the source, plus the registered dynamic keys. */
export function extractKeys(): { found: Map<string, Found>; nonLiteral: { file: string; line: number; code: string }[] } {
  const found = new Map<string, Found>();
  const nonLiteral: { file: string; line: number; code: string }[] = [];
  const add = (key: string, file: string, client: boolean, plural?: string) => {
    const f = found.get(key) ?? { key, client: false, files: [] };
    f.client ||= client; f.plural ??= plural;
    if (!f.files.includes(file)) f.files.push(file);
    found.set(key, f);
  };
  const reT = new RegExp(String.raw`(?<![\w.$])t\(\s*${LIT}`, "g");
  const reMsg = new RegExp(String.raw`(?<![\w.$])msg\(\s*${LIT}`, "g");
  const reRich = new RegExp(String.raw`(?<![\w$])t\.rich\(\s*${LIT}`, "g");
  const reN = new RegExp(String.raw`(?<![\w$])t\.n\(\s*[^,()]+(?:\([^()]*\))?[^,()]*,\s*${LIT}\s*,\s*${LIT}`, "g");
  const reAnyT = /(?<![\w.$])t\(\s*([^"'`\s)])/g;
  for (const file of SCAN.flatMap((d) => walk(d))) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    const client = /^\s*["']use client["']/.test(src) || file.startsWith("lib");
    for (const m of src.matchAll(reT)) add(unq(m[1]), file, client);
    for (const m of src.matchAll(reMsg)) add(unq(m[1]), file, true); // marked strings are translated wherever they end up, including in client components
    for (const m of src.matchAll(reRich)) add(unq(m[1]), file, client);
    for (const m of src.matchAll(reN)) add(unq(m[2]), file, client, unq(m[1]));
    for (const m of src.matchAll(reAnyT)) {
      const line = src.slice(0, m.index).split("\n").length;
      nonLiteral.push({ file, line, code: src.split("\n")[line - 1].trim().slice(0, 100) });
    }
  }
  for (const k of dynamicKeys()) add(k, "lib/i18n/dynamic-keys.ts", true);
  return { found, nonLiteral };
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const tags = (s: string) => [...s.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort().join(",");

export interface Report {
  missing: string[];
  unused: string[];
  badPlaceholders: { key: string; problem: string }[];
}

export function checkDict(dict: Dict, found = extractKeys().found): Report {
  const missing: string[] = [], badPlaceholders: Report["badPlaceholders"] = [];
  for (const [key, f] of found) {
    const v = dict[key];
    if (v === undefined || v === "" || (typeof v === "object" && !v.other)) { missing.push(key); continue; }
    const forms = typeof v === "string" ? [v] : Object.values(v);
    for (const form of forms) {
      if (f.plural === undefined && placeholders(form) !== placeholders(key)) badPlaceholders.push({ key, problem: `placeholders {${placeholders(form)}} should be {${placeholders(key)}}` });
      else if (f.plural !== undefined && !placeholders(form).split(",").every((p) => !p || placeholders(key).split(",").includes(p))) badPlaceholders.push({ key, problem: `placeholders {${placeholders(form)}} not in {${placeholders(key)}}` });
      if (tags(form) !== tags(key)) badPlaceholders.push({ key, problem: `tags <${tags(form)}> should be <${tags(key)}>` });
    }
  }
  const unused = Object.keys(dict).filter((k) => !found.has(k));
  return { missing: missing.sort(), unused: unused.sort(), badPlaceholders };
}
