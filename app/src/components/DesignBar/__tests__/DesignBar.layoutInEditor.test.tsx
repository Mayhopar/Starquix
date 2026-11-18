/**
 * Layout-in-editor parity. When a LAYOUT is opened from Assets it enters the
 * component-editor flow (currentPageId === COMPONENT_EDITOR_PAGE_ID) with the
 * editor root's astroSource = layouts/<name>.astro. The Design Bar must then show
 * the shared LayoutPropsEditor (schema add/delete) alongside the InstanceMenu it
 * already gets in component-editor mode — so a layout reads like every other entity.
 *
 * Mirrors DesignBar.componentEditorPush.test.tsx: stub heavy child blocks, leave
 * DesignBar routing + InstanceMenu + LayoutPropsEditor real.
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

const mockMutate = vi.fn(async () => ({ ok: true as const }));
vi.mock('@/utils/mutateLayoutProp', () => ({ mutateLayoutProp: (...a: unknown[]) => mockMutate(...a) }));

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
vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({
    layouts: [{ name: 'Marketing', props: [{ name: 'heading', type: 'string', required: false }] }],
    isLoading: false, error: null, refresh: vi.fn(),
  }),
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

function buildLayoutEditorDoc(dirty = false, astroSource = 'layouts/Marketing.astro'): Y.Doc {
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
    el.set('astroSource', astroSource);
    el.set('staticMarkup', '<section>hi</section>');
    if (dirty) {
      const deletedSelectors = new Y.Array<string>();
      deletedSelectors.push(['section-0']);
      el.set('deletedSelectors', deletedSelectors);
    }
    elements.set('el-root', el);
  }, 'sync');
  return doc;
}

// Two render contexts that must look identical: the layout open in the editor with
// (a) nothing selected — the just-opened Assets→Layout state — and (b) its root
// element selected. Both must show the Layout panel (heading + props + menu), never
// the empty Styles/variables panel.
describe.each([
  ['nothing selected (just opened)', null],
  ['the layout root selected', 'el-root'],
])('DesignBar — layout open in the editor — %s', (_label, selKey) => {
  beforeEach(() => {
    h.key = selKey;
    h.dispatch.mockClear();
    mockMutate.mockClear();
    h.doc = buildLayoutEditorDoc();
  });

  it('renders the layout name as the panel heading', () => {
    render(<DesignBar />);
    expect(screen.getByText('Marketing')).toBeInTheDocument();
  });

  it('does NOT render the empty Styles / variables panel', () => {
    render(<DesignBar />);
    expect(screen.queryByText('No variables defined yet')).toBeNull();
  });

  it('renders the shared LayoutPropsEditor add control', () => {
    render(<DesignBar />);
    expect(screen.getByLabelText('New property name')).toBeInTheDocument();
  });

  it('shows the declared prop with a delete button (schema mode)', () => {
    render(<DesignBar />);
    expect(screen.getByTitle('Delete property heading')).toBeInTheDocument();
  });

  it('adds a prop via mutateLayoutProp', () => {
    render(<DesignBar />);
    const add = screen.getByLabelText('New property name');
    fireEvent.change(add, { target: { value: 'cta' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    expect(mockMutate).toHaveBeenCalledWith('Marketing', 'add', 'cta');
  });

  it('has NO standalone Sync icon (editing the source needs no push affordance)', () => {
    h.doc = buildLayoutEditorDoc(true);
    render(<DesignBar />);
    expect(screen.queryByTitle('Sync changes to source')).toBeNull();
  });
});

// Opening a layout in Assets with NOTHING selected IS editing the source — so, like a
// component opened in Assets (which shows the empty Styles panel, no menu), there is NO
// ⋮ menu and NO push/sync/reset/go-to-source affordance. Just the name + props schema.
describe('DesignBar — layout in editor, nothing selected — no source-relationship menu', () => {
  beforeEach(() => {
    h.key = null;
    h.dispatch.mockClear();
    mockMutate.mockClear();
    h.doc = buildLayoutEditorDoc(true); // dirty, to prove nothing appears even then
  });

  it('shows NO ⋮ menu', () => {
    render(<DesignBar />);
    expect(screen.queryByTitle('Component options')).toBeNull();
  });

  it('shows NO standalone Sync icon', () => {
    render(<DesignBar />);
    expect(screen.queryByTitle('Sync changes to source')).toBeNull();
  });

  it('does not append * to the heading', () => {
    render(<DesignBar />);
    expect(screen.queryByText('Marketing*')).toBeNull();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
  });
});

// When an element INSIDE the layout is selected in the editor, there is STILL no
// source-relationship menu — you are editing the source itself (auto-flushed). No
// ⋮ menu, no "Push changes to source", no "Reset to master". Same as the component
// editor (shared code path).
describe('DesignBar — element selected in the layout editor — NO push/reset menu', () => {
  beforeEach(() => {
    h.key = 'el-root';
    h.dispatch.mockClear();
    mockMutate.mockClear();
  });

  it('shows NO ⋮ menu when dirty', () => {
    h.doc = buildLayoutEditorDoc(true);
    render(<DesignBar />);
    expect(screen.queryByTitle('Component options')).toBeNull();
    expect(screen.queryByText('Push changes to source')).toBeNull();
    expect(screen.queryByText('Reset to master')).toBeNull();
  });

  it('shows NO ⋮ menu when clean', () => {
    h.doc = buildLayoutEditorDoc(false);
    render(<DesignBar />);
    expect(screen.queryByTitle('Component options')).toBeNull();
    expect(screen.queryByText('Push changes to source')).toBeNull();
  });
});

// Regression: the editor root's astroSource carries a non-`layouts/` prefix
// (observed `library/Marketing.astro` in a real project) AND components share that
// prefix, so path-based detection (isLayoutPath) missed it and the empty Styles
// panel showed instead of the Layout panel. Detection must match the basename
// against the layout LIBRARY.
describe('DesignBar — layout in editor with a non-layouts/ astroSource prefix', () => {
  beforeEach(() => {
    h.key = null;
    h.dispatch.mockClear();
    mockMutate.mockClear();
    h.doc = buildLayoutEditorDoc(false, 'library/Marketing.astro');
  });

  it('still detects the layout and renders the Layout panel (not the Styles panel)', () => {
    render(<DesignBar />);
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    expect(screen.getByLabelText('New property name')).toBeInTheDocument();
    expect(screen.queryByText('No variables defined yet')).toBeNull();
  });
});
