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
/** The card's title <h3>. */
const CARD_H3_KEY = `${CARD_FILE}:19:7~p1111111111111111`;
const RICH = 'text-2xl font-bold text-stone-800';

const h = vi.hoisted(() => ({
  selectedKey: '' as string,
  tagName: 'h2' as string,
  postSlug: null as string | null,
  pageBinding: null as unknown,
  bind: vi.fn(),
  upgrade: vi.fn(),
  collections: [{ name: 'works', posts: [{ slug: 'PetcubeTracker' }] }, { name: 'notes', posts: [] }] as unknown[],
  doc: null as unknown,
  localPath: '/Users/me/my-astro-site' as string | null,
  usage: { pages: [] as Array<{ pageId: string; label: string }>, overriddenPlacements: 0 },
  dispatch: vi.fn(),
  openPost: vi.fn(),
  postLinkPaths: null as readonly string[] | null,
  linkRow: {} as object,
  assignments: new Map<string, { card: boolean; collections: string[]; typed: string | null; conflict: string[] }>(),
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
      [CARD_KEY, { key: CARD_KEY, classes: RICH, parentKey: INNER_KEY, ...h.linkRow }],
      [CARD_H3_KEY, { key: CARD_H3_KEY, classes: RICH, parentKey: CARD_KEY }],
    ]),
  });
  return ({
  useSelectedElement: () => ({
    key: h.selectedKey,
    sourceLocation: { file: SLOT_FILE, line: 8, column: 1 },
    tagName: h.tagName,
    classes: RICH,
    computedStyles: null,
    parentDisplay: null,
    linkHref: null, linkTarget: null, linkAriaLabel: null,
    imageSrc: null, imageAlt: null, imagePreviewDataUrl: null,
    postSlug: h.postSlug,
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
vi.mock('@/hooks/useContentCollections', () => ({ useContentCollections: () => ({ collections: h.collections }) }));
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
vi.mock('../blocks/LinkBlock', () => ({ LinkBlock: () => <div>link-block</div> }));
vi.mock('../blocks/SlotBlock', () => ({ SlotBlock: () => null }));
vi.mock('../blocks/SlotTargetBlock', () => ({ SlotTargetBlock: () => null }));
vi.mock('../inputs/ContentFieldPickerPair', () => ({ ContentFieldPickerPair: () => null }));
vi.mock('../tabs/index', () => ({ ClassesTab: () => null, SourceTab: () => null }));
vi.mock('../BlockOverridePills', async (orig) => {
  const actual = await orig<typeof import('../BlockOverridePills')>();
  return { ...actual, BlockOverridePills: () => null };
});

vi.mock('../blocks/BlogBindingBlock', () => ({ BlogBindingBlock: () => <div>blog-binding-block</div> }));
vi.mock('@/hooks/useBlogBinding', () => ({ useBlogBinding: () => h.pageBinding }));
vi.mock('@/components/Editor/localBlogBind', () => ({ bindLocalBlogSlot: (...a: unknown[]) => h.bind(...a), reemitLocalBlogSlots: (...a: unknown[]) => h.bind(...a) }));
vi.mock('@/components/Editor/localFieldBind', () => ({ upgradeLocalCardImage: (...a: unknown[]) => h.upgrade(...a) }));
vi.mock('@/utils/localPageSync', async (orig) => ({ ...(await orig<typeof import('@/utils/localPageSync')>()), getLocalPageFile: () => 'src/pages/blog.astro', isLocalPageInSync: () => true }));
vi.mock('../blocks/CardFieldsBlock', () => ({ CardFieldsBlock: (p: { file: string; collections: Array<{ name: string }>; conflict?: readonly string[]; allCollections?: Array<{ name: string }> }) =>
  <div data-collections={p.collections.map((c) => c.name).join(',')} data-conflict={(p.conflict ?? []).join(',')} data-all={(p.allCollections ?? []).map((c) => c.name).join(',')}>card-fields-block:{p.file}</div> }));
vi.mock('@/utils/cardTitleLock', async (orig) => ({ ...(await orig<typeof import('@/utils/cardTitleLock')>()), cardAssignmentOf: (f: string) => h.assignments.get(f) ?? null }));
vi.mock('../blocks/FieldBindingBlock', () => ({ FieldBindingBlock: (p: { mode: string; tagName: string; collections: Array<{ name: string }> }) =>
  <div data-collections={p.collections.map((c) => c.name).join(',')}>field-binding-block:{p.mode}:{p.tagName}</div> }));

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
 * task-240 Phase 2: a text/img element INSIDE BlogCard.astro gets the field
 * binding block — writable in the BlogCard master (component view), read-only
 * on a page instance. Other files, non-bindable tags and non-local never.
 */
describe('files-truth BlogCard element → FieldBindingBlock', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.localPath = '/Users/me/my-astro-site';
    h.dispatch.mockClear();
    h.tagName = 'h3';
    h.assignments.clear();
    h.postSlug = null;
    h.postLinkPaths = null;
    h.linkRow = {};
    h.pageBinding = null;
    setLocalComponentViewFile(null);
  });
  afterEach(() => setLocalComponentViewFile(null));

  it('on a PAGE: the card title shows the read-only instance block', () => {
    h.selectedKey = CARD_H3_KEY;
    render(<DesignBar />);
    expect(screen.getByText('field-binding-block:instance:h3')).toBeTruthy();
  });

  it('the card\'s fields (eyes) show for ANY selected card element, on a page too — even the root <article>', () => {
    h.selectedKey = CARD_KEY;
    h.tagName = 'article';
    render(<DesignBar />);
    expect(screen.getByText(`card-fields-block:${CARD_FILE}`)).toBeTruthy();
  });

  it('an element of another file (BlogSlot) shows no card fields', () => {
    h.selectedKey = INNER_KEY;
    render(<DesignBar />);
    expect(screen.queryByText(/card-fields-block/)).toBeNull();
  });

  it('in the BlogCard MASTER: the writable block', () => {
    h.selectedKey = CARD_H3_KEY;
    setLocalComponentViewFile(CARD_FILE);
    render(<DesignBar />);
    expect(screen.getByText('field-binding-block:master:h3')).toBeTruthy();
  });

  it('in a collection\'s own card master (WorksCard): the writable block, scoped to that collection', () => {
    const works = 'src/components/WorksCard.astro';
    h.assignments.set(works, { card: true, collections: ['works'], typed: null, conflict: [] });
    h.selectedKey = `${works}:19:7~p1111111111111111`;
    setLocalComponentViewFile(works);
    render(<DesignBar />);
    expect(screen.getByText('field-binding-block:master:h3').getAttribute('data-collections')).toBe('works');
  });

  it('Fields are scoped by the card assignment (one rule) and carry its conflict', () => {
    const card = 'src/components/FeaturedWork.astro';
    h.assignments.set(card, { card: true, collections: ['notes'], typed: 'notes', conflict: ['works'] });
    h.selectedKey = `${card}:19:7~p1111111111111111`;
    h.tagName = 'article';
    render(<DesignBar />);
    const block = screen.getByText(`card-fields-block:${card}`);
    expect(block.getAttribute('data-collections')).toBe('notes');
    expect(block.getAttribute('data-conflict')).toBe('works');
    expect(block.getAttribute('data-all')).toBe('works,notes');
  });

  it('an unassigned card still gets Fields (its Assign row) — never every collection', () => {
    const card = 'src/components/ArticleCard.astro';
    h.assignments.set(card, { card: true, collections: [], typed: null, conflict: [] });
    h.selectedKey = `${card}:19:7~p1111111111111111`;
    h.tagName = 'article';
    render(<DesignBar />);
    expect(screen.getByText(`card-fields-block:${card}`).getAttribute('data-collections')).toBe('');
  });

  it('a related component (a list) has an assignment but no Fields', () => {
    const list = 'src/components/WorkList.astro';
    h.assignments.set(list, { card: false, collections: ['works'], typed: 'works', conflict: [] });
    h.selectedKey = `${list}:19:7~p1111111111111111`;
    h.tagName = 'article';
    render(<DesignBar />);
    expect(screen.queryByText(/card-fields-block/)).toBeNull();
  });

  it('a *Card component that is no collection\'s card (ProductCard) shows nothing', () => {
    const product = 'src/components/ProductCard.astro';
    h.selectedKey = `${product}:19:7~p1111111111111111`;
    setLocalComponentViewFile(product);
    render(<DesignBar />);
    expect(screen.queryByText(/field-binding-block/)).toBeNull();
  });

  it('a non-bindable tag (the card root <article>) shows nothing', () => {
    h.selectedKey = CARD_KEY;
    h.tagName = 'article';
    render(<DesignBar />);
    expect(screen.queryByText(/field-binding-block/)).toBeNull();
  });

  it('a text element of another file (BlogSlot) shows nothing', () => {
    h.selectedKey = INNER_KEY;
    render(<DesignBar />);
    expect(screen.queryByText(/field-binding-block/)).toBeNull();
  });

  it('non-local runtime: never', () => {
    h.selectedKey = CARD_H3_KEY;
    h.localPath = null;
    render(<DesignBar />);
    expect(screen.queryByText(/field-binding-block/)).toBeNull();
  });

  /**
   * The "Go to post" pencil (task-240): the bound page's card wrapper stamps
   * data-sq-post-slug, the bridge hands it up as postSlug, and the page's own
   * binding names the collection — no /<collection>/<slug> link needed.
   */
  it('a card element on a BOUND page offers Go to post (stamped slug → disk post)', () => {
    h.bind.mockReset().mockResolvedValue({ ok: true });
    h.selectedKey = CARD_H3_KEY;
    h.postSlug = 'petcubetracker';
    h.pageBinding = { hasSlot: true, collection: 'works', filter: null, sort: null, limit: null, pagination: { kind: 'none' }, href: null, custom: false };
    render(<DesignBar />);
    expect(screen.getByTitle('Go to post')).toBeTruthy();
    h.postSlug = null; h.pageBinding = null;
  });

  /**
   * Owner 2026-11-02: "it shows link when i select a whole container, not the
   * element". The click payload's postLinkPaths is where the CLICK landed: a
   * plain click on a card selects the top Main and still carried the card's link.
   * The link is the selected element's own scan row, or none.
   */
  it('a container selected by a click on a card shows no link', () => {
    h.selectedKey = CARD_KEY;
    h.tagName = 'body';
    h.postSlug = 'first-post';
    h.postLinkPaths = ['/blog/first-post'];
    h.linkRow = { sourceLocation: { file: 'src/layouts/Main.astro', line: 3, column: 1 }, linkBlocked: true };
    render(<DesignBar />);
    expect(screen.queryByText('link-block')).toBeNull();
  });

  it('an element inside a link shows the Link block', () => {
    h.selectedKey = CARD_KEY;
    h.tagName = 'h3';
    h.linkRow = { linkHref: '/blog/first-post' };
    render(<DesignBar />);
    expect(screen.getByText('link-block')).toBeTruthy();
  });

  it('an element with no link, that can take one, shows the Link block', () => {
    h.selectedKey = CARD_KEY;
    h.tagName = 'p';
    h.linkRow = { sourceLocation: { file: 'src/pages/index.astro', line: 3, column: 1 } };
    render(<DesignBar />);
    expect(screen.getByText('link-block')).toBeTruthy();
  });

  it('an element with no place in a file cannot take a link', () => {
    h.selectedKey = CARD_KEY;
    h.tagName = 'img';
    render(<DesignBar />);
    expect(screen.queryByText('link-block')).toBeNull();
  });

  it('on an UNBOUND page (sample card) there is nothing to go to', () => {
    h.selectedKey = CARD_H3_KEY;
    h.postSlug = null;
    h.pageBinding = { hasSlot: true, collection: null, filter: null, sort: null, limit: null, pagination: { kind: 'none' }, href: null, custom: false };
    render(<DesignBar />);
    expect(screen.queryByTitle('Go to post')).toBeNull();
    h.pageBinding = null;
  });

  /**
   * Our canonical page code evolves; a bound page written by an older build is
   * upgraded ONCE (quiet, no-op when current) as soon as the user works on it.
   */
  it('a bound, non-custom page is re-emitted once, quietly, on first use', async () => {
    h.bind.mockReset().mockResolvedValue({ ok: true });
    h.selectedKey = CARD_H3_KEY;
    h.pageBinding = { hasSlot: true, collection: 'works', filter: null, sort: null, limit: null, pagination: { kind: 'none' }, href: null, custom: false };
    const { rerender } = render(<DesignBar />);
    expect(h.bind).toHaveBeenCalledTimes(1);
    // Every slot of the page is re-emitted by the writer (task-244 L20); custom / unbound slots are skipped there.
    expect(h.bind).toHaveBeenCalledWith(expect.objectContaining({ pageFile: 'src/pages/blog.astro', localProjectPath: '/Users/me/my-astro-site' }));
    await Promise.resolve(); // the ok settles the page
    h.pageBinding = { ...(h.pageBinding as object) }; // a rescan hands a fresh object
    rerender(<DesignBar />);
    expect(h.bind).toHaveBeenCalledTimes(1);
    h.pageBinding = null;
  });

  it('a refused upgrade (scan not landed yet) is retried on the next scan; a successful one settles', async () => {
    h.bind.mockReset().mockResolvedValueOnce({ ok: false, reason: 'still switching pages' }).mockResolvedValue({ ok: true });
    h.selectedKey = CARD_H3_KEY;
    const bound = { hasSlot: true, collection: 'works', filter: null, sort: null, limit: null, pagination: { kind: 'none' }, href: null, custom: false };
    h.pageBinding = { ...bound };
    const { rerender } = render(<DesignBar />);
    expect(h.bind).toHaveBeenCalledTimes(1);
    h.pageBinding = { ...bound }; // next scan → fresh binding object
    rerender(<DesignBar />);
    expect(h.bind).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    await Promise.resolve();
    h.pageBinding = { ...bound };
    rerender(<DesignBar />);
    expect(h.bind).toHaveBeenCalledTimes(2); // settled after the ok
    h.pageBinding = null;
  });

  /**
   * Owner report 2026-09-12: "these cards have uploaded photos but they do not
   * display" — the card a bound page renders upgrades WITH the page: its
   * placeholder box binds to the collection's image field (the writer is a
   * no-op unless the box is still the library placeholder). Same cap: a
   * success settles it.
   */
  it('the bound collection has an image field → the card upgrade runs once and settles', async () => {
    h.bind.mockReset().mockResolvedValue({ ok: true });
    h.upgrade.mockReset().mockResolvedValue({ ok: true });
    const fields = [{ name: 'title', type: 'text' }, { name: 'image', type: 'image' }];
    h.collections = [{ name: 'works', posts: [{ slug: 'PetcubeTracker' }], inferredFields: fields }];
    h.selectedKey = CARD_H3_KEY;
    const bound = { hasSlot: true, collection: 'works', filter: null, sort: null, limit: null, pagination: { kind: 'none' }, href: null, custom: false };
    h.pageBinding = { ...bound };
    const { rerender } = render(<DesignBar />);
    expect(h.upgrade).toHaveBeenCalledTimes(1);
    expect(h.upgrade).toHaveBeenCalledWith(expect.objectContaining({ fields }));
    await Promise.resolve();
    await Promise.resolve();
    h.pageBinding = { ...bound };
    rerender(<DesignBar />);
    expect(h.upgrade).toHaveBeenCalledTimes(1);
    h.pageBinding = null;
    h.collections = [{ name: 'works', posts: [{ slug: 'PetcubeTracker' }] }];
  });

  it('no image field on the bound collection → the card is left alone', () => {
    h.bind.mockReset().mockResolvedValue({ ok: true });
    h.upgrade.mockReset().mockResolvedValue({ ok: true });
    h.collections = [{ name: 'works', posts: [{ slug: 'PetcubeTracker' }], inferredFields: [{ name: 'title', type: 'text' }] }];
    h.selectedKey = CARD_H3_KEY;
    h.pageBinding = { hasSlot: true, collection: 'works', filter: null, sort: null, limit: null, pagination: { kind: 'none' }, href: null, custom: false };
    render(<DesignBar />);
    expect(h.upgrade).not.toHaveBeenCalled();
    h.pageBinding = null;
    h.collections = [{ name: 'works', posts: [{ slug: 'PetcubeTracker' }] }];
  });

  it('a page without a BlogSlot is never handed to the upgrade (custom / unbound slots: reemitLocalBlogSlots skips them)', () => {
    h.bind.mockReset().mockResolvedValue({ ok: true });
    h.selectedKey = CARD_H3_KEY;
    h.pageBinding = { hasSlot: false, collection: null, filter: null, sort: null, limit: null, pagination: { kind: 'none' }, href: null, custom: false };
    render(<DesignBar />);
    expect(h.bind).not.toHaveBeenCalled();
    h.pageBinding = null;
  });
});

