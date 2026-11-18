/**
 * Owner acceptance criterion 2 (has failed every round): `*` must not claim
 * untouched elements.
 *
 * Both runtimes lit `*` from ONE instance-wide/placement-wide boolean, so every
 * sibling inside an edited component wore it. A user read `P*` as "I changed
 * this paragraph", went looking, and found nothing — and in a dirty placement
 * nothing said which element had actually moved.
 *
 * Now: `*` = this element diverged OR it is the component root and something
 * inside it diverged (owner rule 2026-09-16: an overridden component carries
 * `*` in its name). An untouched SIBLING still gets nothing. One shared expression in
 * DesignBar feeds one shared component (DivergenceMarker), fed by
 * `collectInstanceDivergence` (doc-instance path) and `localOverridesForPlacement`
 * (local) — the rendered contract is identical in both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import * as Y from 'yjs';

const PAGE_ID = 'page-1';
const FILE = 'src/components/Header.astro';
const P = '~p5e23e503da89f633';
const PAGE_KEY = 'src/pages/index.astro:5:1';
const ROOT_KEY = `${FILE}:1:1${P}`;
const EDITED_KEY = `${FILE}:12:3${P}`;
const SIBLING_KEY = `${FILE}:18:3${P}`;
const RICH = 'text-2xl font-bold text-stone-800';

/** Doc shape: a doc-managed instance and one of its children. */
const DOC_INSTANCE = 'el-doc1';
const DOC_MARKUP = '<div class="p-4"><h1 class="text-xl">T</h1><p class="text-sm">B</p></div>';

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
      [EDITED_KEY, { key: EDITED_KEY, classes: RICH, parentKey: ROOT_KEY }],
      [SIBLING_KEY, { key: SIBLING_KEY, classes: RICH, parentKey: ROOT_KEY }],
    ]),
  });
  return ({
  useSelectedElement: () => ({
    key: h.selectedKey,
    sourceLocation: { file: FILE, line: 12, column: 3 },
    tagName: 'p',
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

function baseDoc(): Y.Doc {
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

/** local: ONE unpushed class edit, on EDITED_KEY. */
function localDoc(): Y.Doc {
  const doc = baseDoc();
  doc.transact(() => {
    const entry = new Y.Map();
    entry.set('classes', RICH);
    entry.set('edited', true);
    const loc = new Y.Map();
    loc.set('file', FILE); loc.set('line', 12); loc.set('column', 3);
    entry.set('sourceLocation', loc);
    doc.getMap('sourceClasses').set(EDITED_KEY, entry);
  }, 'sync');
  return doc;
}

/** Doc: a doc-managed instance whose `p-0` child carries a text edit. */
function docInstanceDoc(): Y.Doc {
  const doc = baseDoc();
  doc.transact(() => {
    const yEl = new Y.Map();
    yEl.set('staticMarkup', DOC_MARKUP);
    yEl.set('astroSource', 'src/components/Hero.astro');
    doc.getMap('elements').set(DOC_INSTANCE, yEl);
    doc.getMap('sourceText').set(`${DOC_INSTANCE}:p-0`, 'edited body');
  }, 'sync');
  return doc;
}

const headingText = (container: HTMLElement) =>
  container.querySelector('[data-testid="design-bar-heading"]')?.textContent ?? '';

describe('`*` means THIS element diverged — local mode', () => {
  beforeEach(() => {
    h.doc = localDoc();
    h.localPath = '/Users/me/my-astro-site';
    setLocalComponentViewFile(null);
  });
  afterEach(() => setLocalComponentViewFile(null));

  it('the EDITED element gets `*`', () => {
    h.selectedKey = EDITED_KEY;
    const { container } = render(<DesignBar />);
    expect(headingText(container)).toContain('*');
  });

  it('an UNTOUCHED sibling in the same placement gets NO marker at all', () => {
    h.selectedKey = SIBLING_KEY;
    const { container } = render(<DesignBar />);
    const text = headingText(container);
    expect(text).not.toContain('*');
    expect(text).not.toContain('edited inside');
  });

  it('the placement ROOT carries `*` when anything inside it is overridden (owner rule 2026-09-16)', () => {
    h.selectedKey = ROOT_KEY;
    const { container } = render(<DesignBar />);
    const text = headingText(container);
    expect(text).toContain('*');
    expect(text).not.toContain('edited inside');
  });
});

describe('`*` means THIS element diverged — doc-instance path (same code path)', () => {
  beforeEach(() => {
    h.doc = docInstanceDoc();
    h.localPath = null; // not a local project
    setLocalComponentViewFile(null);
  });

  it('the EDITED instance child gets `*`', () => {
    h.selectedKey = `${DOC_INSTANCE}:p-0`;
    const { container } = render(<DesignBar />);
    expect(headingText(container)).toContain('*');
  });

  it('an UNTOUCHED instance child gets NO marker', () => {
    h.selectedKey = `${DOC_INSTANCE}:h1-0`;
    const { container } = render(<DesignBar />);
    const text = headingText(container);
    expect(text).not.toContain('*');
    expect(text).not.toContain('edited inside');
  });

  it('the instance ROOT reports what it contains', () => {
    h.selectedKey = DOC_INSTANCE;
    const { container } = render(<DesignBar />);
    const text = headingText(container);
    expect(text).toContain('*');
    expect(text).not.toContain('edited inside');
  });
});
