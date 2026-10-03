import fs from "node:fs";
import path from "node:path";
import type { Dict } from "./t";
import type { Found } from "./extract";
import { checkDict } from "./extract";

const MODEL = process.env.ANTHROPIC_MODEL_TRANSLATE ?? "claude-sonnet-5-5";

/** Loads KEY=value pairs from .env.local / .env into process.env (scripts do not get Next's env loading). */
export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export async function ask(system: string, user: string, maxTokens = 8000): Promise<string> {
  loadEnv();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (put it in .env.local; never commit it)");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(120000),
    });
    if (res.ok) {
      const j = (await res.json()) as { content: { type: string; text?: string }[] };
      return j.content.filter((c) => c.type === "text").map((c) => c.text).join("");
    }
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
    throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

export const parseJson = <T>(out: string): T => JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as T;

const STYLE = `You translate the interface of Ringside, a professional-boxing statistics site, from English into Modern Standard Arabic for readers in Saudi Arabia and the Gulf.
Rules:
- Natural, concise sports-desk Arabic, not word-for-word. Keep headings short.
- Keep {placeholders} and <tags>…</tags> exactly as written (same names, same count); you may move them to where Arabic grammar wants them. Placeholders hold numbers or names already in the right language.
- Use Western digits (0-9), never Arabic-Indic digits. Keep the Latin letters of abbreviations like KO, TKO, Elo, WBA, kg, lb, cm where a boxing reader expects them.
- Keep the brand name Ringside in Latin letters.
- Where English says "He"/"She" the Arabic must use the matching masculine/feminine forms.
- Use the glossary renderings for boxing terms, always the same word for the same term.
- Plural entries are given as {"one": "...", "other": "..."} in English; return Arabic with the keys zero, one, two, few, many, other (Arabic has six forms; {n} is the count).
Return ONLY a JSON object mapping each English key to its Arabic string (or plural object).`;

/** Fills the missing keys with Claude in batches, validating every answer against its source before saving it. */
export async function translateMissing(missing: string[], found: Map<string, Found>, load: () => Dict, save: (d: Dict) => void, batch = 40) {
  if (!missing.length) { console.log("nothing to translate"); return; }
  const glossary = fs.readFileSync(path.join(process.cwd(), "i18n", "glossary.json"), "utf8");
  console.log(`${missing.length} keys to translate in batches of ${batch} with ${MODEL}`);
  for (let i = 0; i < missing.length; i += batch) {
    const keys = missing.slice(i, i + batch);
    const src = Object.fromEntries(keys.map((k) => [k, found.get(k)?.plural ? { one: found.get(k)!.plural, other: k } : k]));
    let got: Dict;
    try { got = parseJson<Dict>(await ask(`${STYLE}\n\nGlossary:\n${glossary}`, JSON.stringify(src, null, 1))); }
    catch (e) { console.error(`batch ${i / batch + 1}: ${(e as Error).message}`); continue; }
    const accepted: Dict = {};
    const report = checkDict(got, new Map(keys.filter((k) => k in got).map((k) => [k, found.get(k)!] as const)));
    const bad = new Set(report.badPlaceholders.map((b) => b.key));
    for (const k of keys) if (k in got && !bad.has(k)) accepted[k] = got[k];
    save({ ...load(), ...accepted });
    console.log(`batch ${i / batch + 1}/${Math.ceil(missing.length / batch)}: ${Object.keys(accepted).length}/${keys.length} accepted${bad.size ? `, rejected for malformed placeholders: ${[...bad].join(" | ")}` : ""}`);
  }
}
