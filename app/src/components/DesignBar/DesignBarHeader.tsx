import type { FC, ReactNode } from 'react';

interface DesignBarHeaderProps {
  /** Left-side heading — the selected thing's name (element tag, layout name, …). */
  heading: ReactNode;
  /** Optional cluster rendered after the heading (e.g. the state-pill controls). */
  tags?: ReactNode;
  /** Right-side action row — context-dependent buttons/menus. */
  actions?: ReactNode;
}

/**
 * The single, shared Design Bar selection header. EVERY selection type — element,
 * layout, component-editor — renders this exact shell (name on the left, an action
 * row on the right). Only the `heading` and `actions` content differ; the chrome
 * is defined once here so the bar reads as one component for everything.
 */
export const DesignBarHeader: FC<DesignBarHeaderProps> = ({ heading, tags, actions }) => (
  <div className="flex items-center justify-between pl-1 mb-2 h-10">
    <div className="flex items-center gap-2 min-w-0">
      {/* Deliberately NEUTRAL for every selection kind — identity colors live
          on Assets/Layers rows only (user call 2026-08-13). */}
      <span data-testid="design-bar-heading" className="font-medium text-base text-text shrink-0">{heading}</span>
      {tags}
    </div>
    <div className="flex items-center gap-0.5">{actions}</div>
  </div>
);

export default DesignBarHeader;
