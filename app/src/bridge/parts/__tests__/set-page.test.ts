/**
 * SET_PAGE (task-120 Phase 1) — page switches are a bridge message, not an
 * iframe navigation. handleSetPage clears page-scoped state: scroll, edit
 * mode, selection/AI overlays, rescan budget; records the new page id.
 *
 * Harness mounts the real part strings — what runs here is what bridge.js ships.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type SetPageBridge = HarnessBridge & {
  handleSetPage: (payload: { pageId?: string } | null) => void;
  resetRescanBudget: () => void;
  _rescanCount: number;
  _currentPageId: string | null;
};

function mount(): SetPageBridge {
  return mountBridgeForTest() as SetPageBridge;
}

describe('handleSetPage', () => {
  beforeEach(() => {
    resetHarnessDom();
    vi.restoreAllMocks();
  });

  it('scrolls to top', () => {
    const bridge = mount();
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    bridge.handleSetPage({ pageId: 'p2' });
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it('exits edit mode when a text edit is active', () => {
    const bridge = mount();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const el = document.createElement('h1');
    el.setAttribute('data-key', 'k1');
    el.textContent = 'Hello';
    document.body.appendChild(el);
    bridge.editingElement = el;

    bridge.handleSetPage({ pageId: 'p2' });

    expect(bridge.editingElement).toBeNull();
    const sent = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => (c[0] as { type: string }).type);
    expect(sent).toContain('EDIT_MODE_EXITED');
  });

  it('clears selection + AI highlight overlays and the parent AI rings', () => {
    const bridge = mount();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    for (const attr of ['data-sq-selection-highlight', 'data-sq-ai-highlight']) {
      const overlay = document.createElement('div');
      overlay.setAttribute(attr, 'true');
      document.body.appendChild(overlay);
    }

    bridge.handleSetPage({ pageId: 'p2' });

    expect(document.querySelectorAll('[data-sq-selection-highlight]').length).toBe(0);
    expect(document.querySelectorAll('[data-sq-ai-highlight]').length).toBe(0);
    // Section rings are drawn by the canvas — SET_PAGE clears them by reporting
    // an empty rect set, or they would float over the next page.
    const rectMsgs = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'AI_ACTIVE_RECTS');
    expect(rectMsgs.at(-1)![0]).toEqual({ type: 'AI_ACTIVE_RECTS', payload: { rects: [] } });
  });

  it('resets the rescan budget', () => {
    const bridge = mount();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    bridge._rescanCount = 10;
    bridge.handleSetPage({ pageId: 'p2' });
    expect(bridge._rescanCount).toBe(0);
  });

  it('records the current page id', () => {
    const bridge = mount();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    bridge.handleSetPage({ pageId: 'p2' });
    expect(bridge._currentPageId).toBe('p2');
  });

  it('tolerates a null payload', () => {
    const bridge = mount();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    expect(() => bridge.handleSetPage(null)).not.toThrow();
    expect(bridge._currentPageId).toBeNull();
  });
});
