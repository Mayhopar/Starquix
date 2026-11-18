import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { matchPendingSelect, handleElementsScanned } from '../scanning';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { selectRootElementIds } from '@/store/selectors';
import { applyCommand } from '@/store/commands';
import {
  sourceClassBaseValue,
  sourceBaseValue,
  forEachSourceImageAttrsEntry,
} from '@/store/sourceOverrideEntries';
import { localMasterOutdated, hasLocalMasterOverrides } from '@/store/localMasterOverrides';
import {
  getClassWriteBaseline,
  noteClassWriteBaseline,
  setClassWriteBaseline,
  resetClassWriteBaselines,
} from '@/services/classWriteBaseline';

const el = (key: string, parentKey: string | null = null, extra: Record<string, unknown> = {}) => ({
  key, parentKey, tagName: 'div', classes: '', rect: { top: 0, left: 0, width: 10, height: 10 }, ...extra,
});

function docWithPage(pageId: string) {
  const doc = new Y.Doc();
  const pages = doc.getMap('pages');
  const page = new Y.Map();
  pages.set(pageId, page);
  page.set('rootElementIds', new Y.Array<string>());
  return doc;
}

describe('ELEMENTS_SCANNED', () => {
  it('forwards elements into SelectionContext', () => {
    const ctx = makeFakeCtx();
    handleElementsScanned(ctx, { elements: [el('a')] });
    expect(ctx.actions.setScannedElements).toHaveBeenCalledWith([el('a')]);
  });

  it('eagerly seeds rootElementIds from the first scan (sync origin)', () => {
    const doc = docWithPage('page-1');
    const ctx = makeFakeCtx({
      refs: { currentPageId: { current: 'page-1' } },
      env: { doc },
    });
    handleElementsScanned(ctx, { elements: [el('el-1:div-0'), el('el-2:div-0')] });
    expect(selectRootElementIds(doc, 'page-1')).toEqual(['el-1', 'el-2']);
  });

  it('never seeds the layout-chrome element into rootElementIds (2026-08-26)', () => {
    // The chrome <slot> scans as a root-level instance-child
    // (`layoutchrome-<pageId>:slot-0` under the page wrapper) and its
    // elementId is the layout-chrome ELEMENT — which layoutElement.ts forbids
    // in rootElementIds. Seeding it made selectPageComponents render the
    // chrome as content filling its own slot (div+slot twins, one data-key).
    const doc = docWithPage('page-1');
    const ctx = makeFakeCtx({
      refs: { currentPageId: { current: 'page-1' } },
      env: { doc },
    });
    handleElementsScanned(ctx, {
      elements: [
        el('layoutchrome-page-1:slot-0', null, { tagName: 'slot' }),
        el('el-1:div-0'),
      ],
    });
    expect(selectRootElementIds(doc, 'page-1')).toEqual(['el-1']);
  });

  it('does not reseed when rootElementIds already exist', () => {
    const doc = docWithPage('page-1');
    const ctx = makeFakeCtx({
      refs: { currentPageId: { current: 'page-1' } },
      env: { doc },
    });
    handleElementsScanned(ctx, { elements: [el('el-1:div-0')] });
    handleElementsScanned(ctx, { elements: [el('el-9:div-0'), el('el-1:div-0')] });
    expect(selectRootElementIds(doc, 'page-1')).toEqual(['el-1']);
  });

  it('refreshes the selected rect from the new scan, clearing when gone', () => {
    const ctx = makeFakeCtx({ refs: { selectedKey: { current: 'k1' } } });
    handleElementsScanned(ctx, { elements: [el('k1')] });
    expect(ctx.actions.updateSelectionRect).toHaveBeenCalledWith(el('k1').rect);
    handleElementsScanned(ctx, { elements: [el('other')] });
    expect(ctx.actions.updateSelectionRect).toHaveBeenLastCalledWith(null);
  });

  it('auto-selects the pending element after replace', () => {
    const ctx = makeFakeCtx({ refs: { pendingSelect: { current: 'el-5' } } });
    handleElementsScanned(ctx, { elements: [el('el-5:section-0')] });
    expect(ctx.refs.pendingSelect.current).toBeNull();
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith('el-5:section-0', expect.anything());
    // task-075: no command dispatch — selectInContext is the single write
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
  });

  // The same matcher serves ViewportFrame's sq:pending-select listener, which
  // selects immediately when the target is already scanned (re-clicking the
  // open master in Assets — no scan follows).
  it('matchPendingSelect: an id matches itself or its children; a master FILE resolves to its root', () => {
    const els = [el('src/components/Header.astro:3:1'), el('src/layouts/Main.astro:20:2'), el('src/layouts/Main.astro:22:4', 'src/layouts/Main.astro:20:2')];
    expect(matchPendingSelect('src/layouts/Main.astro', els)?.key).toBe('src/layouts/Main.astro:20:2');
    expect(matchPendingSelect('src/layouts/Main.astro:22:4', els)?.key).toBe('src/layouts/Main.astro:22:4');
    expect(matchPendingSelect('src/layouts/Other.astro', els)).toBeUndefined();
  });

  it('auto-enters the infra wrapper context WITHOUT selecting (f686ccc)', () => {
    const wrapperKey = 'src/pages/preview/[projectId]/[pageId].astro:10:1';
    const ctx = makeFakeCtx();
    handleElementsScanned(ctx, { elements: [el(wrapperKey)] });
    expect(ctx.refs.enterContext.current).toHaveBeenCalledWith(wrapperKey);
    expect(ctx.refs.selectInContext.current).not.toHaveBeenCalled();
  });

  it('replays a pending class update onto the SAME key and clears the queue', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const pending = new Map([['src/a.astro:5:1', { key: 'src/a.astro:5:1', classes: 'p-4' }]]);
    const ctx = makeFakeCtx({ refs: { iframe, pendingKeyUpdates: { current: pending } } });
    handleElementsScanned(ctx, {
      elements: [el('src/a.astro:5:1', null, { sourceLocation: { file: 'src/a.astro', line: 5, column: 1 } })],
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_CLASSES',
        payload: expect.objectContaining({ key: 'src/a.astro:5:1', classes: 'p-4' }),
      }), '*',
    );
    expect(pending.size).toBe(0);
  });

  /**
   * task-181 — the owner report: "when I change instance bg and go to master,
   * background also changes without pushing to the master".
   *
   * The queue used to have a SECOND map keyed `file:line` (no column, no
   * placement) and the replay took the FIRST scanned element on that line.
   * `file:line` is not an element's address: the two cases below both collapse
   * onto one. Reproduced live 2026-08-05 on the r17 fixture — one-shot, clean on
   * the second visit, which is what a parent-held ref surviving a navigation
   * looks like.
   */
  describe('a queued class edit must never repaint a DIFFERENT element (task-181)', () => {
    const postedClasses = (postMessage: ReturnType<typeof vi.fn>) =>
      postMessage.mock.calls
        .filter(([m]) => m?.type === 'UPDATE_CLASSES')
        .map(([m]) => `${m.payload.key}=${m.payload.classes}`);

    it('does not paint the master view with an edit made on a page instance', () => {
      const { iframe, postMessage } = makeFakeIframe();
      // Queued on the PAGE: the key carries the placement it was rendered in.
      const pending = new Map([[
        'src/components/DynCard.astro:4:52~sbc0b0d5634d3ccf6',
        { key: 'src/components/DynCard.astro:4:52~sbc0b0d5634d3ccf6', classes: 'dyncard bg-red-950' },
      ]]);
      const ctx = makeFakeCtx({ refs: { iframe, pendingKeyUpdates: { current: pending } } });

      // The master view (/__sq_component_view/…) renders the component alone —
      // no placement ancestor, so its root's key is BARE.
      handleElementsScanned(ctx, {
        elements: [el('src/components/DynCard.astro:4:52', null, {
          classes: 'dyncard bg-slate-100',
          sourceLocation: { file: 'src/components/DynCard.astro', line: 4, column: 52 },
        })],
      });

      expect(postedClasses(postMessage)).toEqual([]);
    });

    it('does not paint sibling placement A with an edit made on placement B', () => {
      const { iframe, postMessage } = makeFakeIframe();
      const A = 'src/components/DynCard.astro:4:52~sbc0b0d5634d3ccf6';
      const B = `${A}#1`;
      const pending = new Map([[B, { key: B, classes: 'dyncard bg-red-950' }]]);
      const ctx = makeFakeCtx({ refs: { iframe, pendingKeyUpdates: { current: pending } } });

      const loc = { file: 'src/components/DynCard.astro', line: 4, column: 52 };
      handleElementsScanned(ctx, {
        elements: [
          el(A, null, { classes: 'dyncard bg-slate-100', sourceLocation: loc }),
          el(B, null, { classes: 'dyncard bg-red-950', sourceLocation: loc }),
        ],
      });

      expect(postedClasses(postMessage)).toEqual([`${B}=dyncard bg-red-950`]);
    });
  });
});

describe('source-text re-apply on scan', () => {
  function ctxWithSourceText(
    entries: Record<string, string>,
    refOverrides: Record<string, { current: unknown }> = {},
  ) {
    const { iframe, postMessage } = makeFakeIframe();
    const doc = new Y.Doc();
    const ctx = makeFakeCtx({
      refs: { iframe, ...refOverrides },
      env: { doc },
    });
    doc.transact(() => {
      const map = doc.getMap('sourceText');
      for (const [key, text] of Object.entries(entries)) {
        const yEntry = new Y.Map();
        yEntry.set('textContent', text);
        map.set(key, yEntry);
      }
    });
    return { ctx, postMessage };
  }

  it('posts UPDATE_TEXT for source-kind entries matching a scanned element', () => {
    const key = 'src/pages/index.astro:5:1';
    const { ctx, postMessage } = ctxWithSourceText({ [key]: 'Edited heading' });
    handleElementsScanned(ctx, { elements: [el(key, null, { tagName: 'h1' })] });
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'UPDATE_TEXT', payload: { key, textContent: 'Edited heading' } },
      '*',
    );
  });

  it('skips drawn keys and unmatched keys', () => {
    const { ctx, postMessage } = ctxWithSourceText({
      'drawn-abc': 'drawn',                       // wrong kind
      'src/pages/other.astro:9:1': 'not on page', // no scanned match
    });
    handleElementsScanned(ctx, { elements: [el('src/pages/index.astro:5:1', null, { tagName: 'h1' })] });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_TEXT' }), expect.anything(),
    );
  });

  it('skips entirely while editing text', () => {
    const key = 'src/pages/index.astro:5:1';
    const { ctx, postMessage } = ctxWithSourceText(
      { [key]: 'Edited' },
      { isEditingText: { current: true } },
    );
    handleElementsScanned(ctx, { elements: [el(key, null, { tagName: 'h1' })] });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_TEXT' }), expect.anything(),
    );
  });

  it('does not re-send when the scanned element already carries the same text', () => {
    const key = 'src/pages/index.astro:5:1';
    const { ctx, postMessage } = ctxWithSourceText({ [key]: 'Same' });
    handleElementsScanned(ctx, { elements: [el(key, null, { tagName: 'h1', textContent: 'Same' })] });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_TEXT' }), expect.anything(),
    );
  });

  // Regression (2026-07-24): AI text edits on AI-created sections
  // (update_element_by_key → UPDATE_SOURCE_TEXT with an `elementId:h2-0`
  // instance-child key) rendered live via SYNC_TEXT_TO_IFRAME but silently
  // vanished on editor reload — the scan re-apply only handled source-file
  // keys and nothing else re-applies instance-child sourceText entries.
  it('posts UPDATE_TEXT for instance-child entries matching a scanned element', () => {
    const key = 'element-1753357000000:h2-0';
    const { ctx, postMessage } = ctxWithSourceText({ [key]: 'Mock Section A (edited)' });
    handleElementsScanned(ctx, { elements: [el(key, null, { tagName: 'h2', textContent: 'Mock Section A' })] });
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'UPDATE_TEXT', payload: { key, textContent: 'Mock Section A (edited)' } },
      '*',
    );
  });

  it('instance-child entries with no scanned match stay inert', () => {
    const { ctx, postMessage } = ctxWithSourceText({ 'element-999:h2-0': 'gone' });
    handleElementsScanned(ctx, { elements: [el('element-1:h2-0', null, { tagName: 'h2' })] });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_TEXT' }), expect.anything(),
    );
  });

  it('skips dynamic: keys — the db-binding overlay owns blog-card text', () => {
    const key = 'dynamic:abc123:h2-0';
    const { ctx, postMessage } = ctxWithSourceText({ [key]: 'binding text' });
    handleElementsScanned(ctx, { elements: [el(key, null, { tagName: 'h2', textContent: 'other' })] });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_TEXT' }), expect.anything(),
    );
  });
});

describe('source class/image re-apply on scan', () => {
  function ctxWithOverrides(opts: {
    classes?: Record<string, { classes: string; edited?: boolean }>;
    imageAttrs?: Record<string, Record<string, string>>;
  }) {
    const { iframe, postMessage } = makeFakeIframe();
    const doc = new Y.Doc();
    const ctx = makeFakeCtx({ refs: { iframe }, env: { doc } });
    doc.transact(() => {
      const classMap = doc.getMap('sourceClasses');
      for (const [key, entry] of Object.entries(opts.classes ?? {})) {
        const yEntry = new Y.Map();
        yEntry.set('classes', entry.classes);
        if (entry.edited) yEntry.set('edited', true);
        classMap.set(key, yEntry);
      }
      const imgMap = doc.getMap('sourceImageAttributes');
      for (const [key, attrs] of Object.entries(opts.imageAttrs ?? {})) {
        const yEntry = new Y.Map();
        for (const [attr, value] of Object.entries(attrs)) yEntry.set(attr, value);
        imgMap.set(key, yEntry);
      }
    });
    return { ctx, postMessage };
  }

  it('posts UPDATE_CLASSES for edited entries whose classes differ from the scan', () => {
    const key = 'src/pages/index.astro:5:1';
    const { ctx, postMessage } = ctxWithOverrides({
      classes: { [key]: { classes: 'p-4 text-red-500', edited: true } },
    });
    handleElementsScanned(ctx, { elements: [el(key, null, { classes: 'p-2' })] });
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'UPDATE_CLASSES',
        payload: {
          key,
          classes: 'p-4 text-red-500',
          sourceLocation: { file: 'src/pages/index.astro', line: 5, column: 1 },
        },
      },
      '*',
    );
  });

  it('does not re-send when the scanned element already carries the same classes', () => {
    const key = 'src/pages/index.astro:5:1';
    const { ctx, postMessage } = ctxWithOverrides({
      classes: { [key]: { classes: 'p-4', edited: true } },
    });
    handleElementsScanned(ctx, { elements: [el(key, null, { classes: 'p-4' })] });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_CLASSES' }), expect.anything(),
    );
  });

  it('skips registered-but-unedited entries even when classes differ', () => {
    const key = 'src/pages/index.astro:5:1';
    const { ctx, postMessage } = ctxWithOverrides({
      classes: { [key]: { classes: 'p-4' } }, // no edited flag — registration only
    });
    handleElementsScanned(ctx, { elements: [el(key, null, { classes: 'p-2' })] });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_CLASSES' }), expect.anything(),
    );
  });

  it('skips edited entries with no scanned match (stale key)', () => {
    const { ctx, postMessage } = ctxWithOverrides({
      classes: { 'src/pages/other.astro:9:1': { classes: 'p-4', edited: true } },
    });
    handleElementsScanned(ctx, { elements: [el('src/pages/index.astro:5:1', null, { classes: 'p-2' })] });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_CLASSES' }), expect.anything(),
    );
  });

  it('posts one UPDATE_IMAGE_ATTRIBUTE per attribute for matching scanned keys', () => {
    const key = 'src/pages/index.astro:8:3';
    const { ctx, postMessage } = ctxWithOverrides({
      imageAttrs: { [key]: { src: '/img/new.png', alt: 'New alt' } },
    });
    handleElementsScanned(ctx, { elements: [el(key, null, { tagName: 'img' })] });
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'UPDATE_IMAGE_ATTRIBUTE', payload: { key, attribute: 'src', value: '/img/new.png' } },
      '*',
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'UPDATE_IMAGE_ATTRIBUTE', payload: { key, attribute: 'alt', value: 'New alt' } },
      '*',
    );
  });

  it('skips drawn-key image entries', () => {
    const { ctx, postMessage } = ctxWithOverrides({
      imageAttrs: { 'drawn-abc': { src: '/img/new.png' } },
    });
    handleElementsScanned(ctx, { elements: [el('drawn-abc', null, { tagName: 'img' })] });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_IMAGE_ATTRIBUTE' }), expect.anything(),
    );
  });
});

// task-133 Task 5: local-mode structural insert → the pending selection is
// consumed on the next scan covering the inserted file. Exact line only,
// one-shot (match or not), selection through selectInContext (the ONLY owner).
describe('local pending selection (task-133)', () => {
  const FILE = 'src/pages/index.astro';

  afterEach(async () => {
    const { clearLocalPendingSelection } = await import('@/utils/localPendingSelection');
    clearLocalPendingSelection();
  });

  it('selects the freshly inserted element at the exact predicted line', async () => {
    const { setLocalPendingSelection, peekLocalPendingSelection } = await import('@/utils/localPendingSelection');
    setLocalPendingSelection(FILE, 12);
    const ctx = makeFakeCtx();
    handleElementsScanned(ctx, { elements: [el(`${FILE}:3:1`), el(`${FILE}:12:5`)] });
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(`${FILE}:12:5`, expect.anything());
    expect(peekLocalPendingSelection()).toBeNull();
    // task-075: no command dispatch — selectInContext is the single write
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
  });

  it('clears after one covering scan even without a match (no sticky selection)', async () => {
    const { setLocalPendingSelection, peekLocalPendingSelection } = await import('@/utils/localPendingSelection');
    setLocalPendingSelection(FILE, 12);
    const ctx = makeFakeCtx();
    handleElementsScanned(ctx, { elements: [el(`${FILE}:3:1`), el(`${FILE}:13:1`)] });
    expect(ctx.refs.selectInContext.current).not.toHaveBeenCalled();
    expect(peekLocalPendingSelection()).toBeNull();
  });

  // Predicted paint (2026-11-08): the scan right after a predicted DOM change
  // still carries pre-write keys; the one-shot waits for the refresh's scan.
  it('a predicted scan neither consumes nor resolves the pending', async () => {
    const { setLocalPendingSelection, peekLocalPendingSelection } = await import('@/utils/localPendingSelection');
    setLocalPendingSelection(FILE, 12);
    const ctx = makeFakeCtx();
    handleElementsScanned(ctx, { elements: [el(`${FILE}:12:5`)], predicted: true });
    expect(ctx.refs.selectInContext.current).not.toHaveBeenCalled();
    expect(peekLocalPendingSelection()).not.toBeNull();
    handleElementsScanned(ctx, { elements: [el(`${FILE}:12:5`)] });
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(`${FILE}:12:5`, expect.anything());
  });

  // Filmstrip 2026-11-08: after a canvas reorder the refresh re-keys by position,
  // so the selected (pre-write) key named the neighbour and the box flashed onto
  // it until the pending re-selected the moved element ~50 ms later.
  it('holds the selection box while a structural selection resolves', async () => {
    const { setActiveSaveProjectId } = await import('@/services/pendingProjectMutations');
    const { setLocalPendingSelection } = await import('@/utils/localPendingSelection');
    const { isSelectionResolving } = await import('../scanning');
    const { handleRectsUpdated } = await import('../hoverAndRects');
    setActiveSaveProjectId('browser_hold');
    try {
      setLocalPendingSelection(FILE, 12);
      const doc = new Y.Doc(); doc.getMap('meta').set('projectId', 'browser_hold');
      const ctx = makeFakeCtx({ refs: { selectedKey: { current: `${FILE}:10:5` } }, env: { doc } });
      handleElementsScanned(ctx, { elements: [el(`${FILE}:10:5`), el(`${FILE}:12:5`)] });
      expect(ctx.actions.updateSelectionRect).not.toHaveBeenCalled();
      expect(isSelectionResolving()).toBe(true);
      handleRectsUpdated(ctx, { rects: [{ key: `${FILE}:10:5`, rect: { top: 9, left: 9, width: 9, height: 9 } }] });
      expect(ctx.actions.updateSelectionRect).not.toHaveBeenCalled();
      await new Promise(r => setTimeout(r, 0));
      expect(isSelectionResolving()).toBe(false);
      expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(`${FILE}:12:5`, expect.anything());
    } finally { setActiveSaveProjectId(null); }
  });

  // e2e A2 2026-11-10 (log-proven): ⌘D's pending resolved AFTER the user pressed
  // Escape and clicked another paragraph — it re-selected the copy, and Backspace
  // deleted the copy instead of the clicked paragraph. The newest intent wins.
  it('a selection change since the gesture drops the pending — it never re-selects over the user', async () => {
    const { setLocalPendingSelection, peekLocalPendingSelection, getSelectionEpoch, noteSelectionChanged } = await import('@/utils/localPendingSelection');
    setLocalPendingSelection(FILE, 12, getSelectionEpoch());
    noteSelectionChanged(); // Escape, then a click on another element
    const ctx = makeFakeCtx();
    handleElementsScanned(ctx, { elements: [el(`${FILE}:3:1`), el(`${FILE}:12:5`)] });
    expect(ctx.refs.selectInContext.current).not.toHaveBeenCalled();
    expect(peekLocalPendingSelection()).toBeNull();
  });

  it('a selection change while the pending resolves drops it too', async () => {
    const { setActiveSaveProjectId } = await import('@/services/pendingProjectMutations');
    const { setLocalPendingSelection, peekLocalPendingSelection, getSelectionEpoch, noteSelectionChanged } = await import('@/utils/localPendingSelection');
    setActiveSaveProjectId('browser_steal');
    try {
      setLocalPendingSelection(FILE, 12, getSelectionEpoch());
      const doc = new Y.Doc(); doc.getMap('meta').set('projectId', 'browser_steal');
      const ctx = makeFakeCtx({ env: { doc } });
      handleElementsScanned(ctx, { elements: [el(`${FILE}:3:1`), el(`${FILE}:12:5`)] });
      noteSelectionChanged(); // the click lands while the match resolves
      await new Promise(r => setTimeout(r, 0));
      expect(ctx.refs.selectInContext.current).not.toHaveBeenCalled();
      expect(peekLocalPendingSelection()).toBeNull();
    } finally { setActiveSaveProjectId(null); }
  });

  it('survives a scan that does not cover the file', async () => {
    const { setLocalPendingSelection, peekLocalPendingSelection } = await import('@/utils/localPendingSelection');
    setLocalPendingSelection(FILE, 12);
    const ctx = makeFakeCtx();
    handleElementsScanned(ctx, { elements: [el('src/pages/about.astro:2:1')] });
    expect(peekLocalPendingSelection()).not.toBeNull();
  });

  it('a cleared pending (Editor mount/unmount sweeps it) is never consumed by a later scan', async () => {
    // Cross-project leak guard: if the covering rescan never lands (task-146
    // class), the singleton must not survive into the next project — file:line
    // keys like src/pages/index.astro:N exist in both local and WC projects.
    const { setLocalPendingSelection, clearLocalPendingSelection } = await import('@/utils/localPendingSelection');
    setLocalPendingSelection(FILE, 12);
    clearLocalPendingSelection();
    const ctx = makeFakeCtx();
    handleElementsScanned(ctx, { elements: [el(`${FILE}:12:5`)] });
    expect(ctx.refs.selectInContext.current).not.toHaveBeenCalled();
  });
});

/**
 * task-149 — the scan re-apply is placement-scoped for free.
 *
 * `reapplySourceClassOverrides` / `reapplySourceTextOverrides` build
 * `byKey = new Map(elements.map(e => [e.key, e]))` and look overrides up by the
 * doc key verbatim. Because the placement now lives INSIDE that key, these
 * functions needed zero edits — this pins that, and pins the invariant they
 * exist to protect: ClassStoreContext.registerElement reads a DOM≠Yjs mismatch
 * on click as an external change and overwrites Yjs with the DOM. If a `/`
 * override could reach an `/about` element, that click would destroy it.
 */
describe('placement-scoped scan re-apply (task-149)', () => {
  const HEADER = 'src/components/Header.astro';
  const ON_INDEX = 'p5e23e503da89f633';
  const ON_ABOUT = 'pf22d94ecd78c8702';

  function ctxWithClassOverride(key: string, classes: string) {
    const { iframe, postMessage } = makeFakeIframe();
    const doc = new Y.Doc();
    doc.transact(() => {
      const e = new Y.Map();
      e.set('classes', classes);
      e.set('edited', true);
      doc.getMap('sourceClasses').set(key, e);
    });
    return { ctx: makeFakeCtx({ refs: { iframe }, env: { doc } }), postMessage, doc };
  }

  it('does NOT re-apply the `/` placement override onto the `/about` render', () => {
    const { ctx, postMessage, doc } = ctxWithClassOverride(
      `${HEADER}:1:21~${ON_INDEX}`, 'text-red-500',
    );

    // /about scan: same defining file:line:col, different placement.
    handleElementsScanned(ctx, {
      elements: [
        el(`${HEADER}:1:21~${ON_ABOUT}`, null, {
          classes: 'brand',
          sourceLocation: { file: HEADER, line: 1, column: 21 },
        }),
      ],
    });

    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_CLASSES' }), '*',
    );
    // and the `/` entry is still intact for when the user navigates back
    expect(doc.getMap('sourceClasses').has(`${HEADER}:1:21~${ON_INDEX}`)).toBe(true);
  });

  it('DOES re-apply it when the matching placement is on screen', () => {
    const { ctx, postMessage } = ctxWithClassOverride(
      `${HEADER}:1:21~${ON_INDEX}`, 'text-red-500',
    );

    handleElementsScanned(ctx, {
      elements: [
        el(`${HEADER}:1:21~${ON_INDEX}`, null, {
          classes: 'brand',
          sourceLocation: { file: HEADER, line: 1, column: 21 },
        }),
      ],
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_CLASSES',
        payload: expect.objectContaining({
          key: `${HEADER}:1:21~${ON_INDEX}`,
          classes: 'text-red-500',
          sourceLocation: { file: HEADER, line: 1, column: 21 },
        }),
      }), '*',
    );
  });
});

/**
 * task-159 — the placement-key migration runs BEFORE the three re-applies.
 *
 * Identity moved from a coordinate chain (`~p…`) to a structural one (`~q…`)
 * because a coordinate slides when a line is inserted above it and the
 * override slides onto the neighbour with it. An override stored under the old
 * address must land on the right element, and it must land on the FIRST paint
 * after the upgrade — not the second — which is why `migratePlacementKeys` is
 * called before `reapplySource*` rather than after.
 */
describe('legacy placement-key migration on scan (task-159)', () => {
  const NAV = 'src/components/SiteNav.astro:4:1';
  const P_TOP = 'pe6f8cae40c888072';
  const Q_TOP = 'qa7d57c53ae161ed3';

  function ctxWithLegacyOverride(key: string, classes: string) {
    const { iframe, postMessage } = makeFakeIframe();
    const doc = new Y.Doc();
    doc.transact(() => {
      const e = new Y.Map();
      e.set('classes', classes);
      e.set('edited', true);
      doc.getMap('sourceClasses').set(key, e);
    });
    return { ctx: makeFakeCtx({ refs: { iframe }, env: { doc } }), postMessage, doc };
  }

  it('repaints a pre-upgrade override on the FIRST scan, at its new address', () => {
    const { ctx, postMessage, doc } = ctxWithLegacyOverride(`${NAV}~${P_TOP}`, 'px-5');

    handleElementsScanned(ctx, {
      elements: [
        el(`${NAV}~${Q_TOP}`, null, {
          legacyKeys: [`${NAV}~${P_TOP}`],
          classes: 'px-3',
          sourceLocation: { file: 'src/components/SiteNav.astro', line: 4, column: 1 },
        }),
      ],
    });

    // moved…
    expect(doc.getMap('sourceClasses').has(`${NAV}~${Q_TOP}`)).toBe(true);
    expect(doc.getMap('sourceClasses').has(`${NAV}~${P_TOP}`)).toBe(false);
    // …and painted by the SAME scan, not the next one.
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_CLASSES',
        payload: expect.objectContaining({ key: `${NAV}~${Q_TOP}`, classes: 'px-5' }),
      }), '*',
    );
  });

  it('is inert when nothing carries a legacyKey (WC / server)', () => {
    const { ctx, doc } = ctxWithLegacyOverride(`${NAV}~${P_TOP}`, 'px-5');
    handleElementsScanned(ctx, { elements: [el(`${NAV}~${Q_TOP}`, null, { classes: 'px-3' })] });
    expect(doc.getMap('sourceClasses').has(`${NAV}~${P_TOP}`)).toBe(true);
    expect(doc.getMap('sourceClasses').has(`${NAV}~${Q_TOP}`)).toBe(false);
  });
});

/**
 * task-184: the scan is the only thing that sees what the FILE renders for an
 * element the parent has overridden. Only-if-absent alone froze the value at
 * the first scan — and at boot ClassStoreContext seeds that value from the
 * PERSISTED OVERRIDE, so in local/WC (where the write never reached the file)
 * it was frozen at a value the file never held. Without this the ↻ signal is
 * either permanently on or permanently off; both were measured.
 */
describe('ELEMENTS_SCANNED class-write baseline', () => {
  const KEY = 'src/components/Card.astro:4:1~s4db83f82b016cfb0';

  function ctxWithOverride(classes: string) {
    const doc = new Y.Doc();
    doc.transact(() => {
      const e = new Y.Map();
      e.set('classes', classes);
      e.set('edited', true);
      doc.getMap('sourceClasses').set(KEY, e);
    });
    return makeFakeCtx({ refs: { iframe: makeFakeIframe().iframe }, env: { doc } });
  }

  afterEach(() => resetClassWriteBaselines());

  it('adopts the file value when the scan disagrees with the override', () => {
    const ctx = ctxWithOverride('card px-4 py-2 bg-red-500');
    // Boot pollution, by the path it actually arrives on: ClassStoreContext
    // (~line 212) SEEDS the baseline from the restored override — only-if-absent,
    // and a guess, never an observation (task-186 gave the store that
    // distinction; using setClassWriteBaseline here would assert the write
    // landed, which retires the override instead of polluting the baseline).
    noteClassWriteBaseline(KEY, 'card px-4 py-2 bg-red-500');

    handleElementsScanned(ctx, { elements: [el(KEY, null, { classes: 'card px-4 py-2' })] });
    expect(getClassWriteBaseline(KEY)).toBe('card px-4 py-2');

    // The master file moves; HMR re-renders; the next scan carries the new value.
    handleElementsScanned(ctx, { elements: [el(KEY, null, { classes: 'card px-8 py-6' })] });
    expect(getClassWriteBaseline(KEY)).toBe('card px-8 py-6');
  });

  it('ignores a scan that merely reports our own re-applied override', () => {
    const ctx = ctxWithOverride('card px-4 py-2 bg-red-500');
    handleElementsScanned(ctx, { elements: [el(KEY, null, { classes: 'card px-4 py-2' })] });
    // Second scan sees the DOM the re-apply painted — not the file.
    handleElementsScanned(ctx, {
      elements: [el(KEY, null, { classes: 'card px-4 py-2 bg-red-500' })],
    });
    expect(getClassWriteBaseline(KEY)).toBe('card px-4 py-2');
  });

  /**
   * task-186 FIX-1 — the heal leg.
   *
   * A master edited through the COMPONENT EDITOR writes the file AND leaves a
   * bare/placement override behind whose value the file now renders. Reopening
   * the project restores that entry; the first scan is the only thing that can
   * tell the store the file already says it. Without noting the file value in
   * the AGREES branch the store never learns it, the entry stays "edited"
   * forever, and the moment the file moves externally it shadows it.
   *
   * Safe because every scanned key WITHOUT an override is noted unconditionally
   * (branch above), so a baseline is missing here only before the key's first
   * scan — and before its first scan nothing can have re-painted it, so `now`
   * is the file. Later scans that merely report our own re-apply find the
   * baseline already present and only-if-absent leaves it alone (the test above
   * pins exactly that).
   */
  it('notes the file value when the scan AGREES with the override, healing a stuck entry (task-186)', () => {
    const ctx = ctxWithOverride('card px-4 py-2 bg-zinc-800');
    const { doc } = ctx.env;
    expect(getClassWriteBaseline(KEY)).toBeUndefined(); // fresh session

    // Reopened project: the file ALREADY renders the override — last session's
    // component-editor write landed in it.
    handleElementsScanned(ctx, {
      elements: [el(KEY, null, { classes: 'card px-4 py-2 bg-zinc-800' })],
    });

    expect(getClassWriteBaseline(KEY)).toBe('card px-4 py-2 bg-zinc-800');
    expect(hasLocalMasterOverrides(doc, 'src/components/Card.astro', 's4db83f82b016cfb0')).toBe(false);

    // The file then moves EXTERNALLY (git checkout / another tool). The healed
    // entry must not be re-applied over it.
    const post = (ctx.refs.iframe.current!.contentWindow!.postMessage as ReturnType<typeof vi.fn>);
    post.mockClear();
    handleElementsScanned(ctx, { elements: [el(KEY, null, { classes: 'card px-8 py-6' })] });
    expect(post.mock.calls.filter(([m]) => m.type === 'UPDATE_CLASSES')).toEqual([]);
  });

  it('keeps only-if-absent for a key with no override', () => {
    const ctx = makeFakeCtx();
    handleElementsScanned(ctx, { elements: [el('src/pages/index.astro:2:1', null, { classes: 'a' })] });
    handleElementsScanned(ctx, { elements: [el('src/pages/index.astro:2:1', null, { classes: 'b' })] });
    expect(getClassWriteBaseline('src/pages/index.astro:2:1')).toBe('a');
  });

  /**
   * The ↻ gap measured live on the rig: an override entry with NO anchor could
   * never light ↻, however far the master moved. Two placements of one
   * component, same page, same moved master, seconds apart — the anchored one
   * showed ↻, this one did not while its edit was demonstrably being shadowed.
   *
   * An entry gets here two ways, and neither can stamp the anchor itself:
   * restored from a payload written before the anchor existed, or created by
   * UPDATE_SOURCE_CLASSES' `else` branch (an edit on a key no click ever
   * registered — AI class tools, multi-select apply).
   *
   * The scan is the only thing that can repair it, because it is the only thing
   * that sees what the FILE renders. Same branch, same judgement, same value the
   * class-write baseline already adopts here.
   */
  it('anchors an override that never got one, so ↻ can still fire (task-184)', () => {
    const ctx = ctxWithOverride('card px-4 py-2 bg-red-500');
    const doc = ctx.env.doc;
    const CARD = 'src/components/Card.astro';
    const PLACEMENT = 's4db83f82b016cfb0';

    // A scan that disagrees with the override is the file speaking.
    handleElementsScanned(ctx, { elements: [el(KEY, null, { classes: 'card px-4 py-2' })] });
    // Master has NOT moved — the badge must stay dark.
    expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(false);

    // The master moves; HMR delivers it; the re-apply paints the override back
    // over it. This is the ↻ state, and it must be visible.
    handleElementsScanned(ctx, { elements: [el(KEY, null, { classes: 'card px-8 py-6' })] });
    expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(true);
    // The anchor must NOT follow the master, or ↻ could never fire again.
    expect(sourceClassBaseValue(doc, KEY)).toBe('card px-4 py-2');
  });

  /**
   * task-184 unit B — the SAME shadowing, one tier over.
   *
   * Measured live on a two-placement local rig (`local_63cmon`, <Card/> twice on
   * `/`): a text-only override on placement A, then `Card.astro` edited on disk.
   * HMR delivered it, the scan carried it —
   *   [UNITB] TEXT key=…:6:3~s4db… scanned="MASTER MOVED body copy"
   *                                override="OVERRIDDEN body copy"
   * — `reapplySourceTextOverrides` repainted the override over it (the canvas
   * showed the OLD copy on A and the NEW copy on B), and ↻ stayed dark:
   *   [UNITB] localMasterOutdated … placement=s4db… verdict=false kinds=["text:…"]
   *
   * The gate had a `kind !== 'classes'` early-return and text stamped no anchor.
   * Same two halves, same reader, no second mechanism.
   */
  const TEXT_KEY = 'src/components/Card.astro:6:3~s4db83f82b016cfb0';
  const FILE_TEXT = 'Some body copy that nobody reads.';
  const MOVED_TEXT = 'MASTER MOVED body copy';
  const TEXT_OVERRIDE = 'OVERRIDDEN body copy';

  function ctxWithTextOverride() {
    const doc = new Y.Doc();
    doc.transact(() => {
      const e = new Y.Map();
      e.set('textContent', TEXT_OVERRIDE);
      doc.getMap('sourceText').set(TEXT_KEY, e);
    });
    return makeFakeCtx({ refs: { iframe: makeFakeIframe().iframe }, env: { doc } });
  }

  it('anchors a TEXT override too, so a text-only edit can light ↻ (task-184 unit B)', () => {
    const ctx = ctxWithTextOverride();
    const doc = ctx.env.doc;
    const CARD = 'src/components/Card.astro';
    const PLACEMENT = 's4db83f82b016cfb0';

    // A scan that disagrees with the override is the file speaking.
    handleElementsScanned(ctx, { elements: [el(TEXT_KEY, null, { textContent: FILE_TEXT })] });
    // Master has NOT moved — the badge must stay dark.
    expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(false);

    // The master moves; HMR delivers it; the re-apply paints the override back.
    handleElementsScanned(ctx, { elements: [el(TEXT_KEY, null, { textContent: MOVED_TEXT })] });
    expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(true);
    // The anchor must NOT follow the master, or ↻ could never fire again.
    expect(sourceBaseValue(doc, 'sourceText', 'baseText', TEXT_KEY)).toBe(FILE_TEXT);
  });

  /**
   * task-186 FIX-2 — the SAME shadowing, one tier further over: an IMAGE
   * override on a placement, then the master's <img src> changed on disk.
   *
   * Two halves were missing, and this is the sequence a user actually
   * produces (the edit happens IN the session, so no scan ever carries the
   * file's src alongside an already-stored override):
   *
   *   now  — the scan reported `hasSrc` (a boolean) and no attribute VALUES,
   *          so `getFileValue('image', key)` was undefined forever and the
   *          kind-agnostic gate could not fire whatever the master did.
   *   base — the scan-side repair anchored to the value it had just adopted,
   *          i.e. the MOVED one, so base === now and ↻ stayed dark. The same
   *          trap `baseText` needed a commands.ts stamp for; here the repair
   *          itself takes the file value it PREVIOUSLY observed, which fixes
   *          every kind rather than adding a third per-kind stamp.
   */
  const IMG_KEY = 'src/components/Card.astro:8:3~s4db83f82b016cfb0';
  const FILE_SRC = '/img/two.svg';
  const IMG_OVERRIDE = '/img/three.svg';
  const MOVED_SRC = '/img/four.svg';
  const img = (src: string) => el(IMG_KEY, null, { tagName: 'img', imageSrc: src });

  it('an image-only master change lights ↻ on a placement carrying an image override (task-186 FIX-2)', () => {
    const ctx = makeFakeCtx({ refs: { iframe: makeFakeIframe().iframe }, env: { doc: new Y.Doc() } });
    const doc = ctx.env.doc;
    const CARD = 'src/components/Card.astro';
    const PLACEMENT = 's4db83f82b016cfb0';

    // t0 — page loads. No override yet: this scan IS the file speaking.
    handleElementsScanned(ctx, { elements: [img(FILE_SRC)] });

    // t1 — the user swaps the image on this placement (Fill → Media).
    applyCommand(doc, {
      type: 'UPDATE_IMAGE_ATTRIBUTE',
      elementId: IMG_KEY, attribute: 'src', value: IMG_OVERRIDE,
    });
    expect(hasLocalMasterOverrides(doc, CARD, PLACEMENT)).toBe(true);

    // t2 — the re-apply paints it; the next scan reports our OWN override.
    handleElementsScanned(ctx, { elements: [img(IMG_OVERRIDE)] });
    expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(false);

    // t3 — the master file moves; HMR delivers it; the re-apply paints the
    // override back over it. That is the ↻ state and it must be visible.
    handleElementsScanned(ctx, { elements: [img(MOVED_SRC)] });
    expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(true);
    // The anchor must NOT follow the master, or ↻ could never fire again.
    expect(sourceBaseValue(doc, 'sourceImageAttributes', 'baseAttributes', IMG_KEY))
      .toBe(FILE_SRC);
  });

  /** The anchor rides in the attribute map, so every consumer that treats the
   *  entry's string values as attributes has to skip it — Push writes each one
   *  into the real .astro file. */
  it('never exposes the ↻ anchor as an image attribute', () => {
    const ctx = makeFakeCtx({ refs: { iframe: makeFakeIframe().iframe }, env: { doc: new Y.Doc() } });
    const doc = ctx.env.doc;
    handleElementsScanned(ctx, { elements: [img(FILE_SRC)] });
    applyCommand(doc, {
      type: 'UPDATE_IMAGE_ATTRIBUTE',
      elementId: IMG_KEY, attribute: 'src', value: IMG_OVERRIDE,
    });
    handleElementsScanned(ctx, { elements: [img(MOVED_SRC)] });

    const seen: Record<string, string>[] = [];
    forEachSourceImageAttrsEntry(doc, ({ attributes }) => seen.push(attributes));
    expect(seen).toEqual([{ src: IMG_OVERRIDE }]);
  });

  it('a text scan that merely reports our own re-applied override changes nothing', () => {
    const ctx = ctxWithTextOverride();
    const doc = ctx.env.doc;
    handleElementsScanned(ctx, { elements: [el(TEXT_KEY, null, { textContent: FILE_TEXT })] });
    // Second scan sees the DOM the re-apply painted — not the file.
    handleElementsScanned(ctx, { elements: [el(TEXT_KEY, null, { textContent: TEXT_OVERRIDE })] });
    expect(localMasterOutdated(doc, 'src/components/Card.astro', 's4db83f82b016cfb0')).toBe(false);
    expect(sourceBaseValue(doc, 'sourceText', 'baseText', TEXT_KEY)).toBe(FILE_TEXT);
  });
});
