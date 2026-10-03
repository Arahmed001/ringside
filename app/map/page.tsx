import type { Metadata } from "next";
import { getWorld, recordStr } from "@/lib/world";
import { styleMap, ARCH_COLOR, ARCHETYPES } from "@/lib/style";
import { StyleMap } from "@/components/StyleMap";

export const metadata: Metadata = { title: "Style Map" };

export default async function MapPage() {
  const w = await getWorld();
  const pts = styleMap(w).map((p) => ({ slug: p.boxer.slug, name: p.boxer.name, x: p.x, y: p.y, color: ARCH_COLOR[p.arch], arch: p.arch, record: recordStr(p.boxer), wc: p.boxer.weightClass }));
  return (
    <div>
      <div className="eyebrow mb-2">Unsupervised · PCA projection</div>
      <h1 className="font-display text-5xl font-extrabold uppercase">Style map</h1>
      <p className="mb-6 mt-2 max-w-2xl text-muted">Every fighter plotted by how they fight — power, durability, workrate, reach, age and form — compressed to two dimensions. Fighters close together fight alike. Click a legend chip to isolate a style.</p>
      <StyleMap points={pts} legend={ARCHETYPES.filter((a) => a !== "Prospect").map((a) => ({ label: a, color: ARCH_COLOR[a] }))} />
    </div>
  );
}
