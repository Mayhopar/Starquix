/**
 * Files-truth BlogSlot gate (task-240) — harness copied from
 * DesignBar.localComponentView.test.tsx.
 *
 * The owner's defect, verbatim: "system doesn't know what the user is editing,
 * master or instance. Master has all the same buttons as instance."
 *
 * Local mode edits a user component as a tiny real page — the injected
 * `/__sq_component_view/{file}` route (Editor.tsx). On that surface the element
 * IS the master: edits write the component file directly, so there is no
 * instance lifecycle. Server mode's master view already renders none of it
 * (ElementHeaderActions' `isComponentEditor ? null : …`), and the standing rule
 * is "the component editor has NO ⋮ menu — never re-add Push/Sync/Reset chrome".
 *
 * Local's component view could not be recognised: `currentPageId` stays a
 * normal page id (only the iframe ROUTE is overridden), and the selected key is
 * no help — on a component-only page every key is a component file too. So
 * DesignBar decided purely on `key.split(':')[0]`, `localComponentSource` came
 * back non-null on the master surface, and `↗` + the full `⋮` Push/Reset menu
 * rendered there — plus `*`, claiming a divergence that cannot exist.
 *
 * The fix makes local's component view set the SAME `isComponentEditor` the WC
 * component editor sets (selectionDescriptor.ts) rather than forking a second
 * gate. These tests pin both sides: the page view keeps the instance chrome,
 * the component view has none of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';

const PAGE_ID = 'page-1';
const P = '~p5e23e503da89f633';
const SLOT_FILE = 'src/components/BlogSlot.astro';
const CARD_FILE = 'src/components/BlogCard.astro';
/** The page element that PLACES `<BlogSlot/>`. */
const PAGE_KEY = 'src/pages/blog.astro:7:3';
/** BlogSlot's outermost element (the placement root). */
const ROOT_KEY = `${SLOT_FILE}:8:1${P}`;
/** The posts grid INSIDE BlogSlot (same file + placement → not a root). */
const INNER_KEY = `${SLOT_FILE}:9:3${P}`;
/** The BlogCard the slot fallback renders — its own placement root, other file. */
const CARD_KEY = `${CARD_FILE}:13:1~p1111111111111111`;
const RICH = 'text-2xl font-bold text-stone-800';

const h = vi.hoisted(() => ({
  selectedKey: '' as string,
  doc: null as unknown,
  localPath: '/Users/me/my-astro-site' as string | null,
  usage: { pages: [] as Array<{ pageId: string; label: string }>, overriddenPlacements: 0 },
  dispatch: vi.fn(),
  openPost: vi.fn(),
  postLinkPaths: null as readonly string[] | null,
}));

// The master view's usage affordance (ComponentUsageBadge) reads this hook; the
// hook itself is the ONE place the two runtimes' sources are joined and has its
// own tests. Default = "used nowhere", so every pre-existing case is untouched.
vi.mock('@/hooks/useComponentUsage', () => ({
  useComponentUsage: () => h.usage,
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useDispatch: () => h.dispatch,
}));

vi.mock('@/hooks/useLocalProjectPath', () => ({
  useLocalProjectPath: () => h.localPath,
}));

vi.mock('@/context/SelectionContext', () => {
  const scan = () => ({
    scannedByKey: new Map([
      [PAGE_KEY, { key: PAGE_KEY, classes: '', parentKey: null }],
      [ROOT_KEY, { key: ROOT_KEY, classes: RICH, parentKey: PAGE_KEY }],
      [INNER_KEY, { key: INNER_KEY, classes: RICH, parentKey: ROOT_KEY }],
      [CARD_KEY, { key: CARD_KEY, classes: RICH, parentKey: INNER_KEY }],
    ]),
  });
  return ({
  useSelectedElement: () => ({
    key: h.selectedKey,
    sourceLocation: { file: SLOT_FILE, line: 8, column: 1 },
    tagName: 'h2',
    classes: RICH,
    computedStyles: null,
    parentDisplay: null,
    linkHref: null, linkTarget: null, linkAriaLabel: null,
    imageSrc: null, imageAlt: null, imagePreviewDataUrl: null,
    postSlug: null,
    postLinkPaths: h.postLinkPaths,
    hasSelection: true,
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
  useClassStore: () => ({ setClasses: vi.fn(), getClassesFromYjs: () => RICH }),
  useElementClasses: () => RICH,
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
  usePostEditor: () => ({ openPost: h.openPost, previewPost: null }),
}));
vi.mock('@/hooks/useContentCollections', () => ({ useContentCollections: () => ({ collections: [{ name: 'works', posts: [{ slug: 'PetcubeTracker' }] }] }) }));
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

// The panel blocks are irrelevant here — only the header cluster is under test.
vi.mock('../blocks/TypographyBlock', () => ({ TypographyBlock: () => null }));
vi.mock('../blocks/PositionBlock', () => ({ PositionBlock: () => null }));
vi.mock('../blocks/AppearanceBlock', () => ({ AppearanceBlock: () => null }));
vi.mock('../blocks/LayoutAppearanceBlock', () => ({ LayoutAppearanceBlock: () => null }));
vi.mock('../blocks/SpacingBlock', () => ({ SpacingBlock: () => null }));
vi.mock('../blocks/ImageBlock', () => ({ ImageBlock: () => null }));
vi.mock('../blocks/FillBlock', () => ({ FillBlock: () => null }));
vi.mock('../blocks/StrokeBlock', () => ({ StrokeBlock: () => null }));
vi.mock('../blocks/EffectsBlock', () => ({ EffectsBlock: () => null }));
vi.mock('../blocks/LinkBlock', () => ({ LinkBlock: () => null }));
vi.mock('../blocks/SlotBlock', () => ({ SlotBlock: () => null }));
vi.mock('../blocks/SlotTargetBlock', () => ({ SlotTargetBlock: () => null }));
vi.mock('../inputs/ContentFieldPickerPair', () => ({ ContentFieldPickerPair: () => null }));
vi.mock('../tabs/index', () => ({ ClassesTab: () => null, SourceTab: () => null }));
vi.mock('../BlockOverridePills', async (orig) => {
  const actual = await orig<typeof import('../BlockOverridePills')>();
  return { ...actual, BlockOverridePills: () => null };
});

vi.mock('../blocks/BlogBindingBlock', () => ({ BlogBindingBlock: () => <div>blog-binding-block</div> }));

import { DesignBar } from '../DesignBar';
import { setLocalComponentViewFile } from '@/services/localComponentView';

function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', PAGE_ID);
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', '/blog');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(PAGE_ID, yPage);
  }, 'sync');
  return doc;
}

/**
 * Files-truth blog binding (task-240): a BlogSlot on a PAGE is a scanned
 * source element — no Yjs instance, so the doc-truth `isBlogSlot` gate never
 * fires. The Blog Settings block must show for the slot's placement ROOT on a
 * page, and for nothing else.
 */
describe('files-truth BlogSlot → Blog Settings (BlogBindingBlock)', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.localPath = '/Users/me/my-astro-site';
    h.dispatch.mockClear();
    setLocalComponentViewFile(null);
  });
  afterEach(() => setLocalComponentViewFile(null));

  it('the BlogSlot placement root on a page shows the block', () => {
    h.selectedKey = ROOT_KEY;
    render(<DesignBar />);
    expect(screen.getByText('blog-binding-block')).toBeTruthy();
  });

  it('an element INSIDE the slot does not', () => {
    h.selectedKey = INNER_KEY;
    render(<DesignBar />);
    expect(screen.queryByText('blog-binding-block')).toBeNull();
  });

  it('the BlogCard root inside the slot does not (its own placement, other file)', () => {
    h.selectedKey = CARD_KEY;
    render(<DesignBar />);
    expect(screen.queryByText('blog-binding-block')).toBeNull();
  });

  it('the BlogSlot MASTER (component view) does not — the binding lives on a page', () => {
    h.selectedKey = ROOT_KEY;
    setLocalComponentViewFile(SLOT_FILE);
    render(<DesignBar />);
    expect(screen.queryByText('blog-binding-block')).toBeNull();
  });

  it('non-local runtime: never', () => {
    h.selectedKey = ROOT_KEY;
    h.localPath = null;
    render(<DesignBar />);
    expect(screen.queryByText('blog-binding-block')).toBeNull();
  });
});
