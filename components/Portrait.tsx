import { getT } from "@/lib/i18n/server";
import { portraitUrl } from "@/lib/art-url";
import { isDemoData } from "@/lib/seo";
import type { Boxer } from "@/lib/types";
import { plateOf } from "@/lib/name-plate";

type P = Pick<Boxer, "id" | "slug" | "weightClass" | "stance">;

/** A licensed photo when we have one, otherwise the generated portrait (drawn by PortraitArt, served from /api/art/portrait). */
export async function Headshot({ boxer, size = 64, className = "", rounded = true, priority = false }: { boxer: P & { name: string; photoUrl?: string | null }; size?: number; className?: string; rounded?: boolean; /** the picture the page is waiting to paint (the fighter page's portrait): fetched at once and first, not lazily */ priority?: boolean }) {
  const load = priority ? ({ loading: "eager", fetchPriority: "high" } as const) : ({ loading: "lazy" } as const);
  const t = await getT();
  const r = rounded ? "rounded-xl" : "";
  if (boxer.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={boxer.photoUrl} alt={t.name(boxer.name)} width={size} height={size * 1.25} {...load} decoding="async" referrerPolicy="no-referrer" className={`${r} object-cover object-top ${className}`} style={{ width: size, height: size * 1.25 }} />;
  }
  // A real fighter with no licensed photo gets a name plate (the surname in large capitals, the initials in a small block), not an invented silhouette.
  // It is decoration: the name is always beside it, so it is hidden from a screen reader. The illustrated demo portraits stay as they are.
  if (!isDemoData()) {
    const plate = plateOf(t.name(boxer.name), size, t.locale);
    return (
      <div aria-hidden className={`${r} ${className} relative grid shrink-0 place-items-center overflow-hidden border border-line/70 bg-gradient-to-b from-panel2 to-panel`} style={{ width: size, height: size * 1.25 }}>
        <span className="font-display font-extrabold uppercase leading-none tracking-wide text-ink/90" style={{ fontSize: plate.fontSize }}>{plate.text}</span>
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-gold/70" />
      </div>
    );
  }
  // The generated art is served as a cacheable image (see lib/art.ts) instead of being inlined into every page.
  // a real person's placeholder is decoration (their name is beside it); an illustrated demo portrait is a picture, so it is described
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={portraitUrl(boxer.slug)} alt={isDemoData() ? t("Portrait of {name}", { name: t.name(boxer.name) }) : ""} width={size} height={size * 1.25} {...load} decoding="async" className={`${r} ${className} shrink-0`} style={{ width: size, height: size * 1.25 }} />;
}
