/**
 * Seamless canvas Task 1.6: typed text is mirrored to the parent as a
 * TEXT_DRAFT while the user types (300 ms trailing debounce) and flushed
 * immediately when the document is going away.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

const drafts = (bridge: HarnessBridge) => vi.mocked(bridge.sendToParent).mock.calls
  .map(c => c[0] as { type: string; payload: Record<string, unknown> }).filter(m => m.type === 'TEXT_DRAFT');

describe('text drafts', () => {
  let bridge: HarnessBridge;
  let el: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    resetHarnessDom();
    document.body.innerHTML = '<p data-sq-source="src/pages/index.astro:6:5" data-sq-source-version="v1" data-key="src/pages/index.astro:6:5">Hello</p>';
    el = document.querySelector('p')!;
    bridge = mountBridgeForTest();
  });
  afterEach(() => { vi.useRealTimers(); });

  const type = (text: string) => { el.textContent = text; el.dispatchEvent(new Event('input')); };

  it('a burst of input sends exactly one draft after 300 ms', () => {
    bridge.handleEnterEditMode({ key: 'src/pages/index.astro:6:5' });
    type('H'); type('He'); type('Hey');
    vi.advanceTimersByTime(299);
    expect(drafts(bridge)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(drafts(bridge)).toEqual([{ type: 'TEXT_DRAFT', payload: {
      key: 'src/pages/index.astro:6:5', file: 'src/pages/index.astro', sourceVersion: 'v1', markup: 'Hey', page: location.pathname,
    } }]);
  });

  it('pagehide flushes the pending draft immediately', () => {
    bridge.handleEnterEditMode({ key: 'src/pages/index.astro:6:5' });
    type('Bye');
    window.dispatchEvent(new Event('pagehide'));
    expect(drafts(bridge).map(d => d.payload.markup)).toEqual(['Bye']);
    vi.advanceTimersByTime(1000);
    expect(drafts(bridge)).toHaveLength(1); // the debounce was consumed by the flush
  });

  // Desktop 2026-10-04: typing faster than the 300 ms debounce and pressing
  // Escape left NO draft (the timer fired after exit, editingElement null), so
  // a refused commit lost the typed text entirely. The commit's draft is
  // flushed at exit, before EDIT_MODE_EXITED; the parent clears it on accept.
  it('exit with a change flushes the draft before EDIT_MODE_EXITED, even inside the debounce window', () => {
    bridge.editedInlineMarkup = () => null;
    bridge.handleEnterEditMode({ key: 'src/pages/index.astro:6:5' });
    type('Hello typed fast');
    (bridge as unknown as { exitEditModeCleanup: () => void }).exitEditModeCleanup();
    const types = vi.mocked(bridge.sendToParent).mock.calls.map(c => (c[0] as { type: string }).type).filter(t => t === 'TEXT_DRAFT' || t === 'EDIT_MODE_EXITED');
    expect(types).toEqual(['TEXT_DRAFT', 'EDIT_MODE_EXITED']);
    expect(drafts(bridge)[0].payload).toMatchObject({ markup: 'Hello typed fast', sourceVersion: 'v1' });
    vi.advanceTimersByTime(1000);
    expect(drafts(bridge)).toHaveLength(1);
  });

  it('exit without a change sends no draft', () => {
    bridge.editedInlineMarkup = () => null;
    bridge.handleEnterEditMode({ key: 'src/pages/index.astro:6:5' });
    (bridge as unknown as { exitEditModeCleanup: () => void }).exitEditModeCleanup();
    vi.advanceTimersByTime(1000);
    expect(drafts(bridge)).toEqual([]);
  });

  it('sends nothing when not editing', () => {
    bridge.flushTextDraft();
    window.dispatchEvent(new Event('pagehide'));
    expect(drafts(bridge)).toEqual([]);
  });
});

describe('ENTER_EDIT_MODE with a restored draft', () => {
  it('shows the draft, keeps the file text as the baseline, and exit reports the change', () => {
    resetHarnessDom();
    document.body.innerHTML = '<p data-sq-source="src/pages/index.astro:6:5" data-key="src/pages/index.astro:6:5">File text</p>';
    const bridge = mountBridgeForTest();
    bridge.editedInlineMarkup = () => null;
    bridge.handleEnterEditMode({ key: 'src/pages/index.astro:6:5', draftMarkup: 'Typed text' } as never);
    const el = document.querySelector('p')!;
    expect(el.textContent).toBe('Typed text');
    expect(bridge.originalTextContent).toBe('File text');
    expect(window.getSelection()!.isCollapsed).toBe(true);
    (bridge as unknown as { exitEditModeCleanup: () => void }).exitEditModeCleanup();
    expect(vi.mocked(bridge.sendToParent)).toHaveBeenCalledWith({ type: 'EDIT_MODE_EXITED',
      payload: { key: 'src/pages/index.astro:6:5', textContent: 'Typed text', originalText: 'File text' } });
  });
});
