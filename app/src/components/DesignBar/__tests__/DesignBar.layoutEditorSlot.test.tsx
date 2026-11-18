/**
 * In the LAYOUT EDITOR (a layout opened from Assets → component-editor mode),
 * selecting the `<slot />` element must show a MINIMAL slot panel: the header
 * reads "Slot" (not the layout name), the SlotBlock name editor renders, and
 * NOTHING else — no appended LayoutPropsEditor, no breakpoint/theme/state
 * selectors, no generic style stack. A `<slot>` is a compile-time placeholder;
 * it carries a name (+ future fallback), never layout props or a style stack.
 *
 * Deselecting (nothing selected) must still show the layout-props panel
 * (`layoutEditorPanel`) so the layout's schema surface is intact.
 *
 * Mirrors DesignBar.layoutSelection.test.tsx's mock scaffold, with two deltas:
 * SlotBlock and LayoutPropsEditor render REAL (we assert on them).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';

const LAYOUT_BODY = '<header class="nav">NAV</header><slot />';
const ROOT_ID = 'el-root-marketing';
// The editor <slot> is a SOURCE child of the layout root → instance-child key.
const SLOT_ID = `${ROOT_ID}:slot-0`;

const h = vi.hoisted(() => ({
  doc: null as unknown,
  key: null as string | null,
  tagName: 'slot' as string,
  scannedByKey: new Map<string, { slotName?: string }>(),
  dispatch: vi.fn(),
  sourceHtml: '' as string,
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useDispatch: () => h.dispatch,
}));

vi.mock('@/context/SelectionContext', () => {
  const scan = () => ({ scannedByKey: h.scannedByKey });
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
  useSourceHtml: () => ({ sourceHtml: h.sourceHtml, refetchSourceHtml: vi.fn(), setSourceHtml: vi.fn() }),
}));
vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({ builtIn: [], userProject: [], refresh: vi.fn() }),
}));
vi.mock('@/hooks/useBlogSlotContext', () => ({
  useBlogSlotContext: () => ({ isInsideBlogSlot: false, blogSlotKey: null }),
}));
vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({
    layouts: [{ name: 'Marketing', props: [{ name: 'heading', type: 'string', required: false }], body: LAYOUT_BODY, frontmatter: '' }],
    isLoading: false, error: null, refresh: () => {},
  }),
}));

vi.mock('@/assets/icons', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) out[k] = () => null;
  return out;
});

// Child blocks/selectors stubbed (jsdom SVG + heavy contexts). UNLIKE the
// layoutSelection scaffold, SlotBlock and LayoutPropsEditor render REAL — their
// presence/absence on a slot selection is exactly what's under test.
vi.mock('../blocks/LayoutAppearanceBlock', () => ({ LayoutAppearanceBlock: () => null }));
vi.mock('../blocks/PositionBlock', () => ({ PositionBlock: () => null }));
vi.mock('../blocks/TypographyBlock', () => ({ TypographyBlock: () => null }));
vi.mock('../blocks/SpacingBlock', () => ({ SpacingBlock: () => null }));
vi.mock('../blocks/AppearanceBlock', () => ({ AppearanceBlock: () => null }));
vi.mock('../blocks/FillBlock', () => ({ FillBlock: () => null }));
vi.mock('../blocks/StrokeBlock', () => ({ StrokeBlock: () => null }));
vi.mock('../blocks/EffectsBlock', () => ({ EffectsBlock: () => null }));
vi.mock('../blocks/LinkBlock', () => ({ LinkBlock: () => null }));
vi.mock('../blocks/SlotTargetBlock', () => ({ SlotTargetBlock: () => null }));
vi.mock('../blocks/ImageBlock', () => ({ ImageBlock: () => null }));
vi.mock('../inputs/ContentFieldPicker', () => ({ ContentFieldPicker: () => null }));
vi.mock('../tabs/index', () => ({ ClassesTab: () => null, SourceTab: () => null }));
vi.mock('../BlockOverridePills', async (orig) => {
  const actual = await orig<typeof import('../BlockOverridePills')>();
  return { ...actual, BlockOverridePills: () => null };
});

import { DesignBar } from '../DesignBar';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';

function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', COMPONENT_EDITOR_PAGE_ID);
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', COMPONENT_EDITOR_PAGE_ID);
    yPage.set('name', 'Editor');
    const roots = new Y.Array<string>();
    roots.push([ROOT_ID]);
    yPage.set('rootElementIds', roots);
    yPage.set('children', new Y.Array());
    pages.set(COMPONENT_EDITOR_PAGE_ID, yPage);

    const elements = doc.getMap('elements');
    // Editor root resolves to a known LAYOUT by basename → layout-editor mode.
    const root = new Y.Map();
    root.set('id', ROOT_ID);
    root.set('astroSource', 'library/Marketing.astro');
    elements.set(ROOT_ID, root);
    // NOTE: we deliberately do NOT create a Yjs element for the slot. In the real
    // layout editor the <slot> is a SCANNED source element — it is NOT in the
    // elements map (elements.get(SLOT_ID) === undefined), so isSlotElement can
    // only be driven by the scanned tagName 'slot' (see the useSelectedElement
    // mock returning tagName: 'slot'). An earlier version of this test created a
    // fake type:'slot' element here, which masked the real bug.
  }, 'sync');
  return doc;
}

describe('DesignBar — slot panel in the layout editor', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.dispatch.mockClear();
    h.sourceHtml = LAYOUT_BODY;
    h.tagName = 'slot';
    h.scannedByKey = new Map();
  });

  it('slot selected in the layout editor shows the Slot panel only', () => {
    h.key = SLOT_ID;
    render(<DesignBar />);
    // Header (and the slot row title) read "Slot", not the layout name
    expect(screen.getAllByText('Slot').length).toBeGreaterThan(0);
    expect(screen.queryByText('Marketing')).not.toBeInTheDocument();
    // Slot name editor present
    expect(screen.getByTestId('slot-block')).toBeInTheDocument();
    // Layout props editor NOT appended to the slot selection
    expect(screen.queryByTestId('layout-props-editor')).not.toBeInTheDocument();
    // No generic style stack
    expect(screen.queryByText('Position')).not.toBeInTheDocument();
    expect(screen.queryByText('Appearance')).not.toBeInTheDocument();
  });

  it('deselecting in the layout editor still shows the layout props panel', () => {
    h.key = null;
    render(<DesignBar />);
    expect(screen.getByTestId('layout-props-editor')).toBeInTheDocument();
  });

  it('a FILLED slot (div with scanned slotName) shows the Slot panel, not the Div style stack', () => {
    // On a real page a filled layout slot renders as <div data-sq-slot>: tagName
    // 'div', but the scan stamps slotName — that alone must mark it a slot.
    h.key = SLOT_ID;
    h.tagName = 'div';
    h.scannedByKey = new Map([[SLOT_ID, { slotName: 'hero' }]]);
    render(<DesignBar />);
    expect(screen.getByTestId('slot-block')).toBeInTheDocument();
    expect(screen.queryByTestId('layout-props-editor')).not.toBeInTheDocument();
    expect(screen.queryByText('Position')).not.toBeInTheDocument();
    expect(screen.queryByText('Appearance')).not.toBeInTheDocument();
  });
});
