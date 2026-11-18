import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  serializeSourceText,
  restoreSourceText,
  useSourceTextPersistence,
} from '../useSourceTextPersistence';
import { KEY_SCHEME } from '../useSourceOverridesPersistence';

/**
 * task-173: the blob is an ENVELOPE stamped with the tagger key-scheme
 * generation that produced its keys. Seeds below are current-generation; the
 * refusal to apply an older one is pinned in keySchemeSetAside.test.ts.
 */
const blob = (entries: unknown) => JSON.stringify({ keyScheme: KEY_SCHEME, entries });
const envelope = (entries: unknown) => ({ keyScheme: KEY_SCHEME, entries });

// Stub localStorage: node 25's webstorage shadows jsdom's and lacks working
// methods without --localstorage-file (same pattern as ViewportFrame.test.tsx)
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  },
  configurable: true,
});

function makeDocWithSourceText(entries: Record<string, string>): Y.Doc {
  const doc = new Y.Doc();
  const sourceText = doc.getMap('sourceText');
  doc.transact(() => {
    for (const [key, text] of Object.entries(entries)) {
      const yEntry = new Y.Map();
      yEntry.set('textContent', text);
      sourceText.set(key, yEntry);
    }
  });
  return doc;
}

beforeEach(() => localStorage.clear());

describe('serializeSourceText', () => {
  it('keeps only bare source keys (file:line:col)', () => {
    const doc = makeDocWithSourceText({
      'src/pages/index.astro:5:1': 'Edited heading',
      'drawn-abc123': 'drawn text',          // drawn → excluded (own persistence tier)
      'el-xyz:h1-0': 'editor buffer',        // instance-child → excluded (push-flow buffer)
    });
    expect(serializeSourceText(doc)).toEqual({
      'src/pages/index.astro:5:1': { textContent: 'Edited heading' },
    });
  });

  it('returns {} for an empty map', () => {
    expect(serializeSourceText(new Y.Doc())).toEqual({});
  });
});

describe('restoreSourceText', () => {
  it('round-trips: serialize → localStorage → restore into a fresh doc', () => {
    const doc = makeDocWithSourceText({ 'src/pages/index.astro:5:1': 'Edited heading' });
    localStorage.setItem('sq:source-text:proj-1', blob(serializeSourceText(doc)));

    const fresh = new Y.Doc();
    restoreSourceText(fresh, 'proj-1');
    const entry = fresh.getMap('sourceText').get('src/pages/index.astro:5:1') as Y.Map<unknown>;
    expect(entry?.get('textContent')).toBe('Edited heading');
  });

  it('never clobbers an existing entry', () => {
    localStorage.setItem('sq:source-text:proj-1', blob({
      'src/pages/index.astro:5:1': { textContent: 'stale persisted' },
    }));
    const doc = makeDocWithSourceText({ 'src/pages/index.astro:5:1': 'fresh in-session' });
    restoreSourceText(doc, 'proj-1');
    const entry = doc.getMap('sourceText').get('src/pages/index.astro:5:1') as Y.Map<unknown>;
    expect(entry?.get('textContent')).toBe('fresh in-session');
  });

  it('ignores non-source keys and malformed JSON without throwing', () => {
    localStorage.setItem('sq:source-text:proj-1', blob({
      'drawn-abc': { textContent: 'nope' },
    }));
    const doc = new Y.Doc();
    restoreSourceText(doc, 'proj-1');
    expect(doc.getMap('sourceText').size).toBe(0);

    localStorage.setItem('sq:source-text:proj-2', '{not json');
    expect(() => restoreSourceText(new Y.Doc(), 'proj-2')).not.toThrow();
  });
});

describe('useSourceTextPersistence (hook)', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => vi.useRealTimers());

  it('debounce-saves source-kind entries to localStorage on Yjs change', () => {
    const doc = new Y.Doc();
    renderHook(() => useSourceTextPersistence(doc, 'proj-1'));

    act(() => {
      const yEntry = new Y.Map();
      yEntry.set('textContent', 'Hello');
      doc.getMap('sourceText').set('src/pages/index.astro:5:1', yEntry);
    });
    expect(localStorage.getItem('sq:source-text:proj-1')).toBeNull(); // debounced

    act(() => { vi.advanceTimersByTime(350); });
    expect(JSON.parse(localStorage.getItem('sq:source-text:proj-1')!)).toEqual(
      envelope({ 'src/pages/index.astro:5:1': { textContent: 'Hello' } }),
    );
  });

  it('removes the storage item when the last source entry is deleted', () => {
    const doc = new Y.Doc();
    renderHook(() => useSourceTextPersistence(doc, 'proj-1'));
    act(() => {
      const yEntry = new Y.Map();
      yEntry.set('textContent', 'Hello');
      doc.getMap('sourceText').set('src/pages/index.astro:5:1', yEntry);
    });
    act(() => { vi.advanceTimersByTime(350); });
    act(() => { doc.getMap('sourceText').delete('src/pages/index.astro:5:1'); });
    act(() => { vi.advanceTimersByTime(350); });
    expect(localStorage.getItem('sq:source-text:proj-1')).toBeNull();
  });

  it('does nothing when projectId is null', () => {
    const doc = new Y.Doc();
    renderHook(() => useSourceTextPersistence(doc, null));
    act(() => {
      const yEntry = new Y.Map();
      yEntry.set('textContent', 'Hello');
      doc.getMap('sourceText').set('src/pages/index.astro:5:1', yEntry);
    });
    act(() => { vi.advanceTimersByTime(350); });
    expect(localStorage.length).toBe(0);
  });

  // task-077: the 300ms debounce must FLUSH on page-exit paths, not drop the
  // pending write — an instant Cmd+R after a text edit was losing the edit.
  describe('flush-before-reload (task-077)', () => {
    const writeEntry = (doc: Y.Doc) => {
      const yEntry = new Y.Map();
      yEntry.set('textContent', 'Edited just before reload');
      doc.getMap('sourceText').set('src/pages/index.astro:5:1', yEntry);
    };
    const stored = () => localStorage.getItem('sq:source-text:proj-1');

    it('pagehide inside the debounce window flushes the pending write', () => {
      const doc = new Y.Doc();
      renderHook(() => useSourceTextPersistence(doc, 'proj-1'));
      act(() => writeEntry(doc));
      expect(stored()).toBeNull(); // still inside the 300ms window
      act(() => { window.dispatchEvent(new Event('pagehide')); });
      expect(JSON.parse(stored()!)).toEqual(
        envelope({ 'src/pages/index.astro:5:1': { textContent: 'Edited just before reload' } }),
      );
    });

    it('visibilitychange→hidden flushes the pending write', () => {
      const doc = new Y.Doc();
      renderHook(() => useSourceTextPersistence(doc, 'proj-1'));
      act(() => writeEntry(doc));
      const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      spy.mockRestore();
      expect(stored()).not.toBeNull();
    });

    it('unmount (project switch) flushes instead of dropping the pending write', () => {
      const doc = new Y.Doc();
      const { unmount } = renderHook(() => useSourceTextPersistence(doc, 'proj-1'));
      act(() => writeEntry(doc));
      expect(stored()).toBeNull();
      unmount();
      expect(stored()).not.toBeNull();
    });
  });
});
