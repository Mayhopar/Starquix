import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { Footer } from './Footer';

const { mockCancelGeneration, submit } = vi.hoisted(() => ({ mockCancelGeneration: vi.fn(), submit: vi.fn() }));

import type { AIMessage, AIConfig } from '@/ai/types';
let aiState: { isGenerating: boolean; error?: string | null; messages?: AIMessage[]; config?: AIConfig | null };
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
    ...aiState,
  }),
}));
vi.mock('@/ai/hooks/useAIAgent', () => ({
  useAIAgent: () => ({ submitAgentPrompt: submit, cancelGeneration: mockCancelGeneration }),
}));
vi.mock('@/utils/serverMode', () => ({
  getDevPreviewMode: () => 'wc',
  cycleDevPreviewMode: vi.fn(),
}));
vi.mock('./AISettings', () => ({ AISettings: ({ isOpen, initialTab }: { isOpen: boolean; initialTab: string }) => isOpen ? <div role="dialog" aria-label={`AI settings ${initialTab}`} /> : null }));
vi.mock('./AISettingsButton', () => ({ AISettingsButton: () => null }));
vi.mock('@/components/Terminal/TerminalView', () => ({ TerminalView: ({ projectId }: { projectId: string }) => <div data-testid="terminal-view">{projectId}</div> }));

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
  submit.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  aiState = { isGenerating: false, config: { provider: 'anthropic', apiKey: 'test' } };
  toolState = { activeTool: 'ai', isPreview: false };
});


const secret = '<html>token-secret /private/file https://untrusted.example/billing credits</html>';
it('renders curated legacy failure with an editable prompt and no scraped billing destination', () => {
  aiState.error = secret;
  renderFooter();
  expect(screen.getByRole('textbox')).toBeEnabled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Try a smaller change' } });
  expect(screen.getByRole('textbox')).toHaveValue('Try a smaller change');
  expect(screen.getByRole('status')).toHaveTextContent('The AI request could not finish.');
  expect(document.body.textContent).not.toContain('token-secret');
  expect(screen.queryByRole('button', { name: 'Add credits' })).toBeNull();
});
it('keeps the draft and opens existing API settings when a connection is missing', () => {
  aiState.config = null;
  renderFooter();
  const prompt = screen.getByRole('textbox');
  expect(prompt).toBeEnabled();
  fireEvent.change(prompt, { target: { value: 'Keep this draft' } });
  fireEvent.keyDown(prompt, { key: 'Enter' });
  expect(prompt).toHaveValue('Keep this draft');
  expect(screen.getByRole('dialog', { name: 'AI settings api' })).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});
it('preserves a typed partial reply and opens settings without resubmitting the request', () => {
  aiState.messages = [{ id: 'a', role: 'assistant', content: 'Partial reply.\n  Same spacing.', timestamp: 1, status: 'error', failure: 'credits' }];
  renderFooter();
  expect(document.body.textContent).toContain('Partial reply.\n  Same spacing.');
  expect(screen.getByRole('status')).toHaveTextContent('The provider requires more credits');
  fireEvent.click(screen.getByRole('button', { name: 'Open AI settings' }));
  expect(screen.getByRole('dialog', { name: 'AI settings api' })).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});
it('hides untyped legacy error content and failed activity diagnostics', () => {
  aiState.messages = [{ id: 'a', role: 'assistant', content: secret, timestamp: 1, status: 'error', activities: [{ id: 't', toolName: 'read_page_content', label: 'Reading page elements', status: 'error', detail: secret }] }];
  renderFooter();
  expect(document.body.textContent).not.toContain('token-secret');
  expect(screen.getByRole('status')).toHaveTextContent('The AI request could not finish.');
  expect(screen.getByRole('textbox')).toBeEnabled();
});

it('the AI tab is always the chat; the Terminal tab is the project\'s terminal (no prompt, no Send, no chat tabs)', async () => {
  renderFooter();
  expect(screen.queryByTestId('terminal-view')).toBeNull();
  expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'New chat' }).length).toBeGreaterThan(0); // the tab and the + chip
  expect(screen.getByTestId('footer-panel')).toHaveStyle({ width: '560px', height: '160px' }); // an empty chat: the composer
  fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
  expect(await screen.findByTestId('terminal-view')).toHaveTextContent('browser_test');
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
  expect(screen.getByTestId('footer-panel')).toHaveStyle({ width: '720px', height: '320px' });
});

describe('chat: typing while the agent works (ledger #27-31)', () => {
  const done = (status: AIMessage['status']): AIMessage[] => [
    { id: 'u', role: 'user', content: 'Add a hero', timestamp: 1 },
    { id: 'a', role: 'assistant', content: 'Added.', timestamp: 1, status },
  ];
  const typeAndEnter = (text: string) => {
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: 'Enter' });
    return box;
  };
  // A fresh element per render: an identical one lets React skip Footer, and the mocked run state never reaches it.
  const footer = () => <Footer projectId="browser_test" onOpenModal={vi.fn()} onExport={vi.fn()} onDeploy={vi.fn()} />;

  it('Enter while running queues the prompt (shown as Queued), not sent; a clean finish sends it', () => {
    aiState.isGenerating = true;
    const { rerender } = render(footer());
    const box = typeAndEnter('Make it blue');
    expect(submit).not.toHaveBeenCalled();
    expect(box).toHaveValue('');
    expect(screen.getByTestId('chat-queued')).toHaveTextContent('Make it blue');
    typeAndEnter('and rounder'); // one slot: a second Enter adds a line
    expect(screen.getByTestId('chat-queued')).toHaveTextContent('Make it blue and rounder');
    aiState.isGenerating = false; aiState.messages = done('complete');
    rerender(footer());
    expect(submit).toHaveBeenCalledWith('Make it blue\nand rounder');
    expect(screen.queryByTestId('chat-queued')).toBeNull();
  });

  it('a step-capped pause or a failure hands the queue back to the composer instead of sending it', () => {
    for (const status of ['needs-continue', 'error'] as const) {
      submit.mockClear(); aiState.isGenerating = true; aiState.messages = [];
      const { rerender, unmount } = render(footer());
      typeAndEnter('Next thing');
      aiState.isGenerating = false; aiState.messages = done(status);
      rerender(footer());
      expect(submit).not.toHaveBeenCalled();
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Next thing');
      unmount();
    }
  });

  it('Stop (button or Esc) cancels and hands the queue back — a cancelled run never sends it', () => {
    aiState.isGenerating = true;
    const { rerender } = render(footer());
    const box = typeAndEnter('Queued idea');
    fireEvent.change(box, { target: { value: 'draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(mockCancelGeneration).toHaveBeenCalledTimes(1);
    expect(box).toHaveValue('Queued idea\ndraft');
    aiState.isGenerating = false; aiState.messages = done('complete'); // a cancel settles as complete
    rerender(footer());
    expect(submit).not.toHaveBeenCalled();
    aiState.isGenerating = true;
    act(() => { rerender(footer()); });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Escape' });
    expect(mockCancelGeneration).toHaveBeenCalledTimes(2);
  });

  it('the queued block\'s ✕ puts the text back; Shift+Enter is a newline, never a send', () => {
    aiState.isGenerating = true;
    render(footer());
    typeAndEnter('Oops');
    fireEvent.click(screen.getByRole('button', { name: 'Unqueue' }));
    expect(screen.queryByTestId('chat-queued')).toBeNull();
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(box).toHaveValue('Oops');
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(screen.queryByTestId('chat-queued')).toBeNull();
  });
});
