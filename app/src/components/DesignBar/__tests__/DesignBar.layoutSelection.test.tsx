/**
 * A page's layout node (selectedKey "layout:<name>") resolves to its derived
 * layout-chrome element and reuses the FULL component-instance header: dirty
 * `*` and the InstanceMenu (Push / Reset / Go to source) with the layout-
 * specific Replace / Detach / Delete appended. It also routes PageLayoutBlock as
 * the +1 block and suppresses the standard style stack. (The ↻ markup-version
 * "pull from source" affordance is gone — the `masters` overlay makes the master
 * live, so there is no version skew to pull; Reset just drops overrides.)
 *
 * DesignBar pulls in a large context/block tree; rendering it whole trips the
 * known jsdom SVG-data-URL issue (see blocks.test.tsx). We stub the child
 * blocks/selectors and contexts, leaving DesignBar's own routing — and the real
 * InstanceMenu/EntityMenu — under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';

const PAGE_ID = 'page-1';
// A layout body with visible chrome + a slot — drives the chrome version.
const LAYOUT_BODY = '<header class="nav">NAV</header><slot />';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  key: null as string | null,
  dispatch: vi.fn(),
  takeSnapshot: vi.fn(),
  sourceHtml: '' as string,
  applied: [] as Array<{ type: string; elementId?: string }>,
}));

// fdd2d12f: Reset no longer dispatches — resetInstanceToOriginal applies its
// commands (applyCommand) inside ONE durable acceptDocumentMutation gesture.
// The durable storage layer is out of scope here: run the mutation straight on
// the session doc and record every applied command.
vi.mock('@/store/documentMutation', async (orig) => ({
  ...(await orig<typeof import('@/store/documentMutation')>()),
  acceptDocumentMutation: async (doc: Y.Doc, mutate: (staged: Y.Doc) => void) => { mutate(doc); return {}; },
}));
vi.mock('@/store/commands', async (orig) => {
  const actual = await orig<typeof import('@/store/commands')>();
  return {
    ...actual,
    applyCommand: (doc: Y.Doc, action: { type: string; elementId?: string }) => {
      h.applied.push(action);
      return (actual.applyCommand as (d: Y.Doc, a: unknown) => boolean)(doc, action);
    },
  };
});

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
  useUndoContext: () => ({ takeSnapshot: h.takeSnapshot }),
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

// Child blocks/selectors stubbed (jsdom SVG + heavy contexts). InstanceMenu and
// EntityMenu render REAL — the menu parity is part of what's under test.
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
import { ensureLayoutElement, pageLayoutElementId, layoutChromeMarkup } from '@/store/layoutElement';

// Real selection keys (no synthetic `layout:<name>`): the Layout is its
// layout-chrome instance ROOT; a slot/chrome tag is an instance-child key.
const LAYOUT_KEY = pageLayoutElementId(PAGE_ID);
const SLOT_KEY = `${LAYOUT_KEY}:header-0`;

function buildDoc(opts: { withElement?: boolean; diverged?: boolean } = {}): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', PAGE_ID);
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    yPage.set('layoutName', 'Marketing');
    pages.set(PAGE_ID, yPage);
  }, 'sync');

  if (opts.withElement ?? true) {
    ensureLayoutElement(doc, PAGE_ID, 'Marketing', LAYOUT_BODY);
    const el = doc.getMap('elements').get(pageLayoutElementId(PAGE_ID)) as Y.Map<unknown>;
    doc.transact(() => {
      if (opts.diverged) {
        const mo = new Y.Map<string>();
        mo.set('header-0', 'OVERRIDDEN');
        el.set('markupOverrides', mo);
      }
    });
  }
  return doc;
}

describe('DesignBar — layout selection parity', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.dispatch.mockClear();
    // The layout's source is now the resolved html from useSourceHtml (the SAME
    // representation the element's masterVersion is stamped from) — single-sourced.
    h.sourceHtml = layoutChromeMarkup(LAYOUT_BODY);
  });

  it('shows PageLayoutBlock as the +1 block when a layout node is selected', () => {
    h.key = LAYOUT_KEY;
    render(<DesignBar />);
    expect(screen.getByTestId('page-layout-block')).toBeInTheDocument();
    expect(screen.queryByTestId('variables-quick-panel')).not.toBeInTheDocument();
  });

  it('does NOT show PageLayoutBlock for a normal element selection', () => {
    h.key = 'Hero.astro:5:1';
    render(<DesignBar />);
    expect(screen.queryByTestId('page-layout-block')).not.toBeInTheDocument();
  });

  // Drill ladder on REAL keys: Layout root → layout controls; slot/chrome child →
  // normal class controls (routed to chrome overrides); content → normal element.
  it('Layout root selection (layoutchrome-<pageId>) shows the layout-only Design tab', () => {
    h.key = LAYOUT_KEY;
    render(<DesignBar />);
    expect(screen.getByTestId('page-layout-block')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    // Layout root suppresses the standard class/source tabs.
    expect(screen.queryByText('Classes')).not.toBeInTheDocument();
    expect(screen.queryByText('Source')).not.toBeInTheDocument();
  });

  it('slot selection (layoutchrome-<pageId>:<selector>) shows normal class controls, NOT PageLayoutBlock', () => {
    h.key = SLOT_KEY;
    render(<DesignBar />);
    expect(screen.queryByTestId('page-layout-block')).not.toBeInTheDocument();
    // Normal element chrome: full Design/Classes/Source tab strip.
    expect(screen.getByText('Classes')).toBeInTheDocument();
    expect(screen.getByText('Source')).toBeInTheDocument();
  });

  it('content root selection shows normal element controls, NOT PageLayoutBlock', () => {
    h.key = 'Hero.astro:5:1';
    render(<DesignBar />);
    expect(screen.queryByTestId('page-layout-block')).not.toBeInTheDocument();
    expect(screen.getByText('Classes')).toBeInTheDocument();
  });

  it('shows the layout name and the (shared) instance menu trigger', () => {
    h.key = LAYOUT_KEY;
    render(<DesignBar />);
    expect(screen.getAllByText('Marketing').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Component options')).toBeInTheDocument();
  });

  it('reuses the normal Design Bar chrome: Design tab strip + go-to-source icon', () => {
    h.key = LAYOUT_KEY;
    render(<DesignBar />);
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.queryByText('Classes')).not.toBeInTheDocument();
    expect(screen.queryByText('Source')).not.toBeInTheDocument();
    expect(screen.getByTitle('Go to source')).toBeInTheDocument();
  });

  it('menu exposes the component lifecycle (Push/Reset/Go to source) AND layout items (Replace/Detach/Delete)', () => {
    h.key = LAYOUT_KEY;
    render(<DesignBar />);
    fireEvent.click(screen.getByTitle('Component options'));
    expect(screen.getByText('Push changes to source')).toBeInTheDocument();
    expect(screen.getByText('Reset to master')).toBeInTheDocument();
    expect(screen.getByText('Go to source')).toBeInTheDocument();
    expect(screen.getByText('Replace layout…')).toBeInTheDocument();
    expect(screen.getByText('Detach (keep content)')).toBeInTheDocument();
    expect(screen.getByText('Delete layout + content')).toBeInTheDocument();
  });

  it('shows the dirty * when the layout instance has local overrides', () => {
    h.doc = buildDoc({ diverged: true });
    h.key = LAYOUT_KEY;
    render(<DesignBar />);
    expect(screen.getAllByText((_, el) => el?.textContent === 'Marketing*').length).toBeGreaterThan(0);
  });

  it('never shows a markup-version ↻ pull icon for a layout (master is live)', () => {
    h.doc = buildDoc({ diverged: true });
    h.key = LAYOUT_KEY;
    render(<DesignBar />);
    expect(screen.queryByTitle('Updates available — pull from source')).toBeNull();
  });

  it('Reset to master drops the layout overrides (CLEAR_INSTANCE_OVERRIDES on its id)', async () => {
    h.applied = [];
    h.doc = buildDoc({ diverged: true });
    h.key = LAYOUT_KEY;
    render(<DesignBar />);
    fireEvent.click(screen.getByTitle('Component options'));
    // Reset runs on the click — no dialog; ⌘Z brings the work back (culture.md Law 6).
    fireEvent.click(screen.getByText('Reset to master'));
    await vi.waitFor(() => {
      expect(h.applied).toContainEqual(
        expect.objectContaining({ type: 'CLEAR_INSTANCE_OVERRIDES', elementId: pageLayoutElementId(PAGE_ID) }),
      );
    });
    expect(h.applied.map((a) => a.type)).not.toContain('UPDATE_STATIC_MARKUP');
    expect(h.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_STATIC_MARKUP' }),
    );
  });

  it('Delete layout + content acts at once — undoable (snapshot first), never a native confirm (culture.md Law 6)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    h.takeSnapshot.mockClear();
    h.key = LAYOUT_KEY;
    render(<DesignBar />);
    fireEvent.click(screen.getByTitle('Component options'));
    fireEvent.click(screen.getByText('Delete layout + content'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DELETE_PAGE_LAYOUT_WITH_CONTENT', pageId: PAGE_ID }),
    );
    const deleted = h.dispatch.mock.calls.findIndex(([c]) => c?.type === 'DELETE_PAGE_LAYOUT_WITH_CONTENT');
    expect(h.takeSnapshot).toHaveBeenCalledTimes(1);
    expect(h.takeSnapshot.mock.invocationCallOrder[0]).toBeLessThan(h.dispatch.mock.invocationCallOrder[deleted]);
    confirmSpy.mockRestore();
  });

  it('Push changes to source fires immediately — no confirm dialog (2026-06-12 user decision)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    h.doc = buildDoc({ diverged: true }); // diverged → push item enabled
    h.key = LAYOUT_KEY;
    render(<DesignBar />);
    fireEvent.click(screen.getByTitle('Component options'));
    fireEvent.click(screen.getByText('Push changes to source'));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('Detach dispatches SET_PAGE_LAYOUT with layoutName=null', () => {
    h.key = LAYOUT_KEY;
    render(<DesignBar />);
    fireEvent.click(screen.getByTitle('Component options'));
    fireEvent.click(screen.getByText('Detach (keep content)'));
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_PAGE_LAYOUT', pageId: PAGE_ID, layoutName: null }),
    );
  });
});
