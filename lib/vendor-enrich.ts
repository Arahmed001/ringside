import os from "node:os";
import path from "node:path";

/**
 * `npm run vendor:enrich` (round 90): what follows the load, guided. The load puts the vendor's fighters and fights in the database; the Arabic names, nicknames, honours,
 * photos, champions' reigns and venue and belt pictures come from Wikidata, Wikipedia and Wikimedia Commons, in an order the runbook listed as five separate commands with two
 * environment variables. These steps CALL THIRD-PARTY SERVICES, identifying you by your contact (Wikimedia asks automated clients to), so nothing runs until you type ENRICH.
 */
export const DEFAULT_DATABASE = path.join(os.homedir(), "ringside-real/real.db");

export type EnrichStepId = "staging" | "enrich" | "champions" | "venues" | "headshots" | "entities";
export interface EnrichStep { id: EnrichStepId; title: string; script: string; args: string[]; what: string }

/** The steps, in the order the runbook gives (the later ones need the earlier: reigns link to fighters only through Wikidata ids, entity pictures need the venues linked). */
export function enrichSteps(mediaLimit?: number): EnrichStep[] {
  const limit = mediaLimit ? ["--limit", String(mediaLimit)] : [];
  return [
    { id: "staging", title: "Wikidata: stage the boxers", script: "scripts/import-wikidata.ts", args: [], what: "fetches every boxer Wikidata knows (about 19,600) into a staging table, with honours and amateur pedigree; saved batch by batch, resumable, boxers fetched in the last 30 days are skipped" },
    { id: "enrich", title: "Wikidata: link our fighters to it", script: "scripts/import-wikidata.ts", args: ["--enrich"], what: "no network: links our fighters to the staged entities and fills missing biography fields, Arabic names, nicknames and article links, and honours" },
    { id: "champions", title: "Wikipedia: world title reigns", script: "scripts/import-champions.ts", args: [], what: "fetches the four men's lists of WBA, WBC, IBF and WBO champions (cached), reads every reign, and links each to our fighters through their Wikidata ids" },
    { id: "venues", title: "Wikidata: link the venues", script: "scripts/resolve-venues.ts", args: [...limit], what: "looks up the venues of our events that have not been checked yet" },
    { id: "headshots", title: "Wikimedia Commons: fighter photos", script: "scripts/resolve-media.ts", args: [...limit], what: "finds a free-licensed headshot for fighters that lack one" },
    { id: "entities", title: "Wikimedia Commons: belts, logos and venue photos", script: "scripts/resolve-media.ts", args: ["--entities", ...limit], what: "belt photos, organisation logos and venue photos (venues first, so this follows them)" },
  ];
}

/** `only` / `skip` are lists of step ids; an id nobody has is an error, not a silent no-op. */
export function selectSteps(all: EnrichStep[], only: string[] | undefined, skip: string[] | undefined): EnrichStep[] {
  const ids = new Set(all.map((s) => s.id));
  for (const x of [...(only ?? []), ...(skip ?? [])]) if (!ids.has(x as EnrichStepId)) throw new Error(`There is no step "${x}". The steps are: ${all.map((s) => s.id).join(", ")}.`);
  return all.filter((s) => (!only || only.includes(s.id)) && !(skip ?? []).includes(s.id));
}

/** Wikimedia asks for a way to reach you: an email address or a web page. Anything else is refused rather than sent. */
export const looksLikeContact = (c: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.trim()) || /^https?:\/\/\S+\.\S+/.test(c.trim());

export interface EnrichPlan { database: string; contact: string | undefined; steps: EnrichStep[]; refusal: string | null }
export function enrichPlan(argvIn: string[], env: Record<string, string | undefined>): EnrichPlan {
  const val = (flag: string) => { const i = argvIn.indexOf(flag); return i > -1 && argvIn[i + 1] && !argvIn[i + 1].startsWith("--") ? argvIn[i + 1] : undefined; };
  const list = (flag: string) => val(flag)?.split(",").map((x) => x.trim()).filter(Boolean);
  const limit = val("--media-limit") ? Number(val("--media-limit")) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error(`--media-limit must be a whole number above 0, not "${val("--media-limit")}".`);
  const steps = selectSteps(enrichSteps(limit), list("--steps"), list("--skip"));
  const contact = (val("--contact") ?? env.WIKIMEDIA_CONTACT ?? "").trim() || undefined;
  return {
    database: path.resolve(env.DATABASE_PATH || DEFAULT_DATABASE), contact, steps,
    refusal: !steps.length ? "No step is selected."
      : !contact ? "WIKIMEDIA_CONTACT is not set. Wikimedia asks automated clients to identify themselves: give your own email address or a web page (WIKIMEDIA_CONTACT=you@example.org, or --contact you@example.org). It is sent to Wikimedia as part of the request."
      : !looksLikeContact(contact) ? `"${contact}" does not look like an email address or a web page. Wikimedia asks for a way to reach you: use one.`
      : null,
  };
}

/** Whether a typed answer is the confirmation: exactly ENRICH, nothing else counts. */
export const isEnrichConfirmation = (answer: string): boolean => answer.trim() === "ENRICH";

/** Runs the steps in order and stops at the first that fails (the later ones depend on the earlier). `run` returns the step's exit code. */
export async function runSteps(steps: EnrichStep[], run: (s: EnrichStep, i: number) => Promise<number>): Promise<{ done: EnrichStepId[]; failed?: EnrichStepId; code: number }> {
  const done: EnrichStepId[] = [];
  for (const [i, s] of steps.entries()) {
    const code = await run(s, i);
    if (code !== 0) return { done, failed: s.id, code };
    done.push(s.id);
  }
  return { done, code: 0 };
}
