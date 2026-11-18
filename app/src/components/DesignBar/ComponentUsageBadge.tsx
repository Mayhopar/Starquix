/**
 * The master/component view's usage affordance (owner review 2026-08-03).
 *
 * Verbatim from the critic: "there is **no affordance that leads back to a
 * placement that has diverged** — no list of instances, no '3 uses', nothing."
 * And the sharper half: after a Push the recordings show one placement flipping
 * to the new value while another silently kept its own override — the same
 * click produced two different outcomes and the editor said nothing.
 *
 * So the master view now states both numbers and offers the route back:
 *   `N uses`               pages that render this component
 *   `· M overriding`       placements that currently keep their own edits — the
 *                          ones a Push will NOT visibly change
 *   click                  a page list; picking one navigates there
 *
 * Deliberately small: a count plus a way to navigate, not a panel.
 *
 * This is NOT the banned editor chrome. The "component editor has NO ⋮ menu"
 * rule forbids LIFECYCLE actions and status pills in the header's right-hand
 * action cluster (Push / Sync / Reset / Go-to-source) — you ARE the source
 * there, so those describe a divergence that cannot exist. This badge makes no
 * claim about the master and offers no action on it; it sits in the heading next
 * to OrphanedOverridesBadge, and it answers a question the master view could not
 * answer at all.
 *
 * Runtime-branch-free: `useComponentUsage` is the single place WC/server's doc
 * scan and local's host reverse-import walk are joined into one struct.
 */
import { useRef, useState } from 'react';
import { Badge, Button, Popover, Row } from '@/components/ui';
import { useComponentUsage } from '@/hooks/useComponentUsage';
import { plural, verb } from '@/utils/plural';

export interface ComponentUsageBadgeProps {
  /** The master's own file (`src/components/Header.astro`), null off a master view. */
  source: string | null;
  /** Navigate to a placement's page — dispatches SET_CURRENT_PAGE at the call site. */
  onOpenPage: (pageId: string) => void;
}

export function ComponentUsageBadge({ source, onOpenPage }: ComponentUsageBadgeProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { pages, overriddenPlacements } = useComponentUsage(source);

  if (!source || (pages.length === 0 && overriddenPlacements === 0)) return null;

  const label = [
    pages.length > 0 ? plural(pages.length, 'use') : null,
    overriddenPlacements > 0 ? `${overriddenPlacements} overriding` : null,
  ].filter(Boolean).join(' · ');

  return (
    <span className="inline-flex items-center ml-1.5">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        aria-label={`${label} — show where this component is used`}
        title="Where this component is used"
        onClick={() => setOpen((v) => !v)}
        className="h-auto w-auto p-0 rounded-full font-normal"
      >
        <Badge variant={overriddenPlacements > 0 ? 'warning' : 'default'} size="sm">
          {label}
        </Badge>
      </Button>
      <Popover
        isOpen={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        placement="bottom-start"
        width={288}
      >
        <div role="dialog" aria-label="Component usage" className="p-2">
          <div className="mb-1 px-1 text-2xs-medium text-text-muted">
            {overriddenPlacements > 0
              ? `${plural(overriddenPlacements, 'placement')} ${verb(overriddenPlacements, 'override')} this component — a push will not visibly change ${overriddenPlacements === 1 ? 'it' : 'them'}`
              : 'Every placement follows this component'}
          </div>
          {pages.length === 0 ? (
            <div className="px-1 py-1 text-2xs text-text-muted">No page found that renders it</div>
          ) : (
            pages.map((p) => (
              <Row
                key={p.pageId}
                size="sm"
                title={p.label}
                onClick={() => { setOpen(false); onOpenPage(p.pageId); }}
              />
            ))
          )}
        </div>
      </Popover>
    </span>
  );
}

export default ComponentUsageBadge;
