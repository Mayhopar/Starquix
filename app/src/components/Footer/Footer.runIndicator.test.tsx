/**
 * task-127: the AI run must stay visible (and stoppable in preview) when the
 * AI panel is hidden — pulsing dot on the AI segment tab, Stop pill in preview.
 * All AI progress UI is otherwise gated behind aiVisible (displayedTab==='ai'
 * && !isPreview), so a run continued headless on other tabs / in preview.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Footer } from './Footer';

const { mockCancelGeneration } = vi.hoisted(() => ({ mockCancelGeneration: vi.fn() }));

let aiState: { isGenerating: boolean };
let toolState: { activeTool: string; isPreview: boolean };

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
  useTool: () => ({ ...toolState, setActiveTool: vi.fn(), setPreview: vi.fn() }),
}));
vi.mock('@/hooks/useCoverCapture', () => ({ useCoverCapture: () => ({ captureScreenshot: vi.fn() }) }));
vi.mock('@/ai/AIContext', () => ({
  useAI: () => ({
    ...aiState,
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
  useAIAgent: () => ({ submitAgentPrompt: vi.fn(), cancelGeneration: mockCancelGeneration }),
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
    />,
  );
}

beforeEach(() => {
  mockCancelGeneration.mockClear();
  aiState = { isGenerating: false };
  toolState = { activeTool: 'select', isPreview: false };
});

describe('AI-tab run badge', () => {
  it('shows a running dot on the AI tab when generating on another tab', () => {
    aiState = { isGenerating: true };
    renderFooter(); // activeTool 'select' → mounts on manual tab
    expect(screen.getByTestId('ai-run-badge')).toBeInTheDocument();
  });

  it('hides the dot when the AI tab is displayed', () => {
    aiState = { isGenerating: true };
    toolState = { activeTool: 'ai', isPreview: false }; // mounts with AI tab displayed
    renderFooter();
    expect(screen.queryByTestId('ai-run-badge')).toBeNull();
  });

  it('hides the dot when idle', () => {
    renderFooter();
    expect(screen.queryByTestId('ai-run-badge')).toBeNull();
  });
});

describe('preview-mode Stop pill', () => {
  it('shows the pill with a working Stop while generating in preview', () => {
    aiState = { isGenerating: true };
    toolState = { activeTool: 'select', isPreview: true };
    renderFooter();
    expect(screen.getByTestId('ai-preview-pill')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(mockCancelGeneration).toHaveBeenCalled();
  });

  it('no pill when idle in preview', () => {
    toolState = { activeTool: 'select', isPreview: true };
    renderFooter();
    expect(screen.queryByTestId('ai-preview-pill')).toBeNull();
  });

  it('no pill outside preview while generating (panel/badge covers it)', () => {
    aiState = { isGenerating: true };
    renderFooter();
    expect(screen.queryByTestId('ai-preview-pill')).toBeNull();
  });
});
