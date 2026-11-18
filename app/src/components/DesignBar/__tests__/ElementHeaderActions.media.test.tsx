/**
 * task-206 D4 (amended by owner 2026-08-11): a Media selection locks the
 * DesignBar chrome — no ↻ (pull), no instance ⋮ menu — but KEEPS the ↗
 * go-to-source icon every component has (consistency), pointing at the
 * system component's master view (sq/Media.astro in the Assets viewer).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ElementHeaderActions } from '../ElementHeaderActions';

const baseProps = {
  goToPostTarget: null,
  onOpenPost: () => {},
  slotKey: null,
  isComponentEditor: false,
  canResetInstance: true,
  showReload: true,
  onReset: () => {},
  isInstanceRoot: true,
  isBlogSlot: false,
  isPostRoot: false,
  astroSource: 'src/components/Hero.astro',
  isDiverged: false,
  isPushingToSource: false,
  onPush: () => {},
  canResetFromMenu: false,
  isDrawnElement: false,
  onMakeComponent: () => {},
  isMakingComponent: false,
};

describe('ElementHeaderActions suppressMasterChrome', () => {
  it('renders master chrome without the flag', () => {
    render(<ElementHeaderActions {...baseProps} />);
    expect(screen.getByTitle('Go to source')).toBeTruthy();
    expect(screen.getByTitle('Updates available — pull from source')).toBeTruthy();
  });

  it('with systemMaster: keeps ↗ (to the system master), hides pull and ⋮', () => {
    const spy = vi.fn();
    window.addEventListener('sq:go-to-source-component', spy);
    render(<ElementHeaderActions {...baseProps}
      systemMaster={{ path: 'src/components/sq/Media.astro', name: 'Media' }} />);

    const goTo = screen.getByTitle('Go to source');
    fireEvent.click(goTo);
    expect(spy).toHaveBeenCalledTimes(1);
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.path).toBe('src/components/sq/Media.astro');
    // Regression (WC wrong-file open): LeftSidebar matches by NAME first, and
    // WC's built-in library has an unrelated legacy `library/Media.astro` stub
    // also named "Media" — dispatching the name opened that stub. System-master
    // navigation is PATH-only.
    expect(detail.name).toBeUndefined();

    expect(screen.queryByTitle('Updates available — pull from source')).toBeNull();
    expect(screen.queryByTitle('Component options')).toBeNull();
    window.removeEventListener('sq:go-to-source-component', spy);
  });
});
