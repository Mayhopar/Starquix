/**
 * task-184 — the ↻ affordance on a LOCAL component placement.
 *
 * The badge and its button ship together: a ↻ that renders but discards
 * nothing is worse than no ↻ at all (the user clicks it, the shadowed master
 * still does not appear, and the only remedy left is invisible). These pin the
 * wiring, not the gate — `showReload` is derived in DesignBar and covered by
 * store/__tests__/localMasterOutdated.test.ts +
 * Canvas/viewportMessages/__tests__/scanning.test.ts.
 *
 * It is deliberately the SAME PullFromSourceButton WC/server renders, pointed
 * at the SAME onLocalReset the ⋮ menu's "Reset to master" uses — one button,
 * one action, no local-only copy.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ElementHeaderActions } from '../ElementHeaderActions';

const RELOAD_TITLE = 'Updates available — pull from source';

function renderActions(over: Partial<React.ComponentProps<typeof ElementHeaderActions>> = {}) {
  const onLocalReset = vi.fn();
  render(
    <ElementHeaderActions
      goToPostTarget={null}
      onOpenPost={vi.fn()}
      slotKey={null}
      isComponentEditor={false}
      canResetInstance={false}   // local placements carry SOURCE keys — always false
      showReload={true}
      onReset={vi.fn()}
      isInstanceRoot={false}
      isBlogSlot={false}
      isPostRoot={false}
      astroSource={null}
      isDiverged={false}
      isPushingToSource={false}
      onPush={vi.fn()}
      canResetFromMenu={false}
      isDrawnElement={false}
      onMakeComponent={vi.fn()}
      isMakingComponent={false}
      localComponentSource="src/components/Card.astro"
      localMasterDiverged
      onLocalPush={vi.fn()}
      onLocalReset={onLocalReset}
      {...over}
    />,
  );
  return { onLocalReset };
}

describe('local placement ↻', () => {
  it('renders when the master moved, and discards the shadowing overrides on click', () => {
    const { onLocalReset } = renderActions();
    fireEvent.click(screen.getByTitle(RELOAD_TITLE));
    expect(onLocalReset).toHaveBeenCalledTimes(1);
  });

  it('is absent while the master has not moved', () => {
    renderActions({ showReload: false });
    expect(screen.queryByTitle(RELOAD_TITLE)).toBeNull();
  });

  it('is absent in the component view — there the element IS the master', () => {
    renderActions({ isComponentEditor: true });
    expect(screen.queryByTitle(RELOAD_TITLE)).toBeNull();
  });
});
