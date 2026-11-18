/**
 * Multi-select Design Bar gate: when extras exist the bar renders the editable
 * multi panel (multi/MultiDesignPanel — design docs/plans/2026-11-16-multi-select-edit-design.md)
 * for EVERY member, primary first, and no tab strip (C2). The gate sits ABOVE the
 * descriptor path (deriveSelectionDescriptor untouched). Harness mirrors
 * DesignBar.layoutSelection.test.tsx (stubbed blocks/contexts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import type { MultiSelectionEntry } from '@/context/SelectionContext';

const PAGE_ID = 'page-1';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  key: null as string | null,
  extras: [] as Array<{ key: string; elementId: string | null }>,
  dispatch: vi.fn(),
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useDispatch: () => h.dispatch,
}));

vi.mock('@/context/SelectionContext', () => {
  const scan = () => ({ scannedByKey: new Map() });
  return ({
  useSelectedElement: () => ({
    key: h.key,
    sourceLocation: null,
    tagName: 'section',
    classes: '',
    computedStyles: null,
    parentDisplay: null,
    linkHref: null, linkTarget: null, linkAriaLabel: null,
    imageSrc: null, imageAlt: null, imagePreviewDataUrl: null,
    postSlug: null,
    hasSelection: h.key !== null,
    isEditingText: false,
  }),
  useSelectionContext: () => ({
    additionalSelections: h.extras,
  }),
  useTextSelection: () => ({
    hasTextSelection: false, isInsideLink: false,
    isLinkInteracting: false, setLinkInteracting: vi.fn(),
  }),
  useScannedElements: scan,
  useScannedElementsRef: () => ({ scannedByKeyRef: { current: scan().scannedByKey } }),
});
});

vi.mock('@/context/ClassStoreContext', () => ({
  useClassStore: () => ({ setClasses: vi.fn(), getClassesFromYjs: () => '' }),
  useElementClasses: () => '',
}));
vi.mock('@/context/StateContext', () => ({
  useActiveState: () => ({ activeState: 'default', isEditingState: false }),
}));
vi.mock('@/context/BreakpointContext', () => ({
  useActiveBreakpoint: () => ({ activeBreakpoint: 'xs', isEditingBreakpoint: false }),
  PRIMARY_BREAKPOINT: 'xs',
}));
vi.mock('@/context/ThemeContext', () => ({
  useActiveTheme: () => ({ activeTheme: 'light', isEditingDark: false }),
}));
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: vi.fn() }),
}));
vi.mock('@/context/PostEditorContext', () => ({
  usePostEditor: () => ({ openPost: vi.fn(), previewPost: vi.fn() }),
}));
vi.mock('@/hooks/useSourceHtml', () => ({
  useSourceHtml: () => ({ sourceHtml: '', refetchSourceHtml: vi.fn(), setSourceHtml: vi.fn() }),
}));
vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({ builtIn: [], userProject: [], refresh: vi.fn() }),
}));
vi.mock('@/hooks/useBlogSlotContext', () => ({
  useBlogSlotContext: () => ({ isInsideBlogSlot: false, blogSlotKey: null }),
}));
vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [], isLoading: false, error: null, refresh: () => {} }),
}));

vi.mock('@/assets/icons', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) out[k] = () => null;
  return out;
});

vi.mock('../blocks/LayoutAppearanceBlock', () => ({ LayoutAppearanceBlock: () => null }));
vi.mock('../blocks/PositionBlock', () => ({ PositionBlock: () => null }));
vi.mock('../blocks/TypographyBlock', () => ({ TypographyBlock: () => null }));
vi.mock('../blocks/SpacingBlock', () => ({ SpacingBlock: () => null }));
vi.mock('../blocks/AppearanceBlock', () => ({ AppearanceBlock: () => null }));
vi.mock('../blocks/FillBlock', () => ({ FillBlock: () => null }));
vi.mock('../blocks/StrokeBlock', () => ({ StrokeBlock: () => null }));
vi.mock('../blocks/EffectsBlock', () => ({ EffectsBlock: () => null }));
vi.mock('../blocks/LinkBlock', () => ({ LinkBlock: () => null }));
vi.mock('../blocks/SlotBlock', () => ({ SlotBlock: () => null }));
vi.mock('../blocks/SlotTargetBlock', () => ({ SlotTargetBlock: () => null }));
vi.mock('../blocks/ImageBlock', () => ({ ImageBlock: () => null }));
vi.mock('../inputs/ContentFieldPicker', () => ({ ContentFieldPicker: () => null }));
vi.mock('../tabs/index', () => ({ ClassesTab: () => null, SourceTab: () => null }));
vi.mock('../multi/MultiDesignPanel', () => ({
  MultiDesignPanel: (p: { memberKeys: string[]; slot: { breakpoint: string } }) =>
    <div data-testid="multi-select-panel" data-breakpoint={p.slot.breakpoint}>{p.memberKeys.join(',')}</div>,
}));
vi.mock('../BlockOverridePills', async (orig) => {
  const actual = await orig<typeof import('../BlockOverridePills')>();
  return { ...actual, BlockOverridePills: () => null };
});

import { DesignBar } from '../DesignBar';

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

describe('DesignBar — multi-select gate', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.key = null;
    h.extras = [];
    h.dispatch.mockClear();
  });

  it('renders the multi panel for every member (primary first) and nothing else when extras exist', () => {
    h.key = 'Hero.astro:5:1';
    h.extras = [
      { key: 'Card.astro:9:1', elementId: null },
      { key: 'el-b', elementId: 'el-b' },
    ] as MultiSelectionEntry[];
    render(<DesignBar />);

    const panel = screen.getByTestId('multi-select-panel');
    expect(panel).toHaveTextContent('Hero.astro:5:1,Card.astro:9:1,el-b');
    expect(panel.getAttribute('data-breakpoint')).toBe('xs');
    // No tab strip, no block stack, no editing affordances.
    expect(screen.queryByText('Design')).not.toBeInTheDocument();
    expect(screen.queryByText('Classes')).not.toBeInTheDocument();
    expect(screen.queryByText('Source')).not.toBeInTheDocument();
  });

  it('renders the existing single-selection UI when there are no extras', () => {
    h.key = 'Hero.astro:5:1';
    render(<DesignBar />);

    expect(screen.queryByTestId('multi-select-panel')).not.toBeInTheDocument();
    // Full tab strip = the normal element chrome.
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Classes')).toBeInTheDocument();
  });
});
