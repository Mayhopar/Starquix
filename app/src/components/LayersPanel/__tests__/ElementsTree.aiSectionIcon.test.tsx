/**
 * AI-added plain sections are NOT components — grey icon, not purple.
 *
 * add_page_content creates Yjs elements with type 'frame' + staticMarkup and
 * no componentType. isMasterYjsEntry counts ANY staticMarkup carrier as a
 * master (that predicate predates the AI tool and also routes DesignBar
 * overrides — it must stay broad), so the Layers icon needs the narrower
 * isComponentYjsEntry: only real component markers (type component/instance,
 * slotType, componentType) get the purple component accent.
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

const ai = vi.hoisted(() => ({ touched: [] as string[] }));
vi.mock('@/ai/AIContext', () => ({
  useAI: () => ({ activeKeys: [], recentlyTouchedKeys: ai.touched }),
}));

vi.mock('@/context', () => ({
  useTool: () => ({ activeTool: 'select' }),
}));

vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => <span {...props} />;
  return {
    ComponentIcon: Stub,
    ContainerIcon: Stub,
    LayerTextIcon: Stub,
    LayerImageIcon: Stub,
    LayerLinkIcon: Stub,
    ChevronTreeIcon: Stub,
    SparkleIcon: Stub,
  };
});

import { ElementsTree } from '../ElementsTree';

const AI_ID = 'element-1783700000000-aaaaa';
const HERO_ID = 'el-hero-1';

function scanned(partial: Partial<ScannedElement> & { key: string; tagName: string }): ScannedElement {
  return {
    classes: '',
    rect: { top: 0, left: 0, width: 100, height: 100 },
    parentKey: null,
    hasSourceTracking: false,
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

    const elements = doc.getMap('elements');

    // AI add_page_content result: frame + staticMarkup, no componentType.
    const aiEl = new Y.Map();
    aiEl.set('id', AI_ID);
    aiEl.set('pageId', PAGE_ID);
    aiEl.set('parentId', null);
    aiEl.set('index', 0);
    aiEl.set('type', 'frame');
    aiEl.set('staticMarkup', `<section data-key="${AI_ID}:section-0" class="py-16"><p>Hi</p></section>`);
    elements.set(AI_ID, aiEl);

    // Picker component instance: type 'component' + componentType.
    const heroEl = new Y.Map();
    heroEl.set('id', HERO_ID);
    heroEl.set('pageId', PAGE_ID);
    heroEl.set('parentId', null);
    heroEl.set('index', 1);
    heroEl.set('type', 'component');
    heroEl.set('componentType', 'Hero');
    heroEl.set('staticMarkup', `<section data-key="${HERO_ID}:section-0" class="hero"></section>`);
    elements.set(HERO_ID, heroEl);
  }, 'sync');
  return doc;
}

describe('ElementsTree — AI plain sections are not purple', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.expanded = new Set();
    h.selectedKey = null;
    ai.touched = [];
    h.scanned = [
      scanned({ key: `${AI_ID}:section-0`, tagName: 'section' }),
      scanned({ key: `${HERO_ID}:section-0`, tagName: 'section' }),
    ];
  });

  it('an AI frame root (staticMarkup, no componentType) renders grey, a component root stays purple', () => {
    const { container } = render(
      <DndContext>
        <ElementsTree />
      </DndContext>,
    );

    const aiRow = container.querySelector(`[data-layer-key="${AI_ID}:section-0"]`);
    expect(aiRow, 'AI section row must render').not.toBeNull();
    expect(
      aiRow!.querySelector('.text-stroke-component'),
      'AI plain section must NOT get the purple component accent',
    ).toBeNull();

    const heroRow = container.querySelector(`[data-layer-key="${HERO_ID}:section-0"]`);
    expect(heroRow, 'Hero row must render').not.toBeNull();
    expect(
      heroRow!.querySelector('.text-stroke-component'),
      'real component instance root keeps the purple accent',
    ).not.toBeNull();
  });

  it('an AI-created section badges its ROOT row only, not every descendant', () => {
    // add_page_content records the bare elementId; the root and all children
    // share it via key prefix — only the subtree root may show the sparkle.
    ai.touched = [AI_ID];
    h.expanded = new Set([`${AI_ID}:section-0`]);
    h.scanned = [
      scanned({ key: `${AI_ID}:section-0`, tagName: 'section' }),
      scanned({ key: `${AI_ID}:p-0`, tagName: 'p', parentKey: `${AI_ID}:section-0` }),
      scanned({ key: `${HERO_ID}:section-0`, tagName: 'section' }),
    ];

    const { container } = render(
      <DndContext>
        <ElementsTree />
      </DndContext>,
    );

    const badge = (key: string) =>
      container.querySelector(`[data-layer-key="${key}"]`)?.querySelector('[data-ai-badge]') ?? null;

    expect(badge(`${AI_ID}:section-0`), 'AI-created section root must carry the sparkle badge').not.toBeNull();
    expect(badge(`${AI_ID}:p-0`), 'descendants of the AI section must NOT each sparkle').toBeNull();
    expect(badge(`${HERO_ID}:section-0`), 'untouched component shows no badge').toBeNull();
  });
});
