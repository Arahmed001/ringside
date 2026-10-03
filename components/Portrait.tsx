import { getT } from "@/lib/i18n/server";
import { portraitUrl } from "@/lib/art-url";
import type { Boxer } from "@/lib/types";

type P = Pick<Boxer, "id" | "slug" | "weightClass" | "stance">;

/** A licensed photo when we have one, otherwise the generated portrait (drawn by PortraitArt, served from /api/art/portrait). */
export async function Headshot({ boxer, size = 64, className = "", rounded = true }: { boxer: P & { name: string; photoUrl?: string | null }; size?: number; className?: string; rounded?: boolean }) {
  const t = await getT();
  const r = rounded ? "rounded-xl" : "";
  if (boxer.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={boxer.photoUrl} alt={t.name(boxer.name)} width={size} height={size * 1.25} loading="lazy" referrerPolicy="no-referrer" className={`${r} object-cover object-top ${className}`} style={{ width: size, height: size * 1.25 }} />;
  }
  // The generated art is served as a cacheable image (see lib/art.ts) instead of being inlined into every page.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={portraitUrl(boxer.slug)} alt={t("Portrait of {name}", { name: t.name(boxer.name) })} width={size} height={size * 1.25} loading="lazy" decoding="async" className={`${r} ${className} shrink-0`} style={{ width: size, height: size * 1.25 }} />;
}
