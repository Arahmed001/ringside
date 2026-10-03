import fs from "node:fs";
import path from "node:path";

/**
 * The sites whose own records count as official, beyond the built-in rule (any .gov): a commission or a sanctioning body that is not on a .gov address.
 * One host per line in data/research/official-hosts.txt (blank lines and # comments are ignored). Used by the research pipeline (a claim from one of
 * them can be `disclosed`) and by corrections (a fight's result is the commission's or the sanctioning body's to state, so only a source they publish
 * can change what the vendor said).
 */
export const researchDir = () => process.env.RESEARCH_DIR ?? path.join(process.cwd(), "data", "research");

export function officialHostList(dir = researchDir()): string[] {
  const f = path.join(dir, "official-hosts.txt");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#"));
}
