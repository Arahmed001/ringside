import type { WatchReport } from "./run";

/** What the commands print after a look at a source. One place, so `npm run watch` and the importer say the same thing. */
export function reportLines(r: WatchReport, dryRun: boolean): string[] {
  const out = [`${r.source}: ${r.compared} rows compared, ${r.changes} difference(s)${dryRun ? " (dry run: nothing stored)" : ""}`];
  for (const x of r.refused) out.push(`  not proposed from ${x.scope}: ${x.reason}`);
  if (r.proposals) out.push(`  proposals: ${r.proposals.added} new, ${r.proposals.updated} updated, ${r.proposals.unchanged} already pending, ${r.proposals.remembered} rejected before and unchanged, ${r.proposals.superseded} no longer true`);
  return out;
}
