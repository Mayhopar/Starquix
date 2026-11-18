/**
 * Layout + slot model — the Layers tree is built straight from the iframe scan.
 * Chrome is now scanned (data-sq-chrome), so a content root whose parentKey is
 * the slot div's real key nests under that slot node automatically. There is NO
 * synthetic `layout:<name>` / `::slot:` node anymore — every node is a real
 * scanned element keyed by its data-key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { emptyClassData } from '@/store/types';
import type { ScannedElement } from '@/context/SelectionContext';

const PAGE_ID = 'page-1';

// Mutable holders the hoisted mocks read from.
const h = vi.hoisted(() => ({
  doc: null as unknown,
  scanned: [] as unknown[],
  expanded: new Set<string>(),
  selectedKey: null as string | null,
  selectSpy: (_key: string | null) => {},
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
      select: (k: string | null) => h.selectSpy(k),
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

vi.mock('@/assets/icons', () => {
  const Stub = () => null;
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

vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({
    layouts: [{ name: 'Marketing', path: '', absolutePath: '', props: [], slots: [], frontmatter: '', body: '' }],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import { ElementsTree } from '../ElementsTree';

function scannedRoot(key: string, tagName: string, componentName: string): ScannedElement {
  return {
    key,
    tagName,
    classes: '',
    rect: { top: 0, left: 0, width: 100, height: 100 },
    parentKey: null,
    hasSourceTracking: true,
    componentName,
  };
}

const SLOT_KEY = `layoutchrome-${PAGE_ID}:slot-0`;

/** A scanned chrome slot — a FILLED layout slot renders as a <div data-sq-slot>,
 *  but the scan stamps slotName so it keeps its "slot" identity. */
function scannedSlot(): ScannedElement {
  return {
    key: SLOT_KEY,
    tagName: 'div',
    classes: '',
    rect: { top: 0, left: 0, width: 200, height: 200 },
    parentKey: null,
    hasSourceTracking: false,
    slotName: '',
  };
}

/** A content root nested INSIDE the slot via parentKey. */
function scannedContent(key: string, componentName: string): ScannedElement {
  return {
    key,
    tagName: 'section',
    classes: '',
    rect: { top: 0, left: 0, width: 100, height: 100 },
    parentKey: SLOT_KEY,
    hasSourceTracking: true,
    componentName,
  };
}

function buildDoc(layoutName: string | null): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', PAGE_ID);
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    if (layoutName) yPage.set('layoutName', layoutName);
    pages.set(PAGE_ID, yPage);
  }, 'sync');
  return doc;
}

function renderTree() {
  return render(
    <DndContext>
      <ElementsTree />
    </DndContext>,
  );
}

describe('ElementsTree — layout/slot nest from the real scan', () => {
  beforeEach(() => {
    // Chrome slot div + a content root nested inside it via parentKey.
    h.scanned = [scannedSlot(), scannedContent('Hero.astro:1:1', 'Hero')];
    h.expanded = new Set([SLOT_KEY]); // expand the slot so its child renders
    h.selectedKey = null;
    h.selectSpy = vi.fn();
  });

  it('shows a Layout node (real key) wrapping slot ▸ content; no synthetic layout: key', () => {
    h.doc = buildDoc('Marketing');
    const { container } = renderTree();

    // A Layout node keyed on the REAL layout-chrome instance root, labelled with
    // the layout name — NOT the synthetic layout:<name> key.
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    expect(container.querySelector('[data-layer-key="layoutchrome-page-1"]')).not.toBeNull();
    expect(container.querySelector('[data-layer-key^="layout:"]')).toBeNull();

    // slot ▸ content nest beneath the Layout node, on real keys.
    const slotRow = container.querySelector(`[data-layer-key="${SLOT_KEY}"]`);
    const contentRow = container.querySelector('[data-layer-key="Hero.astro:1:1"]');
    expect(slotRow).not.toBeNull();
    expect(contentRow).not.toBeNull();
    expect(screen.getByText('Hero')).toBeInTheDocument();
    // A filled layout slot keeps its "slot" identity in Layers, not "div".
    expect(screen.getByText('slot')).toBeInTheDocument();
    expect(screen.queryByText('div')).not.toBeInTheDocument();
  });

  it('clicking the Layout node selects the REAL layout-chrome instance root key', () => {
    h.doc = buildDoc('Marketing');
    const spy = vi.fn();
    h.selectSpy = spy;
    const { container } = renderTree();

    const layoutRow = container.querySelector('[data-layer-key="layoutchrome-page-1"]') as HTMLElement;
    fireEvent.click(layoutRow.querySelector('[data-testid="layer-item"]') as HTMLElement);
    expect(spy).toHaveBeenCalledWith('layoutchrome-page-1');
    expect(spy).not.toHaveBeenCalledWith(expect.stringMatching(/^layout:/));
  });

  it('clicking the slot node selects its REAL key, not a layout:<name> key', () => {
    h.doc = buildDoc('Marketing');
    const spy = vi.fn();
    h.selectSpy = spy;
    const { container } = renderTree();

    const slotRow = container.querySelector(`[data-layer-key="${SLOT_KEY}"]`) as HTMLElement;
    // onClick lives on the inner TreeRow (data-testid="layer-item"), not the wrapper.
    fireEvent.click(slotRow.querySelector('[data-testid="layer-item"]') as HTMLElement);
    expect(spy).toHaveBeenCalledWith(SLOT_KEY);
    expect(spy).not.toHaveBeenCalledWith(expect.stringMatching(/^layout:/));
  });

  it('still renders flat content when the page has no layout', () => {
    h.scanned = [scannedRoot('Nav.astro:1:1', 'nav', 'Nav')];
    h.doc = buildDoc(null);
    renderTree();

    expect(screen.queryByText('Marketing')).not.toBeInTheDocument();
    expect(screen.getByText('Nav')).toBeInTheDocument();
  });
});
