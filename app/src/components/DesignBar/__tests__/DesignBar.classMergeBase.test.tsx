/**
 * Regression: ONE colour swatch must never wipe the element's real class list.
 *
 * DesignBar's whole class model is fed by a SINGLE tier — `sourceClasses`
 * (useElementClasses → fullClasses → storage → currentClasses, and
 * getClassesFromYjs as the fresh-merge base in handleClassesChange). The
 * element's REAL classes, which the selection descriptor already carries
 * (SelectionContext `classes`, straight off the DOM via the bridge's
 * ELEMENT_CLICK/scan payload), are never consulted.
 *
 * So when the tier has no entry for the selected key — a selection that
 * reached the panel without ClassStore.registerElement (the Layers panel never
 * registers; an undo that predates the registration deletes the entry via
 * UndoContext's deleteMissingKeys) — the panel believes the element is
 * class-less. The colour block then computes its new class string from an
 * EMPTY base and emits just `text-red-500`, handleClassesChange stores that as
 * the element's whole class attribute, and the bridge's UPDATE_CLASSES handler
 * (`setAttribute('class', …)`, bridge/parts/dom-updates.ts) REPLACES the live
 * class attribute with it — on this page and, via the ELEMENTS_SCANNED
 * re-apply (viewportMessages/scanning.ts), on every other page that renders
 * the same source key.
 *
 * Case 1 pins the defect: with an empty tier the untouched tokens must
 * survive. Case 2 is the control — with the tier populated the merge already
 * works, so the fix is scoped to "where does the base come from", not to the
 * merge itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';

const PAGE_ID = 'page-1';
const KEY = 'src/components/Header.astro:12:3';

/** The live class attribute of the selected heading. */
const RICH =
  'font-sans text-2xl font-bold leading-tight tracking-tight text-stone-800 sm:text-3xl lg:tracking-[-1.44px]';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  /** what the sourceClasses tier holds for KEY (null = NO entry at all) */
  storeClasses: null as string | null,
  setClasses: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useDispatch: () => h.dispatch,
}));

vi.mock('@/context/SelectionContext', () => {
  const scan = () => ({
    scannedByKey: new Map([[KEY, { key: KEY, classes: RICH, parentKey: null }]]),
  });
  return ({
  useSelectedElement: () => ({
    key: KEY,
    sourceLocation: { file: 'src/components/Header.astro', line: 12, column: 3 },
    tagName: 'h2',
    // The DOM truth the bridge sent with ELEMENT_CLICK.
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
  useClassStore: () => ({ setClasses: h.setClasses, getClassesFromYjs: () => h.storeClasses }),
  useElementClasses: () => h.storeClasses,
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

// The colour swatch, reduced to exactly what the real TypographyBlock does for
// a text colour (blocks/TypographyBlock.tsx:423): drop any existing text-colour
// token from the `classes` prop it was handed, append the picked one, emit.
vi.mock('../blocks/TypographyBlock', async () => {
  const { setClass } = await import('../utils');
  return {
    TypographyBlock: ({ classes, onClassesChange }: { classes: string; onClassesChange: (c: string) => void }) => (
      <button
        data-testid="swatch-red"
        onClick={() => {
          const stripped = setClass(
            classes,
            /^text-(transparent|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(-\d+)?$/,
            null,
          );
          onClassesChange(`${stripped} text-red-500`.trim());
        }}
      />
    ),
  };
});

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
  }, 'sync');
  return doc;
}

/** Tokens handed to ClassStore.setClasses by the swatch click. */
function clickSwatchAndReadStoredTokens(): string[] {
  render(<DesignBar />);
  fireEvent.click(screen.getByTestId('swatch-red'));
  expect(h.setClasses).toHaveBeenCalled();
  const [, stored] = h.setClasses.mock.calls[h.setClasses.mock.calls.length - 1] as [string, string];
  return stored.split(/\s+/).filter(Boolean);
}

describe('DesignBar — one colour edit must preserve the element’s other classes', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.setClasses.mockClear();
    h.dispatch.mockClear();
  });

  it('element NOT registered in sourceClasses: the untouched tokens survive the swatch', () => {
    h.storeClasses = null; // NO tier entry — the DOM/selection classes are the only truth

    const tokens = clickSwatchAndReadStoredTokens();

    expect(tokens).toContain('text-red-500');      // the edit itself
    expect(tokens).toContain('text-2xl');          // size
    expect(tokens).toContain('font-bold');         // weight
    expect(tokens).toContain('font-sans');
    expect(tokens).toContain('leading-tight');
    expect(tokens).toContain('tracking-tight');
    expect(tokens).toContain('sm:text-3xl');       // responsive variants
    expect(tokens).toContain('lg:tracking-[-1.44px]');
    expect(tokens).not.toContain('text-stone-800'); // replaced colour is gone
  });

  it('control — element registered with its real classes: the merge already works', () => {
    h.storeClasses = RICH;

    const tokens = clickSwatchAndReadStoredTokens();

    expect(tokens).toContain('text-red-500');
    expect(tokens).toContain('text-2xl');
    expect(tokens).toContain('font-bold');
    expect(tokens).toContain('sm:text-3xl');
    expect(tokens).toContain('lg:tracking-[-1.44px]');
    expect(tokens).not.toContain('text-stone-800');
  });

  /**
   * The empty-string hole in the fallback above: `useElementClasses` used to
   * answer '' both for "no entry" and for "the user deleted every class", and
   * '' is falsy — so a deliberate strip-to-nothing fell through to the scan
   * payload and the next colour click RESURRECTED the classes just deleted.
   * Absence (null) and emptiness ('') must be distinguished; an existing entry
   * is authoritative even when empty.
   */
  it('element registered with an EMPTY class list: the swatch must not resurrect deleted classes', () => {
    h.storeClasses = ''; // entry EXISTS and is empty — the user stripped it

    const tokens = clickSwatchAndReadStoredTokens();

    expect(tokens).toEqual(['text-red-500']);
    expect(tokens).not.toContain('text-2xl');
    expect(tokens).not.toContain('sm:text-3xl');
  });
});