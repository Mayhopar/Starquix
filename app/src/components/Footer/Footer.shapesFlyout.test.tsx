/**
 * Regression (2026-07-18): the Shapes flyout (task-106) opens upward via
 * `absolute bottom-full`, but task-116's preview-collapse animation wrapped
 * the manual tools in an `overflow-hidden` container — clipping the flyout
 * entirely. `overflow-hidden` must only apply while collapsed (preview mode).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Footer } from './Footer';

// Stub icon imports (jsdom cannot use the SVG data-URI components).
// Proxy needs then→undefined + has trap (see task-065 notes).
const setActiveToolMock = vi.hoisted(() => vi.fn());
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
  useTool: () => ({ activeTool: 'select', setActiveTool: setActiveToolMock, isPreview: false, setPreview: vi.fn() }),
}));
vi.mock('@/hooks/useCoverCapture', () => ({ useCoverCapture: () => ({ captureScreenshot: vi.fn() }) }));
vi.mock('@/ai/AIContext', () => ({
  useAI: () => ({
    isGenerating: false,
    error: null,
    contextElements: [],
    config: { apiKey: '' },
    messages: [],
    removeContextElement: vi.fn(),
    clearContextElements: vi.fn(),
    sessions: [{ id: 'chat-1', messages: [] }],
    activeSessionId: 'chat-1',
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

function renderFooter() {
  return render(
    <Footer
      projectId="browser_test"
     
      onOpenModal={vi.fn()}
      onExport={vi.fn()}
      onDeploy={vi.fn()}
    />
  );
}

describe('Shapes flyout clipping', () => {
  it('footer-tools does not clip (no overflow-hidden) outside preview mode', () => {
    renderFooter();
    expect(screen.getByTestId('footer-tools').className).not.toContain('overflow-hidden');
  });

  it('clicking the Shapes button shows the flyout with all shape tools', () => {
    renderFooter();
    fireEvent.click(screen.getByTestId('shapes-button'));
    const flyout = screen.getByTestId('shapes-flyout');
    expect(flyout).toBeTruthy();
    expect(flyout.querySelectorAll('button').length).toBe(5);
  });

  it('Frame and Slot share ONE toolbar button; its flyout holds both', () => {
    renderFooter();
    expect(screen.queryByRole('button', { name: /^Slot/ })).toBeNull(); // no standalone Slot button
    fireEvent.click(screen.getByTestId('frames-button'));
    const flyout = screen.getByTestId('frames-flyout');
    const titles = Array.from(flyout.querySelectorAll('button')).map(b => b.getAttribute('title'));
    expect(titles).toEqual(['Frame (A)', 'Slot']);
    fireEvent.click(flyout.querySelectorAll('button')[1]);
    expect(screen.queryByTestId('frames-flyout')).toBeNull(); // picking closes it
    expect(setActiveToolMock).toHaveBeenLastCalledWith('slot');
  });
});
