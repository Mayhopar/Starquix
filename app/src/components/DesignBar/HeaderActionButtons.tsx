import { ArrowUpRightIcon as SharedArrowUpRightIcon, RefreshIcon as SharedRefreshIcon } from '@/assets/icons';
import React from 'react';
import { Button } from '@/components/ui';

/**
 * Shared Design Bar header affordances used by BOTH a component-instance header
 * and the (now instance-backed) layout header — so the ↻ pull icon, the ↗
 * go-to-source icon, and the go-to-source event live in ONE place.
 */

/** Fire the editor's "open this .astro in the source tab" event. */
export function goToSource(path: string | null, name: string | null | undefined): void {
  window.dispatchEvent(new CustomEvent('sq:go-to-source-component', { detail: { path, name } }));
}

/**
 * Amber ↻ "updates available — pull from source" button. Directional (wiki
 * design-bar.md UC8): shown when the MASTER moved and this instance isn't
 * receiving it for free (today: BlogSlot settings vs the defaults binding).
 * Plain local edits show the heading asterisk instead — reload outranks it.
 */
export const PullFromSourceButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button
    variant="ghost"
    size="sm"
    iconOnly
    onClick={onClick}
    title="Updates available — pull from source"
  >
    {/* Amber (text-warning) lives on the svg, not the button: the ghost
        variant's text-btn-ghost-text-default wins the cascade against a
        button-level warning color (both are same-specificity utilities), which
        rendered the indicator gray — indistinguishable from the neutral icons. */}
    <SharedRefreshIcon className="w-4 h-4 text-warning" />
  </Button>
);

/** ↗ "go to source" button. */
export const GoToSourceButton: React.FC<{ path: string; name: string | null | undefined }> = ({ path, name }) => (
  <Button variant="ghost" size="sm" iconOnly onClick={() => goToSource(path, name)} title="Go to source">
    <SharedArrowUpRightIcon className="w-4 h-4" />
  </Button>
);
