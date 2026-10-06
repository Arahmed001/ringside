import { getT } from "@/lib/i18n/server";
import { portraitUrl } from "@/lib/art-url";
import { isDemoData } from "@/lib/seo";
import type { Boxer } from "@/lib/types";

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
  // The generated art is served as a cacheable image (see lib/art.ts) instead of being inlined into every page.
  // a real person's placeholder is decoration (their name is beside it); an illustrated demo portrait is a picture, so it is described
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={portraitUrl(boxer.slug)} alt={isDemoData() ? t("Portrait of {name}", { name: t.name(boxer.name) }) : ""} width={size} height={size * 1.25} {...load} decoding="async" className={`${r} ${className} shrink-0`} style={{ width: size, height: size * 1.25 }} />;
}
