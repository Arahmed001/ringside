import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { fieldLabel, valueText } from "@/lib/correction-text";
import type { CorrectionNote } from "@/lib/accounts/corrections";

export interface NoteRow extends CorrectionNote { /** shown before the field, for a fact about a fight seen from a fighter's page */ about?: { href: string; label: string }; names?: [string, string] }

/**
 * Says where a corrected fact came from, on the page that shows it: the source the editors accepted, or that the fighter gave it themself. Nothing here exists
 * until a correction has been accepted (or made by a confirmed fighter): a report alone never shows on a page.
 */
export async function CorrectionNotes({ rows }: { rows: NoteRow[] }) {
  if (!rows.length) return null;
  const t = await getT();
  return (
    <div className="mt-4 border-t border-line/60 pt-3 text-xs text-muted">
      <div className="mb-1 uppercase tracking-widest">{t("Corrected")}</div>
      <ul className="space-y-1">
        {rows.map((n) => (
          <li key={n.id}>
            {n.about && <><Link href={n.about.href} className="underline decoration-dotted hover:text-ink">{n.about.label}</Link>{": "}</>}
            <span className="text-ink/90">{fieldLabel(t, n.field)}: {valueText(t, n.field, n.value, n.names)}</span>
            {" · "}
            {n.byOwner ? t("provided by the fighter")
              : n.sourceUrl && /^https?:\/\//.test(n.sourceUrl) ? <>{t("corrected from a source")}{" "}<a href={n.sourceUrl} target="_blank" rel="noopener noreferrer nofollow ugc" className="underline decoration-dotted hover:text-ink">{t("source")}</a></>
              : t("corrected from a source")}
          </li>
        ))}
      </ul>
    </div>
  );
}
