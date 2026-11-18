/**
 * Regression (2026-07-25): clearing the AI context tray was the Footer's job and
 * only ran in handleTabChange, so leaving AI mode via the toolbar arrow tool
 * (or ⌘J, or the preview toggle) left the chips in place. They reappeared on the
 * next visit to the AI tab and read as "cmd+click in design mode added this
 * element" — cmd+click means click-through select in design mode, add-to-context
 * in AI mode, and the two must not mix. AIProvider owns the state, so it owns
 * the lifecycle: the tray is empty whenever activeTool !== 'ai'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { AIProvider, useAI } from '../AIContext';

let activeTool = 'ai';
vi.mock('@/context', () => ({ useTool: () => ({ activeTool }) }));
vi.mock('@/store', () => ({ useEditorDoc: () => null }));
vi.mock('@/store/selectors', () => ({ selectResolvedStaticMarkup: () => null }));
vi.mock('@/store/types', () => ({ parseKey: () => null }));

/** Adds one chip through the real dispatch path, then reports the tray. */
function Probe({ onReady }: { onReady: (api: ReturnType<typeof useAI>) => void }) {
  const api = useAI();
  onReady(api);
  return <span data-testid="count">{api.contextElements.length}</span>;
}

function renderTray() {
  let api!: ReturnType<typeof useAI>;
  const ui = (
    <AIProvider>
      <Probe onReady={(a) => { api = a; }} />
    </AIProvider>
  );
  const { rerender, getByTestId } = render(ui);
  return {
    count: () => Number(getByTestId('count').textContent),
    addChip: () => act(() => {
      window.dispatchEvent(new CustomEvent('sq:add-ai-context', {
        detail: { key: 'src/X.astro:1:1', tagName: 'p', classes: 'text-sm' },
      }));
    }),
    // Same element identity would hit React's bail-out and skip the effect.
    setTool: (t: string) => act(() => {
      activeTool = t;
      rerender(
        <AIProvider>
          <Probe onReady={(a) => { api = a; }} />
        </AIProvider>,
      );
    }),
    api: () => api,
  };
}

describe('AI context tray lifecycle', () => {
  beforeEach(() => { activeTool = 'ai'; });

  it('clears the tray when activeTool leaves ai by any route', () => {
    const t = renderTray();
    t.addChip();
    expect(t.count()).toBe(1);

    t.setTool('select');
    expect(t.count()).toBe(0);
  });

  it('keeps the tray while the AI tool stays active', () => {
    const t = renderTray();
    t.addChip();
    t.setTool('ai');
    expect(t.count()).toBe(1);
  });

  it('clearContextElements keeps array identity when already empty', () => {
    const t = renderTray();
    const before = t.api().contextElements;
    act(() => t.api().clearContextElements());
    expect(t.api().contextElements).toBe(before);
  });
});


it('late message updates stay in the owning chat and never resurrect a closed chat', () => {
  const t = renderTray();
  const firstId = t.api().activeSessionId;
  act(() => t.api().addMessage({ id: 'reply-1', role: 'assistant', content: 'Partial', timestamp: 1, status: 'streaming' }));
  act(() => t.api().newSession());
  act(() => t.api().updateMessage('reply-1', { status: 'error', content: 'Partial' }));
  expect(t.api().messages).toEqual([]);
  expect(t.api().sessions.find(s => s.id === firstId)?.messages[0].status).toBe('error');
  act(() => t.api().closeSession(firstId));
  act(() => t.api().updateMessage('reply-1', { content: 'Late' }));
  expect(t.api().sessions).toHaveLength(1);
  expect(t.api().messages).toEqual([]);
});

it('new and switched chats do not inherit the previous chat’s error', () => {
  const t = renderTray();
  const firstId = t.api().activeSessionId;
  act(() => t.api().setError('previous failure'));
  act(() => t.api().newSession());
  expect(t.api().error).toBeNull();
  act(() => t.api().setError('second failure'));
  act(() => t.api().switchSession(firstId));
  expect(t.api().error).toBeNull();
  act(() => t.api().setError('closed failure'));
  act(() => t.api().closeSession(firstId));
  expect(t.api().error).toBeNull();
});
