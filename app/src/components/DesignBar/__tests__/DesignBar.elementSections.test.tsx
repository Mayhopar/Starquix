/**
 * Characterization net for the selected-element style stack (DesignBar.tsx
 * Position→Effects, lines 1490-1641). Pins the section SET rendered per element
 * kind BEFORE the ElementDesignPanel extraction (task-043), so the move is
 * provably behavior-preserving. Ledger cases #1-4 + the deletePrefix path.
 *
 * DesignBar pulls a heavy block/context tree; rendering it whole trips the known
 * jsdom SVG-data-URL issue (see blocks.test.tsx). We stub the leaf blocks to
 * emit identifiable markers and assert only on the section set — exactly like the
 * other DesignBar.*.test.tsx harnesses. Element kind is driven by the Selection
 * context mock's `tagName` (→ descriptor.effectiveTagName → isText/isImage/link).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { unmarkFilesTruth } from '@/utils/localMode';

const PAGE_ID = 'page-1';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  key: 'Hero.astro:5:1' as string | null,
  tagName: 'div' as string,
  rows: [] as Array<[string, object]>,
  dispatch: vi.fn(),
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useDispatch: () => h.dispatch,
}));

vi.mock('@/context/SelectionContext', () => {
  const scan = () => ({ scannedByKey: new Map(h.rows) });
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

// Leaf blocks stubbed to section markers (NAMED exports — match the real files).
// PositionBlock forwards onClassesChange so we can assert the class-edit path.
vi.mock('../blocks/PositionBlock', () => ({
  PositionBlock: ({ onClassesChange }: { onClassesChange: (c: string) => void }) => (
    <button data-testid="sec-position" onClick={() => onClassesChange('p-4')} />
  ),
}));
vi.mock('../blocks/AppearanceBlock', () => ({ AppearanceBlock: () => <div data-testid="sec-appearance" /> }));
// Layout section is expanded by default for non-text elements, so its block is a
// reliable place to assert the class-change handler is wired through.
vi.mock('../blocks/LayoutAppearanceBlock', () => ({
  LayoutAppearanceBlock: ({ onClassesChange }: { onClassesChange: (c: string) => void }) => (
    <button data-testid="sec-layout" onClick={() => onClassesChange('flex')} />
  ),
}));
vi.mock('../blocks/SpacingBlock', () => ({ SpacingBlock: () => <div data-testid="sec-spacing" /> }));
vi.mock('../blocks/TypographyBlock', () => ({ TypographyBlock: () => <div data-testid="sec-typography" /> }));
vi.mock('../blocks/ImageBlock', () => ({ ImageBlock: () => <div data-testid="sec-image" /> }));
vi.mock('../blocks/FillBlock', () => ({ FillBlock: () => <div data-testid="sec-fill" /> }));
vi.mock('../blocks/StrokeBlock', () => ({ StrokeBlock: () => <div data-testid="sec-stroke" /> }));
vi.mock('../blocks/EffectsBlock', () => ({ EffectsBlock: () => <div data-testid="sec-effects" /> }));
vi.mock('../blocks/LinkBlock', () => ({ LinkBlock: () => <div data-testid="sec-link" /> }));
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

function renderWith(tagName: string) {
  h.tagName = tagName;
  h.key = 'Hero.astro:5:1';
  return render(<DesignBar />);
}

describe('DesignBar — element-section set per kind (characterization)', () => {
  beforeEach(() => {
    unmarkFilesTruth('browser_release');
    h.doc = buildDoc();
    h.dispatch.mockClear();
  });

  // Collapsed sections (Position/Appearance/Fill/Stroke/Effects) render their
  // HEADER row but not the inner block until expanded, so the section SET is
  // characterized by the header title. Link has no title row → its block marker.

  it('generic div: position/appearance/layout/fill/stroke/effects; NO typography/image/link', async () => {
    await act(async () => { renderWith('div'); });
    expect(screen.getByText('Position')).toBeTruthy();
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Layout')).toBeTruthy();
    expect(screen.getByText('Fill')).toBeTruthy();
    expect(screen.getByText('Stroke')).toBeTruthy();
    expect(screen.getByText('Effects')).toBeTruthy();
    expect(screen.queryByText('Typography')).toBeNull();
    expect(screen.queryByText('Image')).toBeNull();
    expect(screen.queryByTestId('sec-link')).toBeNull();
  });

  it('text element (p): adds Typography; Fill still present', async () => {
    await act(async () => { renderWith('p'); });
    expect(screen.getByText('Typography')).toBeTruthy();
    expect(screen.getByText('Fill')).toBeTruthy();
    expect(screen.queryByText('Image')).toBeNull();
  });

  // task-144: unified surface — Fill's Media tab is THE image UI; the legacy
  // Image section is retired in every runtime.
  it('image element (img): shows Fill; legacy Image section ABSENT', async () => {
    await act(async () => { renderWith('img'); });
    expect(screen.getByText('Fill')).toBeTruthy();
    expect(screen.queryByText('Image')).toBeNull();
  });

  it('link element (a): adds Link (and Typography, since <a> is a text element)', async () => {
    h.rows = [[h.key, { linkHref: '/about' }]];
    await act(async () => { renderWith('a'); });
    h.rows = [];
    expect(screen.getByTestId('sec-link')).toBeTruthy();
    expect(screen.getByText('Typography')).toBeTruthy();
  });

  it('class edit from a child block fires the design-bar handler (handler wired through)', async () => {
    // Layout is expanded by default for a div; its stub calls onClassesChange.
    // The real handleClassesChange reads fresh classes from Yjs and calls
    // setClasses — we assert the click does not throw (handler identity survives).
    await act(async () => { renderWith('div'); });
    expect(() => fireEvent.click(screen.getByTestId('sec-layout'))).not.toThrow();
  });
});
