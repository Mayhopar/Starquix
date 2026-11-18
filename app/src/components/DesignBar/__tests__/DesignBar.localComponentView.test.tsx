/**
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
const FILE = 'src/components/Header.astro';
/** A placement-scoped key: what an element rendered BY <Header/> scans to. */
const KEY = `${FILE}:12:3~p5e23e503da89f633`;
const RICH = 'text-2xl font-bold text-stone-800';

const h = vi.hoisted(() => ({
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
    scannedByKey: new Map([[KEY, { key: KEY, classes: RICH, parentKey: null }]]),
  });
  return ({
  useSelectedElement: () => ({
    key: KEY,
    sourceLocation: { file: FILE, line: 12, column: 3 },
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

import { DesignBar } from '../DesignBar';
import { setLocalComponentViewFile } from '@/services/localComponentView';

/** A doc carrying one UNPUSHED instance edit on that component element. */
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

    const entry = new Y.Map();
    entry.set('classes', RICH);
    entry.set('edited', true); // only `edited` entries count as divergence
    const loc = new Y.Map();
    loc.set('file', FILE); loc.set('line', 12); loc.set('column', 3);
    entry.set('sourceLocation', loc);
    doc.getMap('sourceClasses').set(KEY, entry);
  }, 'sync');
  return doc;
}

/** DesignBarHeader's heading span (`data-testid="design-bar-heading"` — not a style class, so type tokens can change freely). */
const headingText = (container: HTMLElement) =>
  container.querySelector('[data-testid="design-bar-heading"]')?.textContent ?? '';

describe('local mode — master (component view) vs instance (page view) chrome', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.localPath = '/Users/me/my-astro-site';
    h.dispatch.mockClear();
    h.openPost.mockClear(); h.postLinkPaths = null;
    setLocalComponentViewFile(null);
  });
  afterEach(() => setLocalComponentViewFile(null));

  it('PAGE view: the element is an INSTANCE — ↗, ⋮ and * are all present', () => {
    const { container } = render(<DesignBar />);

    expect(screen.getByTitle('Go to source')).toBeTruthy();
    expect(screen.getByTitle('Component options')).toBeTruthy();
    expect(headingText(container)).toContain('*');
  });

  it('COMPONENT view: the element is the MASTER — no ↗, no ⋮, no *', () => {
    setLocalComponentViewFile(FILE); // Editor opened /__sq_component_view/…

    const { container } = render(<DesignBar />);

    expect(screen.queryByTitle('Component options')).toBeNull();
    expect(screen.queryByTitle('Go to source')).toBeNull();
    expect(headingText(container)).not.toContain('*');
  });

  it('leaving the component view restores the instance chrome (the store notifies)', () => {
    setLocalComponentViewFile(FILE);
    const { rerender } = render(<DesignBar />);
    expect(screen.queryByTitle('Component options')).toBeNull();

    setLocalComponentViewFile(null); // Editor cleared it on the page switch
    rerender(<DesignBar />);

    expect(screen.getByTitle('Component options')).toBeTruthy();
  });

  it('COMPONENT view is not a dead end — it states its uses and its overrides', () => {
    // Verbatim from the critic: "no affordance that leads back to a placement
    // that has diverged — no list of instances, no '3 uses', nothing."
    h.usage = {
      pages: [{ pageId: 'page-1', label: '/' }, { pageId: 'about', label: '/about' }],
      overriddenPlacements: 1,
    };
    setLocalComponentViewFile(FILE);

    render(<DesignBar />);

    expect(screen.getByText('2 uses · 1 overriding')).toBeTruthy();
    // Still no lifecycle chrome — the standing no-editor-chrome rule holds.
    expect(screen.queryByTitle('Component options')).toBeNull();
    h.usage = { pages: [], overriddenPlacements: 0 };
  });

  /**
   * GAP 3 (round-5 recording): "clicking the /about row navigates; clicking the
   * / row does nothing", tried twice, live.
   *
   * NOT a localPageId mapping bug — the doc seeding (`/__sq/local/pages`) and
   * the usage list (`/__sq/local/component-usages`) both derive their routes
   * from the SAME discoverLocalPages(), so `localPageId(route)` cannot disagree.
   *
   * The real asymmetry: local's master view is NOT a doc page. Editor keeps the
   * page id you came from and only overrides the iframe ROUTE, and the view is
   * left by an effect keyed on `currentPageId`. Picking the page you came FROM
   * leaves that id unchanged, so the effect never re-runs and the click is a
   * total no-op — `/` for anyone who entered the master from the home page.
   * (In WC/server the master view IS its own doc page, so their rows always
   * change the id — which is why only local shows this.)
   *
   * Leaving the view must therefore be explicit, not a side effect of the id
   * changing. It is the File-tab path (`sq:go-to-page`): LeftSidebar leaves
   * the Assets tab (it never shows a page) and sends the view event, so
   * Editor stays the only writer of that state.
   */
  it('a usage row for the page you came FROM still leaves the master view', () => {
    h.usage = { pages: [{ pageId: PAGE_ID, label: '/' }], overriddenPlacements: 0 };
    setLocalComponentViewFile(FILE);
    const leave = vi.fn();
    window.addEventListener('sq:go-to-page', leave);

    render(<DesignBar />);
    fireEvent.click(screen.getByTitle('Where this component is used'));
    fireEvent.click(screen.getByText('/'));

    // Same page id as the one already current — the navigation alone changes
    // nothing, so the exit must be its own instruction.
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'SET_CURRENT_PAGE', pageId: PAGE_ID });
    expect(leave).toHaveBeenCalledTimes(1);

    window.removeEventListener('sq:go-to-page', leave);
    h.usage = { pages: [], overriddenPlacements: 0 };
  });

  it('a PAGE view shows no usage badge (it is not a master surface)', () => {
    h.usage = {
      pages: [{ pageId: 'page-1', label: '/' }],
      overriddenPlacements: 1,
    };
    render(<DesignBar />);
    expect(screen.queryByTitle('Where this component is used')).toBeNull();
    h.usage = { pages: [], overriddenPlacements: 0 };
  });

  it('a NON-local project is untouched by the component-view state', () => {
    h.localPath = null;
    setLocalComponentViewFile(FILE); // stale value must not leak into WC/server

    const { container } = render(<DesignBar />);

    // No local cluster either way (not a local project), and crucially the
    // heading is not suppressed by a mode this project is not in.
    expect(screen.queryByTitle('Go to source')).toBeNull();
    expect(headingText(container)).toContain('H2');
  });
});

it('DesignBar resolves an imported card on the listing page and invokes the existing pencil with exact filename identity', () => {
  h.doc = buildDoc(); h.localPath = '/Users/me/my-astro-site'; h.postLinkPaths = ['/works/petcubetracker']; h.openPost.mockClear();
  const view = render(<DesignBar />);
  fireEvent.click(screen.getByTitle('Go to post'));
  expect(h.openPost).toHaveBeenCalledWith('works', 'PetcubeTracker');
  h.postLinkPaths = ['/about']; view.rerender(<DesignBar />);
  expect(screen.queryByTitle('Go to post')).toBeNull();
  h.postLinkPaths = null;
});
