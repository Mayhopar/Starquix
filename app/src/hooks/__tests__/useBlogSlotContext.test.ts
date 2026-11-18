/**
 * Regression: useBlogSlotContext only detected DRAWN BlogSlots
 * (isDrawn + slotType==='blog'). After task-028 turned BlogSlot into a
 * regular component instance (componentType==='BlogSlot'), the hook always
 * returned isInsideBlogSlot=false for the new shape — so DesignBar's
 * isPostRoot path (which requires isInsideBlogSlot) never lit up, and the
 * "Go to post" button never rendered when selecting a BlogCard.
 *
 * Mirrors the widening already applied to selectPageBlogCollectionIds
 * (selectors.ts) — both shapes must be detected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { renderHook } from '@testing-library/react';

let mockDoc: Y.Doc = new Y.Doc();
let mockSelection = { selectedKey: null as string | null, scannedElements: [] as Array<{ key: string; parentKey?: string | null }> };

vi.mock('@/store/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/store/hooks')>('@/store/hooks');
  return {
    ...actual,
    useEditorDoc: () => mockDoc,
    useYjsValue: <T,>(selector: (doc: Y.Doc) => T) => selector(mockDoc),
  };
});

vi.mock('@/context/SelectionContext', () => ({
  // The hook reads selection reactively and the scan via the ref context
  // (perf item 3 — DesignBar must not re-render on scans).
  useSelectedElement: () => ({ key: mockSelection.selectedKey }),
  useScannedElementsRef: () => ({
    scannedByKeyRef: {
      current: new Map(mockSelection.scannedElements.map((e) => [e.key, e])),
    },
  }),
}));

import { useBlogSlotContext } from '../useBlogSlotContext';

function setupDoc(slotKey: string, shape: 'drawn' | 'instance'): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const elements = doc.getMap('elements');
    const yEl = new Y.Map();
    if (shape === 'drawn') {
      yEl.set('isDrawn', true);
      yEl.set('slotType', 'blog');
    } else {
      yEl.set('isDrawn', false);
      yEl.set('componentType', 'BlogSlot');
    }
    elements.set(slotKey, yEl);
  });
  return doc;
}

beforeEach(() => {
  mockDoc = new Y.Doc();
  mockSelection = { selectedKey: null, scannedElements: [] };
});

describe('useBlogSlotContext — accepts both drawn-slot and instance shapes', () => {
  it('detects a legacy DRAWN BlogSlot when a descendant is selected', () => {
    mockDoc = setupDoc('drawn-blog-1', 'drawn');
    mockSelection = {
      selectedKey: 'el-card:h2-0',
      scannedElements: [
        { key: 'drawn-blog-1', parentKey: null },
        { key: 'drawn-blog-1:posts', parentKey: 'drawn-blog-1' },
        { key: 'el-card:article-0', parentKey: 'drawn-blog-1:posts' },
        { key: 'el-card:h2-0', parentKey: 'el-card:article-0' },
      ],
    };

    const { result } = renderHook(() => useBlogSlotContext());
    expect(result.current.isInsideBlogSlot).toBe(true);
    expect(result.current.blogSlotKey).toBe('drawn-blog-1');
  });

  it('detects a post-task-028 INSTANCE BlogSlot (componentType=BlogSlot) when a descendant is selected', () => {
    mockDoc = setupDoc('el-instance-blog', 'instance');
    mockSelection = {
      selectedKey: 'el-card:h2-0',
      scannedElements: [
        { key: 'el-instance-blog', parentKey: null },
        { key: 'el-instance-blog:posts', parentKey: 'el-instance-blog' },
        { key: 'el-card:article-0', parentKey: 'el-instance-blog:posts' },
        { key: 'el-card:h2-0', parentKey: 'el-card:article-0' },
      ],
    };

    const { result } = renderHook(() => useBlogSlotContext());
    expect(result.current.isInsideBlogSlot).toBe(true);
    expect(result.current.blogSlotKey).toBe('el-instance-blog');
  });

  it('detects a BlogSlot via the instance-child chain (real DOM hierarchy)', () => {
    // What actually appears in scannedElements: the DOM-derived parent chain
    // is a stack of instance-child keys (el-slot:section-0 → el-slot:div-0 →
    // el-slot:slot-0 → el-card:article-0). None of those instance-child keys
    // exist in the Yjs elements map — only the bare instance root 'el-slot'
    // does. The hook must resolve the root via parseKey to match.
    mockDoc = setupDoc('el-slot', 'instance');
    mockSelection = {
      selectedKey: 'el-card:article-0',
      scannedElements: [
        { key: 'el-slot:section-0', parentKey: null },
        { key: 'el-slot:div-0', parentKey: 'el-slot:section-0' },
        { key: 'el-slot:slot-0', parentKey: 'el-slot:div-0' },
        { key: 'el-card:article-0', parentKey: 'el-slot:slot-0' },
      ],
    };

    const { result } = renderHook(() => useBlogSlotContext());
    expect(result.current.isInsideBlogSlot).toBe(true);
    expect(result.current.blogSlotKey).toBe('el-slot');
  });

  it('returns false when nothing in the ancestor chain is a BlogSlot', () => {
    mockDoc = new Y.Doc();
    mockSelection = {
      selectedKey: 'el-card:h2-0',
      scannedElements: [
        { key: 'el-card:article-0', parentKey: null },
        { key: 'el-card:h2-0', parentKey: 'el-card:article-0' },
      ],
    };

    const { result } = renderHook(() => useBlogSlotContext());
    expect(result.current.isInsideBlogSlot).toBe(false);
    expect(result.current.blogSlotKey).toBeNull();
  });
});
