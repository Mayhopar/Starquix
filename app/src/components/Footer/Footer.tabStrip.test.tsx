/**
 * Regression (2026-07-23): after a mode switch the settle timer that resets
 * switchPhase to 'idle' was cleared by the swap effect's own cleanup (it
 * re-runs when displayedTab changes), leaving switchPhase stuck at 'in' —
 * overflow-hidden stayed on the panel FOREVER and clipped the browser-style
 * chat tab strip that hangs above the panel's top edge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { Footer } from './Footer';
import { unmarkFilesTruth } from '@/utils/localMode';

vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : Stub),
    has: () => true,
  });
});
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks', () => ({ useTheme: () => ({ isDark: false, setTheme: vi.fn() }) }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ undo: vi.fn(), redo: vi.fn() }) }));
vi.mock('@/context', () => ({
  useTool: () => ({ activeTool: 'select', setActiveTool: vi.fn(), isPreview: false, setPreview: vi.fn() }),
}));
vi.mock('@/hooks/useCoverCapture', () => ({ useCoverCapture: () => ({ captureScreenshot: vi.fn() }) }));
vi.mock('@/ai/AIContext', () => ({
  useAI: () => ({
    isGenerating: false,
    error: null,
    contextElements: [],
    config: { apiKey: '' },
    messages: [],
    sessions: [{ id: 'chat-1', messages: [] }],
    activeSessionId: 'chat-1',
    removeContextElement: vi.fn(),
    clearContextElements: vi.fn(),
    newSession: vi.fn(),
    switchSession: vi.fn(),
    closeSession: vi.fn(),
  }),
}));
vi.mock('@/ai/hooks/useAIAgent', () => ({
  useAIAgent: () => ({ submitAgentPrompt: vi.fn(), cancelGeneration: vi.fn() }),
}));
vi.mock('@/utils/serverMode', () => ({
  getDevPreviewMode: () => 'wc',
  cycleDevPreviewMode: vi.fn(),
}));
vi.mock('./AISettings', () => ({ AISettings: () => null }));
vi.mock('./AISettingsButton', () => ({ AISettingsButton: () => null }));
vi.mock('@/components/Terminal/TerminalView', () => ({ TerminalView: () => null }));

describe('AI chat tab strip', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { unmarkFilesTruth('browser_test'); vi.useRealTimers(); });

  /** Render the Footer and open the AI tab; timer advancement stays per-test. */
  function renderWithAIOpen() {
    const result = render(
      <Footer
        projectId="browser_test"
       
        onOpenModal={vi.fn()}
        onExport={vi.fn()}
        onDeploy={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle('AI'));
    return result;
  }

  it('panel drops overflow-hidden after the mode-switch settles, so the strip is not clipped', () => {
    const { container } = renderWithAIOpen();
    // mid-switch: clip is expected
    act(() => vi.advanceTimersByTime(150));
    const panel = container.querySelector('[data-testid="footer-panel"]')!;
    expect(panel.className).toContain('overflow-hidden');

    // settled: clip MUST drop (this stayed stuck before the fix)
    act(() => vi.advanceTimersByTime(1000));
    expect(panel.className).not.toContain('overflow-hidden');

    // strip renders above the panel with active tab + subtle new-tab button
    expect(screen.getByLabelText('New chat')).toBeTruthy();
    expect(screen.getByLabelText('Close chat')).toBeTruthy();
  });

  // Regression (2026-10-12): the AI width was seeded from the bar it replaced;
  // with the tabs moved into the tab below, that bar is narrower than the
  // AI · model · Style · Prompt row, which got cut off.
  it('AI panel opens at its default width, not the narrower bar width', () => {
    const { container } = renderWithAIOpen();
    act(() => vi.advanceTimersByTime(1000));
    const panel = container.querySelector('[data-testid="footer-panel"]') as HTMLElement;
    expect(panel.style.width).toBe(`${Math.min(560, window.innerWidth - 24)}px`);
  });

  // Regression (2026-07-24): Button's base `shrink-0` kept the tab label at
  // full content width, so the truncate span never clipped and long titles
  // slid under the + button / neighbor tabs.
  it('tab label button is shrinkable so long titles truncate instead of overlapping', () => {
    renderWithAIOpen();
    act(() => vi.advanceTimersByTime(1200));

    // Both the session tab and the + button are titled 'New chat'; the tab is
    // the one wrapping a truncate span.
    const tabButton = screen.getAllByTitle('New chat').find(el => el.querySelector('.truncate'))!;
    expect(tabButton).toBeTruthy();
    const classes = tabButton.className.split(/\s+/);
    expect(classes).toContain('shrink');
    expect(classes).not.toContain('shrink-0');

    // + button stays opaque even when disabled (Button's disabled opacity-50
    // made it a translucent gray box over the strip while generating)
    const plusButton = screen.getByLabelText('New chat');
    expect(plusButton.className.split(/\s+/)).toContain('opacity-100');

    // Strip lifts 1px above the panel's padding box (mb-px) so the panel's
    // top border stays visible as a line under the tabs; -mb-px hid it.
    const strip = tabButton.closest('div.absolute')!;
    const stripClasses = strip.className.split(/\s+/);
    expect(stripClasses).toContain('mb-px');
    expect(stripClasses).not.toContain('-mb-px');
  });
});
