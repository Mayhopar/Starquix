import React from 'react';
import { EntityMenu, type EntityMenuItem } from './EntityMenu';

/**
 * InstanceMenu — thin builder over the shared EntityMenu: Push / Reset / Go to source (+ entity extras).
 *
 * Push and Reset act at once — no dialog: ⌘Z takes either back (owner 2026-11-10: "Good ux is when you can delete
 * anything AND UNDO!", culture.md Law 6; supersedes the 2026-08-03 confirmation gate). The local Push is one ⌘Z via
 * store/localPushUndo.ts, the doc Push via its snapshot; Reset was always undoable. The push toast reports what moved.
 */

interface InstanceMenuProps {
  /** Whether "Push changes to source" is available */
  canPush: boolean;
  /** Whether push is currently in progress */
  isPushing: boolean;
  /** Push changes to source — runs on the click (⌘Z takes it back) */
  onPush: () => void;
  /** Whether "Reset to master" is available (diverged OR outdated) */
  canReset: boolean;
  /** Reset to master — discards local edits AND adopts the latest source (⌘Z brings them back) */
  onReset: () => void;
  /** Called when user clicks "Go to source" */
  onGoToSource?: () => void;
  /**
   * Entity-specific items appended after the shared Push/Reset/Go-to-source set
   * (e.g. a layout adds Replace / Detach / Delete). Component instances pass
   * nothing, so their menu is unchanged.
   */
  extraItems?: EntityMenuItem[];
}

export const InstanceMenu: React.FC<InstanceMenuProps> = ({
  canPush,
  isPushing,
  onPush,
  canReset,
  onReset,
  onGoToSource,
  extraItems,
}) => {
  const items: EntityMenuItem[] = [
    {
      label: isPushing ? 'Pushing...' : 'Push changes to source',
      enabled: canPush && !isPushing,
      onClick: onPush,
    },
    { label: 'Reset to master', enabled: canReset, onClick: onReset },
    ...(onGoToSource ? [{ label: 'Go to source', onClick: onGoToSource }] : []),
    ...(extraItems ?? []),
  ];
  return <EntityMenu title="Component options" items={items} />;
};

export default InstanceMenu;
