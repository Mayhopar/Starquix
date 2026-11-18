// "Worked for Ns" under a reply: AIProvider stamps endedAt when a reply leaves 'streaming' (complete, error,
// needs-continue — a cancel settles as complete), and never while it streams.
import { it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { AIProvider, useAI } from '../AIContext';

vi.mock('@/context', () => ({ useTool: () => ({ activeTool: 'ai' }) }));
vi.mock('@/store', () => ({ useEditorDoc: () => null }));
vi.mock('@/store/selectors', () => ({ selectResolvedStaticMarkup: () => null }));
vi.mock('@/store/types', () => ({ parseKey: () => null }));

it('stamps endedAt once the reply settles, not while it streams', () => {
  vi.useFakeTimers({ now: 1_000 });
  try {
    let api!: ReturnType<typeof useAI>;
    function Probe() { api = useAI(); return null; }
    render(<AIProvider><Probe /></AIProvider>);
    act(() => api.addMessage({ id: 'r', role: 'assistant', content: '', timestamp: 1_000, status: 'streaming' }));
    vi.setSystemTime(4_000);
    act(() => api.updateMessage('r', { content: 'Working', status: 'streaming' }));
    expect(api.messages.find(m => m.id === 'r')?.endedAt).toBeUndefined();
    vi.setSystemTime(39_000);
    act(() => api.updateMessage('r', { content: 'Done.', status: 'complete' }));
    expect(api.messages.find(m => m.id === 'r')?.endedAt).toBe(39_000);
  } finally { vi.useRealTimers(); }
});
