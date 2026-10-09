import Link from "@/components/L";
import { NavLink } from "@/components/NavLink";
import { Icon } from "@/components/NavIcons";
import { NAV_GROUPS } from "@/lib/nav";
import { EditorNav } from "@/components/EditorNav";
import { getT } from "@/lib/i18n/server";

/**
 * The grouped list of sections, used by the desktop rail and by the phone drawer. Anything marked `rail-collapsible` is
 * visually hidden (not removed) when the rail is collapsed, so every link keeps its name for screen readers.
 */
export async function NavGroups({ id }: { id?: string }) {
  const t = await getT();
  return (
    <nav id={id} aria-label={t("Main")} className="flex flex-col gap-1">
      {NAV_GROUPS.map((g, i) => (
        <div key={g.id} className="mb-2">
          {i > 0 && <div className="rail-rule mx-3 mb-2 border-t border-line" aria-hidden />}
          <div className="rail-collapsible eyebrow px-3.5 pb-1 pt-2">{t(g.title)}</div>
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.href}>
                <NavLink href={it.href} title={t(it.label)}
                  className="flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm text-muted transition hover:bg-panel2 hover:text-ink aria-[current=page]:bg-panel2">
                  <Icon name={it.icon} />
                  <span className="rail-collapsible min-w-0">{t(it.label)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <EditorNav />
    </nav>
  );
}

export async function Logo({ collapsible = false }: { collapsible?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2" dir="ltr" aria-label="Ringside">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red font-display text-lg font-extrabold">R</span>
      <span className={`${collapsible ? "rail-collapsible " : ""}font-display text-2xl font-extrabold uppercase tracking-wide`} lang="en">Ring<span className="text-red-ink">side</span></span>
    </Link>
  );
}
