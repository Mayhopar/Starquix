/**
 * task-119 follow-up — the divergence asterisk (*) advertises "instance edited
 * vs its master" and Push targets astroSource. An AI-added markup element has
 * NO master (astroSource null): applying a generated image src writes an
 * imageAttributes override and used to light a misleading * (Push would error
 * with "no source component resolved"). Rule: no master → no asterisk.
 *
 * Harness cloned from DesignBar.blogSettingsIndicator.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import type { EditorCommand } from '@/store/types';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  key: null as string | null,
  classes: '',
  dispatch: vi.fn(),
}));

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
  useClassStore: () => ({ setClasses: vi.fn(), getClassesFromYjs: () => h.classes }),
  useElementClasses: () => h.classes,
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

function headingText(): string {
  const span = document.querySelector('[data-testid="design-bar-heading"]');
  return span?.textContent ?? '';
}

function buildDoc(opts: { astroSource: string | null }): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', 'page-1');
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', 'page-1');
    yPage.set('name', 'Home');
    const roots = new Y.Array<string>();
    roots.push(['el-root']);
    yPage.set('rootElementIds', roots);
    yPage.set('children', new Y.Array());
    pages.set('page-1', yPage);

    const elements = doc.getMap('elements');
    const el = new Y.Map();
    el.set('id', 'el-root');
    el.set('pageId', 'page-1');
    el.set('parentId', null);
    if (opts.astroSource) el.set('astroSource', opts.astroSource);
    el.set('staticMarkup', '<section><img src="/placeholder.webp" alt=""></section>');
    elements.set('el-root', el);
  }, 'sync');
  return doc;
}

function applyGeneratedImage(doc: Y.Doc) {
  applyCommand(doc, {
    type: 'UPDATE_IMAGE_ATTRIBUTE',
    elementId: 'el-root:img-0',
    attribute: 'src',
    value: 'sq-asset:11111111-2222-3333-4444-555555555555',
  } as EditorCommand);
}

describe('DesignBar — no asterisk without a master component (task-119)', () => {
  beforeEach(() => {
    h.key = 'el-root';
    h.classes = '';
    h.dispatch.mockClear();
  });

  it('markup element with NO astroSource + imageAttributes override → no asterisk', () => {
    const doc = buildDoc({ astroSource: null });
    applyGeneratedImage(doc);
    h.doc = doc;
    render(<DesignBar />);
    expect(headingText()).not.toContain('*');
  });

  // The override sits on the `<img>` INSIDE the root `<section>`, and the root
  // is what is selected. Since the 2026-08-03 attribution ruling `*` means
  // "this element diverged", so an ancestor holding a child's edit reports the
  // distinct contains-cue instead. The task-119 contract under test here is
  // unchanged: with NO master there is no indicator AT ALL, with one there is.
  it('same override on an element WITH a master → the indicator stays (the root carries `*` for what it contains)', () => {
    const doc = buildDoc({ astroSource: 'Hero.astro' });
    applyGeneratedImage(doc);
    h.doc = doc;
    render(<DesignBar />);
    expect(headingText()).toContain('*');
  });
});
