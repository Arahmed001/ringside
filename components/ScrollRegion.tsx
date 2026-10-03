import type { ReactNode } from "react";

/**
 * A box that scrolls sideways when its table is wider than the screen. Only a box that can take focus can be scrolled with a keyboard, so it has
 * tabindex 0 (axe's `scrollable-region-focusable`) and a name. It is a labelled group, not a region: a page can have a dozen of these, which would
 * clutter the landmark list, and a region named like the section around it fails axe's `landmark-unique`. Use it for a wide table that has nothing focusable in it; a table whose
 * cells are links is already reachable with Tab and does not need it.
 */
export function ScrollRegion({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={`overflow-x-auto ${className}`} tabIndex={0} role="group" aria-label={label}>{children}</div>;
}
