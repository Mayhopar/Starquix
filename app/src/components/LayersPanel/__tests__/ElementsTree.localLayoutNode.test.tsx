/**
 * Local-mode (files-truth) Layers parity — round-2 blind-judge S3/S4/S5:
 * applying a layout in a local project rewrites the page FILE, so the doc has
 * no layoutName. The layout-element paradigm (2026-08-24) covers the normal
 * case — the layout's scanned <body> row IS the Layout node — but a layout
 * that contributes nothing scannable (pure-slot fragment, or a scan that
 * landed before HMR re-tagged) leaves the scan blind. useLocalPageLayoutName
 * reads the truth from the page file bytes as the last-resort name source:
 * the tree must mint the synthetic Layout wrapper on it, and drop it when the
 * detection returns null (undo).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import * as Y from 'yjs';
import type { ScannedElement } from '@/context/SelectionContext';

const PAGE_ID = 'local_proj:/';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  scanned: [] as unknown[],
  expanded: new Set<string>(),
  localLayoutName: null as string | null,
  localPath: null as string | null,
  select: vi.fn(),
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useDispatch: () => vi.fn(),
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useScopedYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useCurrentPageId: () => (h.doc as Y.Doc).getMap("meta").get("currentPageId"),
  useProjectId: () => (h.doc as Y.Doc).getMap("meta").get("projectId") ?? null,
}));

vi.mock('@/hooks/useLocalProjectPath', () => ({
  useLocalProjectPath: () => h.localPath,
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
      expandNodes: vi.fn(),
    }),
    useSelectionContext: () => ({
      selectedKey: null,
      select: h.select,
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
  };
});

vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

// The seam under test: file-truth layout detection (fetch + detectPageLayout).
vi.mock('@/hooks/useLocalPageLayout', () => ({
  useLocalPageLayoutName: () => h.localLayoutName,
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

function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', PAGE_ID);
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', '/');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    // Files are truth: NO layoutName on the doc row in local mode.
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

const LAYOUT_KEY = `layoutchrome-${PAGE_ID}`;

describe('ElementsTree — local-mode Layout backstop from the page file', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.scanned = [
      scannedRoot('src/pages/index.astro:5:1', 'h1', ''),
      scannedRoot('src/pages/index.astro:6:1', 'p', ''),
    ];
    h.expanded = new Set([LAYOUT_KEY]);
    h.localLayoutName = null;
    h.localPath = null;
    h.select.mockClear();
  });

  it('wraps the scanned roots under a Layout node when only the page file carries the layout', () => {
    h.localLayoutName = 'Layout1';
    const { container } = renderTree();

    expect(screen.getByText('Layout1')).toBeInTheDocument();
    const layoutRow = container.querySelector(`[data-layer-key="${CSS.escape(LAYOUT_KEY)}"]`);
    expect(layoutRow).not.toBeNull();
    // The content roots still render (nested under the Layout node).
    expect(container.querySelector('[data-layer-key="src/pages/index.astro:5:1"]')).not.toBeNull();
    expect(container.querySelector('[data-layer-key="src/pages/index.astro:6:1"]')).not.toBeNull();
  });

  it('empty page: shows the Layout node, never the start-preview empty state (round-3 S1)', () => {
    h.localLayoutName = 'Layout1';
    h.scanned = [];
    const { container } = renderTree();

    expect(screen.queryByText('Start preview to see elements')).not.toBeInTheDocument();
    expect(screen.getByText('Layout1')).toBeInTheDocument();
    expect(container.querySelector(`[data-layer-key="${CSS.escape(LAYOUT_KEY)}"]`)).not.toBeNull();
  });

  it('scanned layout <body> wins: no synthetic node minted on top of the real row', () => {
    // Both signals present — the body row from src/layouts/ IS the Layout node
    // (layout-element paradigm); the file detection must not double-wrap.
    h.localPath = '/Users/x/proj';
    h.localLayoutName = 'Main';
    h.scanned = [
      {
        ...scannedRoot('src/layouts/Main.astro:37:2', 'body', ''),
        sourceLocation: { file: 'src/layouts/Main.astro', line: 37, column: 2 },
      },
      {
        ...scannedRoot('src/pages/index.astro:5:1', 'h1', ''),
        parentKey: 'src/layouts/Main.astro:37:2',
      },
    ];
    h.expanded = new Set(['src/layouts/Main.astro:37:2']);
    const { container } = renderTree();

    expect(container.querySelector(`[data-layer-key="${CSS.escape(LAYOUT_KEY)}"]`)).toBeNull();
    const bodyRow = container.querySelector(
      `[data-layer-key="${CSS.escape('src/layouts/Main.astro:37:2')}"]`,
    );
    expect(bodyRow).not.toBeNull();
    expect(bodyRow!.textContent).toContain('Main');
  });

  it('shows the flat roots with NO layout node when the file has no layout (and after undo)', () => {
    h.localLayoutName = null;
    const { container } = renderTree();

    expect(screen.queryByText('Layout1')).not.toBeInTheDocument();
    expect(container.querySelector(`[data-layer-key^="layoutchrome-"]`)).toBeNull();
    expect(container.querySelector('[data-layer-key="src/pages/index.astro:5:1"]')).not.toBeNull();
  });
});
