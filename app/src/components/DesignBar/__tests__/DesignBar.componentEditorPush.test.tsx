/**
 * Component-editor header has NO source-sync chrome. In __component-editor mode
 * you ARE the source (edits auto-flush after 800ms in LeftSidebar), so the header
 * shows NO ⋮ menu — no "Push changes to source", no "Reset to master", no Sync.
 * Asking to push-to-source while editing the source is nonsense.
 *
 * Like DesignBar.layoutSelection.test.tsx we stub the heavy child blocks and
 * contexts, leaving DesignBar's own routing real — InstanceMenu renders REAL so
 * its absence is meaningful.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  key: null as string | null,
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
  useSelectionContext: () => ({ additionalSelections: [] }),
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

vi.mock('@/assets/icons', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) out[k] = () => null;
  return out;
});

// Child blocks/selectors stubbed. InstanceMenu renders REAL (it's the thing the
// test clicks), so it is NOT mocked here.
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
vi.mock('../BlockOverridePills', async (orig) => {
  const actual = await orig<typeof import('../BlockOverridePills')>();
  return { ...actual, BlockOverridePills: () => null };
});

import { DesignBar } from '../DesignBar';

function buildDoc(withOverrides: boolean): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', COMPONENT_EDITOR_PAGE_ID);
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', COMPONENT_EDITOR_PAGE_ID);
    yPage.set('name', 'Component');
    const roots = new Y.Array<string>();
    roots.push(['el-root']);
    yPage.set('rootElementIds', roots);
    yPage.set('children', new Y.Array());
    pages.set(COMPONENT_EDITOR_PAGE_ID, yPage);

    const elements = doc.getMap('elements');
    const el = new Y.Map();
    el.set('id', 'el-root');
    el.set('pageId', COMPONENT_EDITOR_PAGE_ID);
    el.set('parentId', null);
    el.set('staticMarkup', '<section>hi</section>');
    if (withOverrides) {
      const deletedSelectors = new Y.Array<string>();
      deletedSelectors.push(['section-0']);
      el.set('deletedSelectors', deletedSelectors);
    }
    elements.set('el-root', el);
  }, 'sync');
  return doc;
}

describe('DesignBar — component-editor has NO push/reset chrome', () => {
  beforeEach(() => {
    h.key = 'el-root';
    h.dispatch.mockClear();
  });

  it('shows NO ⋮ menu in the editor even when the element has overrides', () => {
    h.doc = buildDoc(true); // dirty
    render(<DesignBar />);
    expect(screen.queryByTitle('Component options')).toBeNull();
    expect(screen.queryByText('Push changes to source')).toBeNull();
    expect(screen.queryByText('Reset to master')).toBeNull();
  });

  it('shows NO ⋮ menu in the editor when the element is clean', () => {
    h.doc = buildDoc(false);
    render(<DesignBar />);
    expect(screen.queryByTitle('Component options')).toBeNull();
    expect(screen.queryByText('Push changes to source')).toBeNull();
  });
});
