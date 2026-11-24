/**
 * Audit #14: an unapplied Classes-tab draft followed the selection. Type a draft for A, click B, press
 * Apply → B's whole class list was replaced by A's draft (the tab only resynced while not dirty, and the
 * same tab instance served every element). A draft belongs to the element it was typed for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';

const A = { key: 'src/pages/index.astro:4:3', classes: 'p-4 bg-white text-lg' };
const B = { key: 'src/pages/index.astro:9:3', classes: 'grid grid-cols-3 gap-8 mt-12' };

const h = vi.hoisted(() => ({
  doc: null as unknown,
  selected: null as unknown as { key: string; classes: string },
  setClasses: vi.fn(),
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useDispatch: () => vi.fn(),
}));
vi.mock('@/context/SelectionContext', () => {
  const scan = () => ({ scannedByKey: new Map([A, B].map(e => [e.key, { ...e, parentKey: null }])) });
  return {
    useSelectedElement: () => ({
      key: h.selected.key, classes: h.selected.classes,
      sourceLocation: { file: 'src/pages/index.astro', line: 1, column: 1 }, tagName: 'div',
      computedStyles: null, parentDisplay: null, linkHref: null, linkTarget: null, linkAriaLabel: null,
      imageSrc: null, imageAlt: null, imagePreviewDataUrl: null, postSlug: null, hasSelection: true, isEditingText: false,
    }),
    useSelectionContext: () => ({ additionalSelections: [] }),
    useTextSelection: () => ({ hasTextSelection: false, isInsideLink: false, isLinkInteracting: false, setLinkInteracting: vi.fn() }),
    useScannedElements: scan,
    useScannedElementsRef: () => ({ scannedByKeyRef: { current: scan().scannedByKey } }),
  };
});
vi.mock('@/context/ClassStoreContext', () => ({
  useClassStore: () => ({ setClasses: h.setClasses, getClassesFromYjs: () => null }),
  useElementClasses: () => null,
}));
vi.mock('@/context/StateContext', () => ({ useActiveState: () => ({ activeState: 'default', isEditingState: false }) }));
vi.mock('@/context/BreakpointContext', () => ({
  useActiveBreakpoint: () => ({ activeBreakpoint: 'xs', isEditingBreakpoint: false }),
  PRIMARY_BREAKPOINT: 'xs',
}));
vi.mock('@/context/ThemeContext', () => ({ useActiveTheme: () => ({ activeTheme: 'light', isEditingDark: false }) }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }) }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ openPost: vi.fn(), previewPost: vi.fn() }) }));
vi.mock('@/hooks/useSourceHtml', () => ({ useSourceHtml: () => ({ sourceHtml: '', refetchSourceHtml: vi.fn(), setSourceHtml: vi.fn() }) }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ builtIn: [], userProject: [], refresh: vi.fn() }) }));
vi.mock('@/hooks/useBlogSlotContext', () => ({ useBlogSlotContext: () => ({ isInsideBlogSlot: false, blogSlotKey: null }) }));
vi.mock('@/hooks/useLayoutLibrary', () => ({ useLayoutLibrary: () => ({ layouts: [], isLoading: false, error: null, refresh: () => {} }) }));
vi.mock('@/assets/icons', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});
vi.mock('../ElementDesignPanel', () => ({ default: () => null }));
vi.mock('../tabs/SourceTab', () => ({ SourceTab: () => null }));

import { DesignBar } from '../DesignBar';

function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', 'page-1');
    const page = new Y.Map();
    page.set('id', 'page-1');
    page.set('name', 'Home');
    page.set('rootElementIds', new Y.Array());
    page.set('children', new Y.Array());
    doc.getMap('pages').set('page-1', page);
  }, 'sync');
  return doc;
}
const editor = () => document.querySelector('textarea') as HTMLTextAreaElement;

describe('DesignBar Classes tab: a draft belongs to its element (#14)', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.selected = A;
    h.setClasses.mockClear();
  });

  it('selecting another element drops the unapplied draft; Apply cannot write it there', () => {
    const { rerender } = render(<DesignBar />);
    fireEvent.click(screen.getByRole('tab', { name: 'Classes' }));
    fireEvent.change(editor(), { target: { value: `${A.classes} rounded-xl` } });

    h.selected = B;
    rerender(<DesignBar />);

    expect(editor().value).toBe(B.classes);
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('control: the draft applies to the element it was typed for', () => {
    render(<DesignBar />);
    fireEvent.click(screen.getByRole('tab', { name: 'Classes' }));
    fireEvent.change(editor(), { target: { value: `${A.classes} rounded-xl` } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(h.setClasses).toHaveBeenCalledWith(A.key, `${A.classes} rounded-xl`);
  });
});
