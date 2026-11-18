import { MoreIcon as SharedMoreIcon } from '@/assets/icons';
import React, { useRef, useState, useCallback } from 'react';
import { Button, Menu, MenuItem } from '@/components/ui';

/**
 * EntityMenu — the single shared ⋮ menu for every Design Bar entity.
 *
 * Replaces the structurally-identical InstanceMenu / LayoutMenu. Each entity
 * passes only the items that apply (push/sync to source, reset, go to source,
 * replace, detach, delete). Disabled via `enabled:false`; destructive via
 * `danger:true`. Clicking an enabled item closes the popover then fires onClick.
 */

export interface EntityMenuItem {
  label: string;
  onClick: () => void;
  /** Defaults to true. A disabled item renders muted and does not fire onClick. */
  enabled?: boolean;
  /** Destructive action — rendered in the danger color. */
  danger?: boolean;
}

export interface EntityMenuProps {
  items: EntityMenuItem[];
  /** Trigger button title (a11y / tooltip). Defaults to "Options". */
  title?: string;
}

export const EntityMenu: React.FC<EntityMenuProps> = ({ items, title = 'Options' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const run = useCallback((item: EntityMenuItem) => {
    if (item.enabled === false) return;
    setIsOpen(false);
    item.onClick();
  }, []);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        iconOnly
        onClick={() => setIsOpen(!isOpen)}
        title={title}
      >
        <SharedMoreIcon className="w-4 h-4" />
      </Button>

      <Menu
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        triggerRef={triggerRef}
        placement="bottom-end"
        width={220}
      >
        {items.map((item, i) => (
          <MenuItem
            key={`${item.label}-${i}`}
            label={item.label}
            danger={item.danger}
            disabled={item.enabled === false}
            onSelect={() => run(item)}
          />
        ))}
      </Menu>
    </>
  );
};

export default EntityMenu;
