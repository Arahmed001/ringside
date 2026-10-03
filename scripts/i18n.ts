/**
 * npm run i18n:extract   write i18n/keys.json and i18n/client-keys.json from the source
 * npm run i18n:check     list missing / unused / malformed Arabic entries (exit 1 if any are missing or malformed)
 * npm run i18n:missing   print the missing keys as JSON, for a translator
 * npm run i18n:merge -- file.json   merge a { english: arabic } file into i18n/ar.json (validated first)
 * npm run i18n:translate   fill the missing keys with Claude (needs ANTHROPIC_API_KEY), in batches, with the glossary
 */
import fs from "node:fs";
import path from "node:path";
import { checkDict, extractKeys } from "../lib/i18n/extract";
import type { Dict } from "../lib/i18n/t";

const DIR = path.join(process.cwd(), "i18n");
const AR = path.join(DIR, "ar.json");
const load = (): Dict => JSON.parse(fs.readFileSync(AR, "utf8"));
const save = (d: Dict) => fs.writeFileSync(AR, JSON.stringify(Object.fromEntries(Object.keys(d).sort().map((k) => [k, d[k]])), null, 1) + "\n");

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const { found, nonLiteral } = extractKeys();
  if (cmd === "extract") {
    const keys = [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
    fs.writeFileSync(path.join(DIR, "keys.json"), JSON.stringify(keys.map((k) => ({ key: k.key, ...(k.plural ? { plural: k.plural } : {}), files: k.files })), null, 1) + "\n");
    fs.writeFileSync(path.join(DIR, "client-keys.json"), JSON.stringify(keys.filter((k) => k.client).map((k) => k.key), null, 1) + "\n");
    console.log(`${keys.length} keys (${keys.filter((k) => k.client).length} used by client code or shared libraries); ${nonLiteral.length} t() calls with a non-literal argument`);
  } else if (cmd === "check") {
    const r = checkDict(load(), found);
    console.log(`${found.size} keys, ${r.missing.length} missing, ${r.badPlaceholders.length} malformed, ${r.unused.length} unused`);
    for (const b of r.badPlaceholders.slice(0, 20)) console.log(`  malformed: ${JSON.stringify(b.key)}: ${b.problem}`);
    for (const k of r.unused.slice(0, 10)) console.log(`  unused: ${JSON.stringify(k)}`);
    for (const k of r.missing.slice(0, 10)) console.log(`  missing: ${JSON.stringify(k)}`);
    if (r.missing.length > 10) console.log(`  … and ${r.missing.length - 10} more (npm run i18n:missing)`);
    process.exit(r.missing.length || r.badPlaceholders.length ? 1 : 0);
  } else if (cmd === "missing") {
    const r = checkDict(load(), found);
    console.log(JSON.stringify(Object.fromEntries(r.missing.map((k) => [k, found.get(k)!.plural ? { one: found.get(k)!.plural, other: k } : k])), null, 1));
  } else if (cmd === "merge") {
    const add = JSON.parse(fs.readFileSync(arg, "utf8")) as Dict;
    const dict = { ...load(), ...add };
    const r = checkDict(dict, new Map([...found].filter(([k]) => k in add)));
    if (r.badPlaceholders.length) { for (const b of r.badPlaceholders) console.error(`malformed: ${JSON.stringify(b.key)}: ${b.problem}`); process.exit(1); }
    save(dict);
    console.log(`merged ${Object.keys(add).length} entries; ${Object.keys(dict).length} total`);
  } else if (cmd === "translate") {
    const { translateMissing } = await import("../lib/i18n/translate");
    const r = checkDict(load(), found);
    await translateMissing(r.missing, found, load, save);
  } else {
    console.error("usage: tsx scripts/i18n.ts extract | check | missing | merge <file> | translate");
    process.exit(2);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
