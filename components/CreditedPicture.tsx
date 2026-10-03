import { getT } from "@/lib/i18n/server";
import type { Picture } from "@/lib/types";

/**
 * A free-licensed picture of an organisation, a belt or a venue, with the credit its licence asks for under it (author and licence, linked to the file's
 * page on Wikimedia Commons). The image is loaded from Commons by the visitor's browser; nothing is copied to this site.
 */
export async function CreditedPicture({ picture, alt, className = "", imgClassName = "max-h-40" }: { picture: Picture; alt: string; className?: string; imgClassName?: string }) {
  const t = await getT();
  return (
    <figure className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={picture.url} alt={alt} loading="lazy" referrerPolicy="no-referrer" className={`w-auto rounded-xl object-contain ${imgClassName}`} />
      <figcaption className="mt-1.5 max-w-xs text-xs leading-snug text-muted">
        {t("Image:")} <a href={picture.credit.pageUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-ink">{picture.credit.text}</a>
        {" · "}{picture.credit.source}
      </figcaption>
    </figure>
  );
}
