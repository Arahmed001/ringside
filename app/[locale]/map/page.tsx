import { getWorld, recordStr } from "@/lib/world";
import { styleMapSample, ARCH_COLOR, ARCHETYPES } from "@/lib/style";
import { StyleMap, type MapPoint } from "@/components/StyleMap";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({ path: "/map", title: t("Style Map"), description: t("Every fighter plotted by how they fight, with power, durability, workrate, reach, age and form compressed into one map. Fighters close together fight alike.") }));

export default async function MapPage() {
  const t = await getT();
  const w = await getWorld();
  const { points, total, perStyle } = styleMapSample(w);
  const styles = ARCHETYPES.map((a) => ({ label: a as string, color: ARCH_COLOR[a] }));
  const divisions = [...new Set(points.map((p) => p.boxer.weightClass))];
  // three decimals is finer than a pixel on the 100-unit canvas; unrounded floats were most of the payload
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const pts: MapPoint[] = points.map((p) => [p.boxer.slug, t.name(p.boxer.name), r3(p.x), r3(p.y), ARCHETYPES.indexOf(p.arch), recordStr(p.boxer), divisions.indexOf(p.boxer.weightClass)]);
  return (
    <div>
      <div className="eyebrow mb-2">{t("Unsupervised · PCA projection")}</div>
      <h1 className="font-display text-5xl font-extrabold uppercase">{t("Style map")}</h1>
      <p className="mb-6 mt-2 max-w-2xl text-muted">{t("Every fighter plotted by how they fight — power, durability, workrate, reach, age and form — compressed to two dimensions. Fighters close together fight alike. Click a legend chip to isolate a style.")}</p>
      <StyleMap points={pts} styles={styles} divisions={divisions} />
      {total > pts.length && <p className="mt-3 text-xs text-muted">{t("Showing the {perStyle} highest-rated fighters of each style: {shown} of {total} with eight or more bouts. All of them shaped the projection.", { perStyle, shown: pts.length.toLocaleString("en-US"), total: total.toLocaleString("en-US") })}</p>}
    </div>
  );
}
