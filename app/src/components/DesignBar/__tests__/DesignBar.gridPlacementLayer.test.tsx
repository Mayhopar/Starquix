/**
 * Owner 2026-11-12: "I can't get children to snap to the columns I set both in
 * design bar and on canvas … it fails especially miserably in the ul→li
 * structure."
 *
 * Proven live (desktop, lg canvas, a 6-column `ul` of `lg:col-span-N` cards):
 * the panel edited the BASE layer while the placement in force lived on `lg:`
 * (authored, or written by a canvas drag). `col-span-4` beside `lg:col-span-2`
 * changes nothing at lg, and the Start/Span fields were empty because the
 * rendered cell was gated on the editing layer, not on the canvas breakpoint.
 *
 * Grid placement is read and written on the layer the canvas shows — the same
 * layer the canvas drag and resize write.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';

const PAGE_ID = 'page-1';
const FILE = 'src/pages/index.astro';
const PARENT_KEY = `${FILE}:6:1`;
const KEY = `${FILE}:9:1`;
const PARENT_CLASSES = 'grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-6';
const CARD = 'min-w-0 lg:col-span-2 p-6';


const h = vi.hoisted(() => ({
  doc: null as unknown,
  localPath: '/Users/me/my-astro-site' as string | null,
  classes: '' as string,
  /** Which element is selected: the card (a grid child) or the list itself. */
  container: false,
  setClasses: (() => {}) as (key: string, classes: string) => void,
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
      [PARENT_KEY, { key: PARENT_KEY, classes: PARENT_CLASSES, parentKey: null }],
      [KEY, { key: KEY, classes: h.classes, parentKey: PARENT_KEY, parentDisplay: 'grid' }],
    ]),
  });
  return ({
  useSelectedElement: () => ({
    key: h.container ? PARENT_KEY : KEY,
    sourceLocation: { file: FILE, line: h.container ? 6 : 9, column: 1 },
    tagName: 'div',
    classes: h.classes,
    computedStyles: null,
    parentDisplay: h.container ? 'block' : 'grid',
    linkHref: null, linkTarget: null, linkAriaLabel: null,
    imageSrc: null, imageAlt: null, imagePreviewDataUrl: null,
    postSlug: null,
    hasSelection: true,
    isEditingText: false,
  }),
  useSelectionContext: () => ({ additionalSelections: [] }),
  useSelectedRectOptional: () => null,
  useTextSelection: () => ({
    hasTextSelection: false, isInsideLink: false,
    isLinkInteracting: false, setLinkInteracting: vi.fn(),
  }),
  useScannedElements: scan,
  useScannedElementsRef: () => ({ scannedByKeyRef: { current: scan().scannedByKey } }),
});
});

vi.mock('@/context/ClassStoreContext', () => ({
  useClassStore: () => ({
    setClasses: (key: string, classes: string) => h.setClasses(key, classes),
    getClassesFromYjs: (key: string) => (key === (h.container ? PARENT_KEY : KEY) ? h.classes : PARENT_CLASSES),
  }),
  useElementClasses: () => h.classes,
}));
vi.mock('@/context/StateContext', () => ({
  useActiveState: () => ({ activeState: 'default', isEditingState: false }),
}));
vi.mock('@/context/BreakpointContext', () => ({
  // The owner's default: the canvas is at lg, the editing layer stays on base.
  useActiveBreakpoint: () => ({ activeBreakpoint: 'xs', isEditingBreakpoint: false, viewportBreakpoint: 'lg' }),
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
import { setSelectedCellGeometry, clearSelectedCellGeometry } from '@/store/gridGeometryStore';

function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', PAGE_ID);
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    doc.getMap('pages').set(PAGE_ID, yPage);
  }, 'sync');
  return doc;
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const commit = (label: string, value: string) => {
  fireEvent.focus(field(label));
  fireEvent.change(field(label), { target: { value } });
  fireEvent.blur(field(label));
};

describe('grid placement is edited on the layer the canvas shows', () => {
  let written: string[];
  beforeEach(() => {
    h.doc = buildDoc();
    h.classes = CARD;
    h.container = false;
    written = [];
    h.setClasses = (_key, classes) => { written.push(classes); };
    // The frame measured this card at lg: column 3, two tracks wide, second row.
    setSelectedCellGeometry({ key: KEY, breakpoint: 'lg', start: 3, span: 2, rowStart: 2, rowSpan: 1, parentCols: 6, parentRows: 2 });
  });
  afterEach(() => clearSelectedCellGeometry());

  it('shows the placement in force at the canvas breakpoint, not an empty base layer', () => {
    render(<DesignBar />);
    expect(field('Column span').value).toBe('2'); // lg:col-span-2
    expect(field('Column start').value).toBe('3'); // rendered cell
    expect(field('Row start').value).toBe('2');
  });

  it('a Span edit replaces the lg span — a base span beside it would change nothing', () => {
    render(<DesignBar />);
    commit('Column span', '4');
    const classes = written.at(-1)!.split(/\s+/);
    expect(classes).toContain('lg:col-span-4');
    expect(classes).not.toContain('lg:col-span-2');
    expect(classes).not.toContain('col-span-4');
  });

  it('a Start edit lands on lg and keeps the span the card shows', () => {
    render(<DesignBar />);
    commit('Column start', '5');
    const classes = written.at(-1)!.split(/\s+/);
    expect(classes).toContain('lg:col-start-5');
    expect(classes).toContain('lg:col-span-2');
    expect(classes).not.toContain('col-start-5');
  });

  it('span 1 overrides a wider span from a smaller breakpoint', () => {
    h.classes = 'min-w-0 md:col-span-2 p-6';
    render(<DesignBar />);
    commit('Column span', '1');
    expect(written.at(-1)!.split(/\s+/)).toEqual(expect.arrayContaining(['md:col-span-2', 'lg:col-span-1']));
  });

  it('a span edit drops a fixed width from every layer that applies (column-first sizing)', () => {
    h.classes = 'w-[390px] xl:w-96 p-6';
    render(<DesignBar />);
    commit('Column span', '3');
    const classes = written.at(-1)!.split(/\s+/);
    expect(classes).toContain('lg:col-span-3');
    expect(classes).not.toContain('w-[390px]');
    expect(classes).toContain('xl:w-96');
  });

  // The same trap one level up: "the columns I set". Live on a
  // grid-cols-1 md:grid-cols-2 lg:grid-cols-3 list at an lg canvas: the field
  // showed 1, and typing 4 wrote a base grid-cols-4 — still 3 columns on
  // canvas, 4 on a phone. (This list is the 6-column one.)
  describe('the list itself: its column count', () => {
    const columns = (container: HTMLElement) => container.querySelectorAll('input[placeholder="0"]')[0] as HTMLInputElement;
    beforeEach(() => { h.container = true; h.classes = PARENT_CLASSES; clearSelectedCellGeometry(); });

    it('shows the count in force on canvas', () => {
      const { container } = render(<DesignBar />);
      expect(columns(container).value).toBe('6');
    });

    it('a new count replaces the one in force, where it lives', () => {
      const { container } = render(<DesignBar />);
      fireEvent.change(columns(container), { target: { value: '4' } });
      const classes = written.at(-1)!.split(/\s+/);
      expect(classes).toContain('lg:grid-cols-4');
      expect(classes).not.toContain('lg:grid-cols-6');
      expect(classes).not.toContain('grid-cols-4');
      expect(classes).toEqual(expect.arrayContaining(['grid-cols-1', 'md:grid-cols-2']));
    });

    it('a list with one count for every width keeps it on the base layer', () => {
      h.classes = 'grid grid-cols-3 gap-4';
      const { container } = render(<DesignBar />);
      fireEvent.change(columns(container), { target: { value: '4' } });
      expect(written.at(-1)!.split(/\s+/).sort()).toEqual(['gap-4', 'grid', 'grid-cols-4']);
    });
  });
});
