/**
 * Pen/shape elements (pen tool, shape tools, converted svgs) read as "shape"
 * in Layers — not their wrapper tag "div" (2026-07-24 UX fix).
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
    // drawn pen element (as ADD_DRAWN_ELEMENT stores it)
    const elements = doc.getMap('elements');
    const pen = new Y.Map();
    pen.set('id', 'drawn-1-pen');
    pen.set('pageId', PAGE_ID);
    pen.set('penPath', '{"anchors":[{"x":0,"y":0,"corner":true},{"x":10,"y":10,"corner":true}],"closed":false}');
    elements.set('drawn-1-pen', pen);
  }, 'sync');
  return doc;
}

describe('ElementsTree — pen shape rows read as "shape"', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.expanded = new Set();
    h.selectedKey = null;
    h.scanned = [
      scanned({ key: 'drawn-1-pen', tagName: 'div', hasSourceTracking: false }),
      scanned({ key: 'el-2:div-0', tagName: 'div', hasSourceTracking: false }),
    ];
  });

  it('penPath row is labeled "shape"; plain div stays "div"', () => {
    const { container } = render(
      <DndContext>
        <ElementsTree />
      </DndContext>,
    );

    const penRow = container.querySelector('[data-layer-key="drawn-1-pen"]');
    expect(penRow, 'pen row must render').not.toBeNull();
    expect(penRow!.textContent).toContain('shape');
    expect(penRow!.textContent).not.toContain('div');

    const plainRow = container.querySelector('[data-layer-key="el-2:div-0"]');
    expect(plainRow!.textContent).toContain('div');
  });
});
