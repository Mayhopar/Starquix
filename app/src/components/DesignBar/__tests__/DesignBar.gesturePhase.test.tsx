/**
 * instant-edit P2: the class sink (DesignBar.handleClassesChange) under the value gesture scopes.
 *  - 'stash' (a typed draft's keystroke): the class the field would produce goes to the gesture stash; nothing else.
 *  - 'preview' (a stepper tick): stash + paint (previewClasses); never the lane (setClasses), never onClassesChange.
 *  - 'commit' (a settled gesture, an Enter, a swatch): the normal edit.
 * An aborted gesture must leave NO trace: pendingStorage is not written in a gesture scope (it clears only when the rendered
 * storage changes, so an aborted width would otherwise stay the merge base of the NEXT edit).
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
  storeClasses: null as string | null,
  setClasses: vi.fn(),
  previewClasses: vi.fn(),
  abortClassesPreview: vi.fn(),
  undo: vi.fn(),
  dispatch: vi.fn(),
  additional: [] as Array<{ key: string }>,
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
  useSelectionContext: () => ({ additionalSelections: h.additional }),
  useTextSelection: () => ({
    hasTextSelection: false, isInsideLink: false,
    isLinkInteracting: false, setLinkInteracting: vi.fn(),
  }),
  useScannedElements: scan,
  useScannedElementsRef: () => ({ scannedByKeyRef: { current: scan().scannedByKey } }),
});
});

vi.mock('@/context/ClassStoreContext', () => ({
  useClassStore: () => ({ setClasses: h.setClasses, previewClasses: h.previewClasses, abortClassesPreview: h.abortClassesPreview, getClassesFromYjs: () => h.storeClasses }),
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
  useUndoContext: () => ({ takeSnapshot: vi.fn(), undo: h.undo }),
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

// A block reduced to the three things a number field does: a settled commit, a stepper tick, a typed keystroke.
vi.mock('../blocks/TypographyBlock', async () => {
  const { GestureHostContext, runInGestureScope } = await import('@/components/ui/valueGesture');
  const React = await import('react');
  return {
    TypographyBlock: ({ classes, onClassesChange }: { classes: string; onClassesChange: (c: string) => void }) => {
      const host = React.useContext(GestureHostContext);
      const withWidth = (width: string) => `${classes.replace(/\bw-\[\d+px\]/g, '').trim()} ${width}`.trim();
      return (
        <div>
          <button data-testid="commit" onClick={() => onClassesChange(withWidth('w-[300px]'))} />
          <button data-testid="tick" onClick={() => runInGestureScope('preview', () => onClassesChange(withWidth('w-[101px]')))} />
          <button data-testid="key" onClick={() => runInGestureScope('stash', () => onClassesChange(withWidth('w-[3px]')))} />
          <button data-testid="abort" onClick={() => host?.abort()} />
          <span data-testid="pin">{host?.pin}</span>
        </div>
      );
    },
  };
});

// The multi panel reduced to the gesture host it is rendered under.
vi.mock('../multi/MultiDesignPanel', async () => {
  const { GestureHostContext } = await import('@/components/ui/valueGesture');
  const React = await import('react');
  return { MultiDesignPanel: () => <span data-testid="multi-host">{React.useContext(GestureHostContext) === null ? 'none' : 'host'}</span> };
});

vi.mock('../blocks/PositionBlock', () => ({ PositionBlock: () => null }));
vi.mock('../blocks/AppearanceBlock', () => ({ AppearanceBlock: () => null }));
// The Layout block reduced to its grid-count writer (DesignBar.handleGridTemplateChange, from fix/grid-snap).
vi.mock('../blocks/LayoutAppearanceBlock', async () => {
  const { runInGestureScope } = await import('@/components/ui/valueGesture');
  return {
    LayoutAppearanceBlock: ({ onGridTemplateChange }: { onGridTemplateChange?: (axis: 'col' | 'row', count: number | null) => void }) => (
      <div>
        <button data-testid="grid-key" onClick={() => runInGestureScope('stash', () => onGridTemplateChange?.('col', 3))} />
        <button data-testid="grid-commit" onClick={() => onGridTemplateChange?.('col', 3)} />
      </div>
    ),
  };
});
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
import { _resetGestureStashForTests, stashEntries } from '@/services/gestureStash';

function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', PAGE_ID);
    doc.getMap('meta').set('projectId', 'browser_gesture_phase');
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

beforeEach(() => {
  h.doc = buildDoc(); h.storeClasses = RICH; h.additional = [];
  for (const fn of [h.setClasses, h.previewClasses, h.abortClassesPreview, h.undo, h.dispatch]) fn.mockClear();
  _resetGestureStashForTests();
});
const stashed = () => stashEntries('browser_gesture_phase');

describe('DesignBar class sink under the value gesture scopes', () => {
  it('commit scope: the normal edit (setClasses once, nothing previewed)', () => {
    render(<DesignBar />);
    fireEvent.click(screen.getByTestId('commit'));
    expect(h.setClasses).toHaveBeenCalledTimes(1);
    expect(h.setClasses.mock.calls[0][1]).toContain('w-[300px]');
    expect(h.previewClasses).not.toHaveBeenCalled();
  });

  it('stepper tick (preview): paints and stashes the composed class; never the lane', () => {
    render(<DesignBar />);
    fireEvent.click(screen.getByTestId('tick'));
    fireEvent.click(screen.getByTestId('tick'));
    expect(h.setClasses).not.toHaveBeenCalled();
    expect(h.previewClasses).toHaveBeenCalledTimes(2);
    const [key, classes] = h.previewClasses.mock.calls[1] as [string, string];
    expect(key).toBe(KEY);
    expect(classes).toContain('w-[101px]');
    expect(classes).toContain('text-2xl');                       // the element's other classes survive
    expect(stashed()).toEqual([expect.objectContaining({ key: KEY, baseline: RICH, opId: null })]);
    expect(stashed()[0].classes).toContain('w-[101px]');
  });

  it('typed keystroke (stash): only the safety net — no paint, no lane', () => {
    render(<DesignBar />);
    fireEvent.click(screen.getByTestId('key'));
    expect(h.setClasses).not.toHaveBeenCalled();
    expect(h.previewClasses).not.toHaveBeenCalled();
    expect(stashed()[0].classes).toContain('w-[3px]');
  });

  it('abort restores the canvas, clears the stash, and the NEXT edit does not carry the aborted value', () => {
    render(<DesignBar />);
    fireEvent.click(screen.getByTestId('tick')); fireEvent.click(screen.getByTestId('tick'));
    fireEvent.click(screen.getByTestId('abort'));
    expect(h.abortClassesPreview).toHaveBeenCalledWith(KEY);
    expect(stashed()).toEqual([]);
    fireEvent.click(screen.getByTestId('commit'));
    const stored = (h.setClasses.mock.calls[0] as [string, string])[1];
    expect(stored).not.toContain('w-[101px]');
    expect(stored).toContain('w-[300px]');
    expect(stored).toContain('text-2xl');
  });

  it('grid count writes obey the scope too: a typed keystroke only stashes, a commit writes once', () => {
    render(<DesignBar />);
    fireEvent.click(screen.getByText('Layout'));
    fireEvent.click(screen.getByTestId('grid-key'));
    expect(h.setClasses).not.toHaveBeenCalled();
    expect(stashed()[0].classes).toContain('grid-cols-3');
    fireEvent.click(screen.getByTestId('grid-commit'));
    expect(h.setClasses).toHaveBeenCalledTimes(1);
    expect(h.setClasses.mock.calls[0][1]).toContain('grid-cols-3');
  });

  it('the host pin names the element, breakpoint, theme and state; the host is provided to the blocks', () => {
    render(<DesignBar />);
    expect(screen.getByTestId('pin').textContent).toBe(`${KEY}|xs|light|default`);
  });

  it('multi-select: the panel gets NO gesture host (its sink ignores the scope: a stash keystroke / preview tick would be a real group edit)', () => {
    h.additional = [{ key: 'src/components/Other.astro:1:1' }];
    render(<DesignBar />);
    expect(screen.getByTestId('multi-host').textContent).toBe('none');
  });
});
