/**
 * Blind review 2026-08-04, items 1, 2 and 4 — the three tells left in the
 * DesignBar header. All three are fixed in code BOTH runtimes run, so the
 * assertions below are written twice on purpose: once through a local placement
 * and once through a doc-managed instance, against the same expectations.
 *
 *  1. **The push report.** Local said `Feature.astro updated — 1 change written
 *     · 2 pages render it`; the doc-instance path said `Changes pushed to the master
 *     component.` Both now come from `store/pushNotice.ts`, fed by the same
 *     `useComponentUsage` numbers the confirmation modal prints. The copy says
 *     "pushed", never "written" — the doc-instance push touches no file.
 *  2. **The `.astro` suffix.** It leaked into local's modal and toast. Both
 *     runtimes now name the component the way the rest of the editor does:
 *     `basenameFromAstroSource` → `Header`.
 *  4. **The stray `↻`.** The doc-instance path rendered the pull-from-source affordance on
 *     an instance CHILD, because `canResetInstance` is true for
 *     `instance-child` keys; local never rendered it at all. `↻` reports that
 *     the INSTANCE's master markup moved and its click resets the whole
 *     instance — offering it from a child is the same "instance-scoped action
 *     from a child selection" defect the 2026-08-03 ruling removed from `↗`/`⋮`.
 *     It is now gated on the divergence SCOPE ROOT, so both runtimes show
 *     nothing on a child.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';

const PAGE_ID = 'page-1';
const FILE = 'src/components/Header.astro';
const P = '~p5e23e503da89f633';
const PAGE_KEY = 'src/pages/index.astro:5:1';
const ROOT_KEY = `${FILE}:1:1${P}`;
const EDITED_KEY = `${FILE}:12:3${P}`;
const RICH = 'text-2xl font-bold text-stone-800';

const DOC_INSTANCE = 'el-doc1';
const DOC_SOURCE = 'src/components/Header.astro';
const DOC_MARKUP = '<div class="p-4"><h1 class="text-xl">T</h1><p class="text-sm">B</p></div>';

const RELOAD_TITLE = 'Updates available — pull from source';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  localPath: null as string | null,
  selectedKey: '' as string,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    plain: vi.fn(),
  },
  pushResult: { ok: true } as { ok: boolean; reason?: string },
  pushed: [] as unknown[],
}));

vi.mock('react-hot-toast', () => {
  const toast = Object.assign((m: string) => h.toast.plain(m), {
    success: (m: string, o?: unknown) => h.toast.success(m, o),
    error: (m: string, o?: unknown) => h.toast.error(m, o),
    loading: (m: string, o?: unknown) => h.toast.loading(m, o),
  });
  return { default: toast, toast };
});

vi.mock('@/store/instanceLifecycle', async (orig) => {
  const actual = await orig<typeof import('@/store/instanceLifecycle')>();
  return {
    ...actual,
    pushInstanceToSource: (args: unknown) => { h.pushed.push(args); return h.pushResult; },
  };
});

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
import { applyCommand } from '@/store/commands';

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

/** local: ONE unpushed class edit on the placement's own root element. */
function localDoc(): Y.Doc {
  const doc = baseDoc();
  doc.transact(() => {
    const entry = new Y.Map();
    entry.set('classes', RICH);
    entry.set('edited', true);
    const loc = new Y.Map();
    loc.set('file', FILE); loc.set('line', 1); loc.set('column', 1);
    entry.set('sourceLocation', loc);
    doc.getMap('sourceClasses').set(ROOT_KEY, entry);
  }, 'sync');
  return doc;
}

/** Doc: a doc-managed instance whose `p-0` child carries a text edit. */
function docInstanceDoc(): Y.Doc {
  const doc = baseDoc();
  doc.transact(() => {
    const yEl = new Y.Map();
    yEl.set('staticMarkup', DOC_MARKUP);
    yEl.set('astroSource', DOC_SOURCE);
    yEl.set('pageId', PAGE_ID);
    doc.getMap('elements').set(DOC_INSTANCE, yEl);
    doc.getMap('sourceText').set(`${DOC_INSTANCE}:p-0`, 'edited body');
  }, 'sync');
  return doc;
}

/** Open ⋮ → click an item: it runs at once (no dialog — ⌘Z takes it back, culture.md Law 6). */
function runMenuItem(label: string) {
  fireEvent.click(screen.getByTitle('Component options'));
  fireEvent.click(screen.getByText(label));
}

beforeEach(() => {
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  h.toast.loading.mockClear();
  h.toast.plain.mockClear();
  h.pushed = [];
  h.pushResult = { ok: true };
  setLocalComponentViewFile(null);
});
afterEach(() => setLocalComponentViewFile(null));

describe('item 1 + 2 — the push report is one shared, specific sentence', () => {
  it('doc-instance path: names the component and the changes, never the generic line', async () => {
    h.doc = docInstanceDoc();
    h.localPath = null;
    h.selectedKey = DOC_INSTANCE;
    render(<DesignBar />);

    runMenuItem('Push changes to source');
    expect(h.pushed).toHaveLength(1);
    // fdd2d12f: handlePushToSource awaits pushInstanceToSource before reporting.
    await vi.waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
    const msg = h.toast.success.mock.calls[0][0] as string;
    expect(msg).not.toBe('Changes pushed to the master component.');
    expect(msg).toContain('Header updated — 1 change pushed');
    // A doc/masters write is not a file write: never claim one.
    expect(msg).not.toContain('written');
    expect(msg).not.toContain('.astro');
  });

  it('local: the same builder, so the sentence has the same shape', () => {
    h.doc = localDoc();
    h.localPath = '/Users/me/my-astro-site';
    h.selectedKey = ROOT_KEY;
    render(<DesignBar />);

    runMenuItem('Push changes to source');
    // item 2: the display name (`Header`, never `Header.astro`). Local's push is async and starts with a loading toast under one id.
    expect(h.toast.loading).toHaveBeenCalledTimes(1);
    expect(h.toast.loading.mock.calls[0][0]).toBe('Pushing 1 change into Header…');
  });
});

describe('item 4 — `↻` belongs to the scope root, in every runtime', () => {
  it('doc-instance path: an overridden instance CHILD gets no pull-from-source affordance', () => {
    const doc = docInstanceDoc();
    // The master markup moves past the instance's edit — the ↻ axis, lit.
    doc.transact(() => {
      applyCommand(doc, {
        type: 'SET_MASTER_MARKUP',
        astroSource: DOC_SOURCE,
        markup: '<div class="p-8"><h1 class="text-xl">T</h1><p class="text-sm">B</p></div>',
      });
    }, 'sync');
    h.doc = doc;
    h.localPath = null;

    h.selectedKey = `${DOC_INSTANCE}:p-0`;
    const child = render(<DesignBar />);
    expect(child.queryByTitle(RELOAD_TITLE)).toBeNull();
    child.unmount();

    // The control: on the instance ROOT the same doc state still shows it, so
    // the narrowing removed a misplaced affordance, not the axis.
    h.selectedKey = DOC_INSTANCE;
    const root = render(<DesignBar />);
    expect(root.queryByTitle(RELOAD_TITLE)).not.toBeNull();
  });

  it('local: no ↻ anywhere — the file IS the master, so it cannot go stale', () => {
    h.doc = localDoc();
    h.localPath = '/Users/me/my-astro-site';
    h.selectedKey = EDITED_KEY;
    render(<DesignBar />);
    expect(screen.queryByTitle(RELOAD_TITLE)).toBeNull();
  });
});
