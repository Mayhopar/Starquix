/**
 * DesignBar header state-pills (task-004). On a plain element selection the
 * element header now renders the HeaderTags pill cluster, and the three old
 * selector ROWS (Breakpoint/Theme/State segmented controls) are GONE. Driven by
 * the element classes ('dark:text-white' → a `dark` pill). Heavy block/context
 * tree stubbed exactly like DesignBar.elementSections.test.tsx.
 */
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { db } from '@/db';
import { setLocalTransport } from '@/utils/sqLocalBase';
import { ClassStoreProvider, useClassStore } from '@/context/ClassStoreContext';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';

const PAGE_ID = 'page-1';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  key: 'Hero.astro:5:1' as string | null,
  tagName: 'div' as string,
  dispatch: vi.fn(),
  realClasses: false,
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useDispatch: () => h.dispatch,
}));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));

vi.mock('@/context/SelectionContext', () => {
  const scan = () => ({ scannedByKey: new Map() });
  return ({
  useSelectedElement: () => ({
    key: h.key,
    sourceLocation: null,
    tagName: h.tagName,
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

vi.mock('@/context/ClassStoreContext', async (original) => {
  const actual = await original<typeof import('@/context/ClassStoreContext')>();
  return { ...actual,
    useClassStore: () => h.realClasses ? actual.useClassStore() : ({ setClasses: vi.fn(), getClassesFromYjs: () => 'dark:text-white' }),
    useElementClasses: (key: string) => h.realClasses ? actual.useElementClasses(key) : 'dark:text-white',
  };
});
// Full context shapes — HeaderTags/PrefixTag read setters + viewportBreakpoint.
vi.mock('@/context/StateContext', () => ({
  useActiveState: () => ({ activeState: 'default', setActiveState: vi.fn(), isEditingState: false }),
}));
vi.mock('@/context/BreakpointContext', () => ({
  useActiveBreakpoint: () => ({ activeBreakpoint: 'xs', setActiveBreakpoint: vi.fn(), viewportBreakpoint: 'xs', isEditingBreakpoint: false }),
  PRIMARY_BREAKPOINT: 'xs',
}));
vi.mock('@/context/ThemeContext', () => ({
  useActiveTheme: () => ({ activeTheme: 'light', setActiveTheme: vi.fn(), isEditingDark: false }),
}));
vi.mock('@/context/UndoContext', async (original) => {
  const actual = await original<typeof import('@/context/UndoContext')>();
  return { ...actual, useUndoContext: () => h.realClasses ? actual.useUndoContext() : ({ takeSnapshot: vi.fn() }) };
});
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

vi.mock('../blocks/PositionBlock', () => ({ PositionBlock: () => <div data-testid="sec-position" /> }));
vi.mock('../blocks/AppearanceBlock', () => ({ AppearanceBlock: () => <div data-testid="sec-appearance" /> }));
vi.mock('../blocks/LayoutAppearanceBlock', () => ({ LayoutAppearanceBlock: () => <div data-testid="sec-layout" /> }));
vi.mock('../blocks/SpacingBlock', () => ({ SpacingBlock: () => <div data-testid="sec-spacing" /> }));
vi.mock('../blocks/TypographyBlock', () => ({ TypographyBlock: () => <div data-testid="sec-typography" /> }));
vi.mock('../blocks/ImageBlock', () => ({ ImageBlock: () => <div data-testid="sec-image" /> }));
vi.mock('../blocks/FillBlock', () => ({ FillBlock: () => <div data-testid="sec-fill" /> }));
vi.mock('../blocks/StrokeBlock', () => ({ StrokeBlock: () => <div data-testid="sec-stroke" /> }));
vi.mock('../blocks/EffectsBlock', () => ({ EffectsBlock: () => <div data-testid="sec-effects" /> }));
vi.mock('../blocks/LinkBlock', () => ({ LinkBlock: () => <div data-testid="sec-link" /> }));
vi.mock('../blocks/SlotBlock', () => ({ SlotBlock: () => null }));
vi.mock('../blocks/SlotTargetBlock', () => ({ SlotTargetBlock: () => null }));
vi.mock('../inputs/ContentFieldPickerPair', () => ({ ContentFieldPickerPair: () => null }));
vi.mock('../tabs/index', () => ({ ClassesTab: () => null, SourceTab: () => null }));
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

describe('DesignBar — header state-pills replace the 3 selector rows', () => {
  beforeEach(() => {
    h.realClasses = false;
    h.doc = buildDoc();
    h.tagName = 'div';
    h.key = 'Hero.astro:5:1';
    h.dispatch.mockClear();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('rejected variant deletion through DesignBar preserves redo and does not add an undo snapshot', async () => {
    vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
    h.realClasses = true; h.key = 'src/pages/index.astro:1:1';
    const doc = h.doc as Y.Doc; doc.getMap('meta').set('projectId', 'browser_variant_delete');
    setLocalTransport({ projectPath: 'wc://browser_variant_delete', fetch: async () => new Response('offline', { status: 503 }) });
    let controls!: { classes: ReturnType<typeof useClassStore>; undo: ReturnType<typeof useUndoContext> };
    function Probe() { controls = { classes: useClassStore(), undo: useUndoContext() }; return <DesignBar />; }
    render(<UndoProvider><ClassStoreProvider><Probe /></ClassStoreProvider></UndoProvider>);
    act(() => controls.classes.registerElement(h.key!, 'dark:text-white'));
    await act(async () => { await controls.classes.setClasses(h.key!, 'dark:text-black'); });
    await act(async () => { await controls.undo.undo(); });
    expect(controls.undo.canRedo).toBe(true);
    const reject = vi.fn(() => { throw new Error('deletion quota'); }); db.durableEdits.hook('creating', reject);
    try {
      fireEvent.click(screen.getByTitle('Remove all dark: classes'));
      await waitFor(() => expect(controls.classes.storageIssue?.message).toContain('deletion quota'));
    } finally { db.durableEdits.hook('creating').unsubscribe(reject); }
    expect(reject).toHaveBeenCalled();
    expect(controls.undo.canRedo).toBe(true);
    expect(controls.undo.canUndo).toBe(false);
    expect(controls.classes.getClassesFromYjs(h.key!)).toBe('dark:text-white');
  });

  it('renders a `dark` pill in the header for dark:text-white', () => {
    render(<DesignBar />);
    expect(screen.getByText('dark')).toBeInTheDocument();
  });

  it('the old Theme segmented control is gone', () => {
    render(<DesignBar />);
    expect(screen.queryByTitle('Light theme (no prefix)')).toBeNull();
  });

  it('the old State segmented control is gone', () => {
    render(<DesignBar />);
    expect(screen.queryByText('Default')).toBeNull();
  });
});
