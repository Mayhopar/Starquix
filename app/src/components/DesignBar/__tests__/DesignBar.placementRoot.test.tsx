/**
 * Owner ruling 2026-08-03 — local's instance chrome must match server's.
 *
 * Server mode renders `↗` (go to source) and the `⋮` Push / Reset menu on the
 * placement ROOT alone: only the instance root key (`el-…`) is `isInstanceRoot`,
 * and everything the component rendered underneath is an `instance-child` that
 * gets the `*` divergence marker and nothing else.
 *
 * Local mode had no instance-root concept, so `DesignBar` derived the cluster
 * from the key's FILE PATH — `/^src\/(components|layouts)\//` — which is true
 * for EVERY element inside the component. Result: `↗` and `⋮` on every node,
 * offering a whole-placement Push from a nested `<span>`.
 *
 * `placementRoot.ts` supplies the missing signal from the scan tree; these
 * tests pin the rendered consequence at both ends.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';

const PAGE_ID = 'page-1';
const FILE = 'src/components/Header.astro';
const P = '~p5e23e503da89f633';
/** The page element that PLACES `<Header/>` — a bare (placement-free) key. */
const PAGE_KEY = 'src/pages/index.astro:5:1';
/** `<Header/>`'s outermost element. */
const ROOT_KEY = `${FILE}:1:1${P}`;
/** An element Header renders INSIDE itself. */
const CHILD_KEY = `${FILE}:12:3${P}`;
const RICH = 'text-2xl font-bold text-stone-800';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  localPath: '/Users/me/my-astro-site' as string | null,
  selectedKey: '' as string,
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useDispatch: () => vi.fn(),
}));

vi.mock('@/hooks/useLocalProjectPath', () => ({
  useLocalProjectPath: () => h.localPath,
}));

vi.mock('@/context/SelectionContext', () => {
  const scan = () => ({
    scannedByKey: new Map([
      [PAGE_KEY, { key: PAGE_KEY, classes: '', parentKey: null }],
      [ROOT_KEY, { key: ROOT_KEY, classes: RICH, parentKey: PAGE_KEY }],
      [CHILD_KEY, { key: CHILD_KEY, classes: RICH, parentKey: ROOT_KEY }],
    ]),
  });
  return ({
  useSelectedElement: () => ({
    key: h.selectedKey,
    sourceLocation: { file: FILE, line: 12, column: 3 },
    tagName: 'h2',
    classes: RICH,
    computedStyles: null,
    parentDisplay: null,
    linkHref: null, linkTarget: null, linkAriaLabel: null,
    imageSrc: null, imageAlt: null, imagePreviewDataUrl: null,
    postSlug: null,
    hasSelection: true,
    isEditingText: false,
  }),
  useSelectionContext: () => ({ additionalSelections: [] }),
  useTextSelection: () => ({
    hasTextSelection: false, isInsideLink: false,
    isLinkInteracting: false, setLinkInteracting: vi.fn(),
  }),
  // The REAL scan shape: a page element places <Header/>, whose root wraps the
  // child. This is the ancestry `isPlacementRoot` reads.
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

/** A doc whose ONE unpushed edit sits on the CHILD element. */
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
    entry.set('edited', true);
    const loc = new Y.Map();
    loc.set('file', FILE); loc.set('line', 12); loc.set('column', 3);
    entry.set('sourceLocation', loc);
    doc.getMap('sourceClasses').set(CHILD_KEY, entry);
  }, 'sync');
  return doc;
}

const headingText = (container: HTMLElement) =>
  container.querySelector('[data-testid="design-bar-heading"]')?.textContent ?? '';

describe('local mode — instance chrome belongs to the PLACEMENT ROOT only', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.localPath = '/Users/me/my-astro-site';
    setLocalComponentViewFile(null);
  });
  afterEach(() => setLocalComponentViewFile(null));

  it('the placement ROOT gets ↗ and ⋮ (server-mode parity)', () => {
    h.selectedKey = ROOT_KEY;
    render(<DesignBar />);
    expect(screen.getByTitle('Go to source')).toBeTruthy();
    expect(screen.getByTitle('Component options')).toBeTruthy();
  });

  it('an element INSIDE the placement gets NEITHER ↗ nor ⋮', () => {
    h.selectedKey = CHILD_KEY;
    render(<DesignBar />);
    expect(screen.queryByTitle('Go to source')).toBeNull();
    expect(screen.queryByTitle('Component options')).toBeNull();
  });

  it('the inner element KEEPS its divergence marker — only the actions moved', () => {
    h.selectedKey = CHILD_KEY;
    const { container } = render(<DesignBar />);
    expect(headingText(container)).toContain('*');
  });
});
