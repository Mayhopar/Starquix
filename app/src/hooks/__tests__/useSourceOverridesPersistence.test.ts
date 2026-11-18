import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  serializeSourceClasses,
  serializeSourceImageAttrs,
  restoreSourceClasses,
  restoreSourceImageAttrs,
  useSourceClassesPersistence,
  useSourceImageAttrsPersistence,
  KEY_SCHEME,
} from '../useSourceOverridesPersistence';
import {
  setLocalExpectedRoute,
  setLocalPageFile,
  _resetLocalPageSyncForTests,
} from '@/utils/localPageSync';

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

function addClassEntry(doc: Y.Doc, key: string, classes: string, edited: boolean): void {
  doc.transact(() => {
    const yEntry = new Y.Map();
    yEntry.set('classes', classes);
    if (edited) yEntry.set('edited', true);
    doc.getMap('sourceClasses').set(key, yEntry);
  });
}

function addImageEntry(doc: Y.Doc, key: string, attrs: Record<string, unknown>): void {
  doc.transact(() => {
    const yEntry = new Y.Map();
    for (const [attr, value] of Object.entries(attrs)) yEntry.set(attr, value);
    doc.getMap('sourceImageAttributes').set(key, yEntry);
  });
}

/**
 * task-173: stored blobs are ENVELOPES stamped with the tagger key-scheme
 * generation. Seeds here are current-generation; the refusal to apply an older
 * one (and the set-aside bucket that keeps it) is pinned in
 * __tests__/keySchemeSetAside.test.ts.
 */
const blob = (entries: unknown) => JSON.stringify({ keyScheme: KEY_SCHEME, entries });
const envelope = (entries: unknown) => ({ keyScheme: KEY_SCHEME, entries });

beforeEach(() => localStorage.clear());

describe('serializeSourceClasses', () => {
  it('keeps only edited bare-source entries', () => {
    const doc = new Y.Doc();
    addClassEntry(doc, 'src/pages/index.astro:5:1', 'p-4 bg-red-500', true);
    addClassEntry(doc, 'src/pages/index.astro:9:3', 'mx-auto', false); // registered, unedited → excluded
    addClassEntry(doc, 'drawn-abc123', 'p-2', true);                  // drawn → own persistence tier
    addClassEntry(doc, 'el-xyz:p-0', 'p-8', true);                    // instance-child → excluded
    expect(serializeSourceClasses(doc)).toEqual({
      'src/pages/index.astro:5:1': { classes: 'p-4 bg-red-500' },
    });
  });

  it('returns {} for an empty map', () => {
    expect(serializeSourceClasses(new Y.Doc())).toEqual({});
  });
});

describe('serializeSourceImageAttrs', () => {
  it('keeps source-kind entries and drops non-string values', () => {
    const doc = new Y.Doc();
    addImageEntry(doc, 'src/pages/index.astro:12:5', { src: '/img/a.png', alt: 'A', loading: 'lazy' });
    addImageEntry(doc, 'src/pages/index.astro:20:1', { width: 100 }); // only non-string → excluded entirely
    addImageEntry(doc, 'drawn-img-1', { src: '/img/b.png' });         // drawn → excluded
    addImageEntry(doc, 'el-xyz:img-0', { src: '/img/c.png' });        // instance-child → excluded
    expect(serializeSourceImageAttrs(doc)).toEqual({
      'src/pages/index.astro:12:5': { src: '/img/a.png', alt: 'A', loading: 'lazy' },
    });
  });

  it('returns {} for an empty map', () => {
    expect(serializeSourceImageAttrs(new Y.Doc())).toEqual({});
  });
});

describe('restoreSourceClasses', () => {
  it('round-trips: serialize → localStorage → restore into a fresh doc', () => {
    const doc = new Y.Doc();
    addClassEntry(doc, 'src/pages/index.astro:5:1', 'p-4 bg-red-500', true);
    localStorage.setItem('sq:source-classes:proj-1', blob(serializeSourceClasses(doc)));

    const fresh = new Y.Doc();
    restoreSourceClasses(fresh, 'proj-1');
    const entry = fresh.getMap('sourceClasses').get('src/pages/index.astro:5:1') as Y.Map<unknown>;
    expect(entry?.get('classes')).toBe('p-4 bg-red-500');
    expect(entry?.get('edited')).toBe(true);
    const loc = entry?.get('sourceLocation') as Y.Map<unknown>;
    expect(loc?.get('file')).toBe('src/pages/index.astro');
    expect(loc?.get('line')).toBe(5);
    expect(loc?.get('column')).toBe(1);
  });

  it('never clobbers an existing entry', () => {
    localStorage.setItem('sq:source-classes:proj-1', blob({
      'src/pages/index.astro:5:1': { classes: 'stale persisted' },
    }));
    const doc = new Y.Doc();
    addClassEntry(doc, 'src/pages/index.astro:5:1', 'fresh in-session', true);
    restoreSourceClasses(doc, 'proj-1');
    const entry = doc.getMap('sourceClasses').get('src/pages/index.astro:5:1') as Y.Map<unknown>;
    expect(entry?.get('classes')).toBe('fresh in-session');
  });

  it('ignores non-source keys and malformed JSON without throwing', () => {
    localStorage.setItem('sq:source-classes:proj-1', blob({
      'drawn-abc': { classes: 'nope' },
      'el-xyz:p-0': { classes: 'nope' },
    }));
    const doc = new Y.Doc();
    restoreSourceClasses(doc, 'proj-1');
    expect(doc.getMap('sourceClasses').size).toBe(0);

    localStorage.setItem('sq:source-classes:proj-2', '{not json');
    const doc2 = new Y.Doc();
    expect(() => restoreSourceClasses(doc2, 'proj-2')).not.toThrow();
    expect(doc2.getMap('sourceClasses').size).toBe(0);
  });
});

describe('restoreSourceClasses blob sanitizer', () => {
  it('strips dead blob: tokens from persisted entries, keeps sq-asset tokens', () => {
    localStorage.setItem(
      'sq:source-classes:proj1',
      blob({
        'src/pages/index.astro:5:1': { classes: "p-4 bg-[url('blob:http://x/dead')]" },
        'src/pages/index.astro:9:3': { classes: "mx-auto bg-[url('sq-asset:aaa111')]" },
      }),
    );
    const doc = new Y.Doc();
    restoreSourceClasses(doc, 'proj1');
    const map = doc.getMap('sourceClasses');
    expect((map.get('src/pages/index.astro:5:1') as Y.Map<unknown>).get('classes')).toBe('p-4');
    expect((map.get('src/pages/index.astro:9:3') as Y.Map<unknown>).get('classes'))
      .toBe("mx-auto bg-[url('sq-asset:aaa111')]");
  });
});

describe('restoreSourceImageAttrs', () => {
  it('round-trips: serialize → localStorage → restore into a fresh doc', () => {
    const doc = new Y.Doc();
    addImageEntry(doc, 'src/pages/index.astro:12:5', { src: '/img/a.png', alt: 'A' });
    localStorage.setItem('sq:source-images:proj-1', blob(serializeSourceImageAttrs(doc)));

    const fresh = new Y.Doc();
    restoreSourceImageAttrs(fresh, 'proj-1');
    const entry = fresh.getMap('sourceImageAttributes').get('src/pages/index.astro:12:5') as Y.Map<unknown>;
    expect(entry?.get('src')).toBe('/img/a.png');
    expect(entry?.get('alt')).toBe('A');
  });

  it('never clobbers an existing entry', () => {
    localStorage.setItem('sq:source-images:proj-1', blob({
      'src/pages/index.astro:12:5': { src: '/img/stale.png' },
    }));
    const doc = new Y.Doc();
    addImageEntry(doc, 'src/pages/index.astro:12:5', { src: '/img/fresh.png' });
    restoreSourceImageAttrs(doc, 'proj-1');
    const entry = doc.getMap('sourceImageAttributes').get('src/pages/index.astro:12:5') as Y.Map<unknown>;
    expect(entry?.get('src')).toBe('/img/fresh.png');
  });

  it('ignores non-source keys and drops non-string values', () => {
    localStorage.setItem('sq:source-images:proj-1', blob({
      'drawn-abc': { src: '/img/nope.png' },
      'src/pages/index.astro:12:5': { src: '/img/a.png', width: 100 },
      'src/pages/index.astro:20:1': { width: 100 }, // nothing string → never created
    }));
    const doc = new Y.Doc();
    restoreSourceImageAttrs(doc, 'proj-1');
    const map = doc.getMap('sourceImageAttributes');
    expect(map.size).toBe(1);
    const entry = map.get('src/pages/index.astro:12:5') as Y.Map<unknown>;
    expect(entry?.get('src')).toBe('/img/a.png');
    expect(entry?.has('width')).toBe(false);

    localStorage.setItem('sq:source-images:proj-2', '{not json');
    expect(() => restoreSourceImageAttrs(new Y.Doc(), 'proj-2')).not.toThrow();
  });
});

describe('useSourceClassesPersistence (hook)', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => vi.useRealTimers());

  it('debounce-saves edited source entries to localStorage on Yjs change', () => {
    const doc = new Y.Doc();
    renderHook(() => useSourceClassesPersistence(doc, 'proj-1'));

    act(() => { addClassEntry(doc, 'src/pages/index.astro:5:1', 'p-4', true); });
    expect(localStorage.getItem('sq:source-classes:proj-1')).toBeNull(); // debounced

    act(() => { vi.advanceTimersByTime(350); });
    expect(JSON.parse(localStorage.getItem('sq:source-classes:proj-1')!)).toEqual(
      envelope({ 'src/pages/index.astro:5:1': { classes: 'p-4' } }),
    );
  });

  it('removes the storage item when the last edited entry disappears', () => {
    const doc = new Y.Doc();
    renderHook(() => useSourceClassesPersistence(doc, 'proj-1'));
    act(() => { addClassEntry(doc, 'src/pages/index.astro:5:1', 'p-4', true); });
    act(() => { vi.advanceTimersByTime(350); });
    expect(localStorage.getItem('sq:source-classes:proj-1')).not.toBeNull();

    act(() => { doc.getMap('sourceClasses').delete('src/pages/index.astro:5:1'); });
    act(() => { vi.advanceTimersByTime(350); });
    expect(localStorage.getItem('sq:source-classes:proj-1')).toBeNull();
  });

  it('does nothing when projectId is null', () => {
    const doc = new Y.Doc();
    renderHook(() => useSourceClassesPersistence(doc, null));
    act(() => { addClassEntry(doc, 'src/pages/index.astro:5:1', 'p-4', true); });
    act(() => { vi.advanceTimersByTime(350); });
    expect(localStorage.length).toBe(0);
  });
});

describe('useSourceImageAttrsPersistence (hook)', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => vi.useRealTimers());

  it('debounce-saves source image attrs to localStorage on Yjs change', () => {
    const doc = new Y.Doc();
    renderHook(() => useSourceImageAttrsPersistence(doc, 'proj-1'));

    act(() => { addImageEntry(doc, 'src/pages/index.astro:12:5', { src: '/img/a.png' }); });
    expect(localStorage.getItem('sq:source-images:proj-1')).toBeNull(); // debounced

    act(() => { vi.advanceTimersByTime(350); });
    expect(JSON.parse(localStorage.getItem('sq:source-images:proj-1')!)).toEqual(
      envelope({ 'src/pages/index.astro:12:5': { src: '/img/a.png' } }),
    );
  });

  it('removes the storage item when the last entry disappears', () => {
    const doc = new Y.Doc();
    renderHook(() => useSourceImageAttrsPersistence(doc, 'proj-1'));
    act(() => { addImageEntry(doc, 'src/pages/index.astro:12:5', { src: '/img/a.png' }); });
    act(() => { vi.advanceTimersByTime(350); });
    expect(localStorage.getItem('sq:source-images:proj-1')).not.toBeNull();

    act(() => { doc.getMap('sourceImageAttributes').delete('src/pages/index.astro:12:5'); });
    act(() => { vi.advanceTimersByTime(350); });
    expect(localStorage.getItem('sq:source-images:proj-1')).toBeNull();
  });
});

/**
 * Owner ruling 2026-08-03: local mode must behave EXACTLY like WC. In WC an
 * edit to an element a component rendered onto the page is a doc overlay that
 * persists here and re-applies on the next scan. A local-only exclusion once
 * skipped those entries so the edit vanished on reload — this is the guard.
 */
describe('local mode uses the SAME overlay persistence as WC', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetLocalPageSyncForTests();
  });
  afterEach(() => _resetLocalPageSyncForTests());

  it('persists an edit to an element that lives in a COMPONENT, not the page file', () => {
    setLocalExpectedRoute('/about');          // local mode armed
    setLocalPageFile('src/pages/about.astro'); // current surface
    const doc = new Y.Doc();
    addClassEntry(doc, 'src/components/Header.astro:7:3', 'text-red-500', true);
    addImageEntry(doc, 'src/components/Header.astro:9:5', { src: '/img/logo.png' });

    expect(serializeSourceClasses(doc)).toEqual({
      'src/components/Header.astro:7:3': { classes: 'text-red-500' },
    });
    expect(serializeSourceImageAttrs(doc)).toEqual({
      'src/components/Header.astro:9:5': { src: '/img/logo.png' },
    });
  });
});
