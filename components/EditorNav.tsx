"use client";
import { NavLink } from "@/components/NavLink";
import { Icon } from "@/components/NavIcons";
import { useT } from "@/components/i18n";
import { useAccount } from "@/lib/useAccount";
import { EDITOR_NAV, editorNavItems } from "@/lib/nav";

/** The rail's last group, for editors and administrators only. It asks who is signed in in the browser (as the header does), so no page reads a cookie and every page stays cacheable. */
export function EditorNav() {
  const t = useT();
  const me = useAccount();
  const items = editorNavItems(me?.role);
  if (!items.length) return null;
  return (
    <div className="mb-2">
      <div className="rail-rule mx-3 mb-2 border-t border-line" aria-hidden />
      <div className="rail-collapsible eyebrow px-3.5 pb-1 pt-2">{t(EDITOR_NAV.title)}</div>
      <ul className="space-y-0.5">
        {items.map((it) => (
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
  );
}
