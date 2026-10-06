import { getT } from "@/lib/i18n/server";

/**
 * A strip of links to the sections of a long page, fixed under the top bar while the page scrolls (round 123). Plain anchors: they work without scripts, the address records
 * where you jumped, and nothing runs while the page scrolls (DESIGN.md: no scroll-driven behaviour, which is why the current section is not highlighted). On a narrow screen the
 * strip scrolls sideways. `sections` lists only the sections the page actually has, in page order; each needs an element with that `id` (and `scroll-mt-*` so the strip does not cover it).
 */
export async function JumpNav({ sections }: { sections: readonly { id: string; label: string }[] }) {
  const t = await getT();
  if (sections.length < 3) return null;
  return (
    <nav aria-label={t("On this page")} className="jump-nav no-print sticky top-[3.9rem] z-10 -mx-5 overflow-x-auto border-y border-line/60 bg-bg/85 px-5 py-2 backdrop-blur-xl">
      <ul className="flex w-max min-w-full gap-2">
        {sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className="chip whitespace-nowrap py-1.5 transition hover:!border-gold/50 hover:!text-ink">{s.label}</a></li>)}
      </ul>
    </nav>
  );
}
