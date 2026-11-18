/**
 * Blog slot rows are slots — cyan icon, like layout slots.
 *
 * The scanner labels the instance-path blog slot wrapper
 * (data-blog-source="posts") as tagName 'Blog Slot'. getElementIcon already
 * picks the slot icon for tagNames starting with 'blog'; the icon COLOR chain
 * must agree — a 'Blog Slot' row reads cyan, not the grey fallthrough.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import * as Y from 'yjs';
import type { ScannedElement } from '@/context/SelectionContext';

const PAGE_ID = 'page-1';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  scanned: [] as unknown[],
  expanded: new Set<string>(),
  selectedKey: null as string | null,
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useDispatch: () => vi.fn(),
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useScopedYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useCurrentPageId: () => (h.doc as Y.Doc).getMap("meta").get("currentPageId"),
  useProjectId: () => (h.doc as Y.Doc).getMap("meta").get("projectId") ?? null,
}));

vi.mock('@/context/SelectionContext', async (orig) => {
  const actual = await orig<typeof import('@/context/SelectionContext')>();
  return {
    ...actual,
    useScannedElementsRef: () => ({ scannedByKeyRef: { current: new Map(h.scanned.map(e => [(e as ScannedElement).key, e])) } }),
    useScannedElements: () => ({
      scannedElements: h.scanned,
      scannedByKey: new Map(h.scanned.map((e) => [(e as ScannedElement).key, e])),
      expandedNodes: h.expanded,
      toggleExpand: vi.fn(),
    }),
    useSelectionContext: () => ({
      selectedKey: h.selectedKey,
      select: vi.fn(),
      enterContext: vi.fn(),
      reparentDragKey: null,
      setReparentDragKey: vi.fn(),
      additionalSelections: [],
      addAdditionalSelection: vi.fn(),
      removeAdditionalSelection: vi.fn(),
      clearAdditionalSelections: vi.fn(),
    }),
  };
});

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: vi.fn() }),
}));

vi.mock('@/ai/AIContext', () => ({
  useAI: () => ({ activeKeys: [], recentlyTouchedKeys: [] }),
}));

vi.mock('@/context', () => ({
  useTool: () => ({ activeTool: 'select' }),
}));

vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

// Real icon exports are data-URL SVG imports (invalid as JSX element names in
// jsdom). The locally-defined SlotIcon in ElementsTree still renders real SVG,
// so the cyan accent class stays observable.
vi.mock('@/assets/icons', () => {
  const Stub = ({ className }: { className?: string }) => <span className={className} />;
  return {
    ComponentIcon: Stub,
    ContainerIcon: Stub,
    LayerTextIcon: Stub,
    LayerImageIcon: Stub,
    LayerLinkIcon: Stub,
    ChevronTreeIcon: Stub,
    SparkleIcon: Stub,
    PenPathIcon: Stub,
    SlotIcon: Stub,
    ContainerFlexRowIcon: Stub,
    ContainerFlexColumnIcon: Stub,
    ContainerFlexRowReverseIcon: Stub,
    ContainerFlexColumnReverseIcon: Stub,
    ContainerGridRowIcon: Stub,
    ContainerGridColumnIcon: Stub,
  };
});

import { ElementsTree } from '../ElementsTree';

function scanned(partial: Partial<ScannedElement> & { key: string; tagName: string }): ScannedElement {
  return {
    classes: '',
    rect: { top: 0, left: 0, width: 100, height: 100 },
    parentKey: null,
    hasSourceTracking: true,
    ...partial,
  } as ScannedElement;
}

function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', PAGE_ID);
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(PAGE_ID, yPage);
  }, 'sync');
  return doc;
}

describe('ElementsTree — blog slot icon color', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.expanded = new Set();
    h.selectedKey = null;
    h.scanned = [
      // Instance-path blog slot wrapper, as labeled by the scanner.
      scanned({ key: 'el-1:div-0', tagName: 'Blog Slot', hasSourceTracking: false }),
      // Filled layout slot (cyan control — pre-existing behavior).
      scanned({ key: 'layoutchrome-page-1:slot-0', tagName: 'div', slotName: '', hasSourceTracking: false }),
      // Plain container (no accent control).
      scanned({ key: 'Page.astro:9:1', tagName: 'div' }),
    ];
  });

  it("a 'Blog Slot' row gets the cyan slot accent, like layout slots", () => {
    const { container } = render(
      <DndContext>
        <ElementsTree />
      </DndContext>,
    );

    const blogRow = container.querySelector('[data-layer-key="el-1:div-0"]');
    expect(blogRow, 'blog slot row must render').not.toBeNull();
    expect(blogRow!.querySelector('.text-slot'), 'blog slot icon must be cyan').not.toBeNull();

    const layoutSlotRow = container.querySelector('[data-layer-key="layoutchrome-page-1:slot-0"]');
    expect(layoutSlotRow!.querySelector('.text-slot'), 'layout slot stays cyan').not.toBeNull();

    const plainRow = container.querySelector('[data-layer-key="Page.astro:9:1"]');
    expect(plainRow!.querySelector('.text-slot'), 'plain div has no slot accent').toBeNull();
  });
});
