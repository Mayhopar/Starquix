// task-133 Task 7: canvas draw → immediate materialization in the local
// (files-truth) runtime. The just-drawn payload is serialized to real markup
// and written into the real file through viteStructuralWriter — no doc
// dispatch, no snapshot, no localStorage drawn tier.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

vi.mock('@/services/ViteStructuralWriter', () => ({
  viteStructuralWriter: {
    writeInsert: vi.fn(),
    writeAppendPage: vi.fn(),
    writeRemove: vi.fn(),
    writeMove: vi.fn(),
    writeImport: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import toast from 'react-hot-toast';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { insertLocalDrawnElement } from '../localDrawInsert';
import {
  tryAcquireStructuralWrite,
  releaseStructuralWrite,
  _resetStructuralWriteInFlightForTests,
} from '@/components/Editor/localStructuralOps';
import { peekLocalPendingSelection, clearLocalPendingSelection, getSelectionEpoch } from '@/utils/localPendingSelection';
import {
  setLocalExpectedRoute,
  setLocalScannedRoute,
  setLocalPageFile,
  admitLocalSourceScan,
  _resetLocalPageSyncForTests,
} from '@/utils/localPageSync';
import type { ScannedElement } from '@/context/SelectionContext';
import { LOCAL_CROSS_FILE_WRITE_EVENT } from '@/utils/localWriteScope';

const writeInsert = viteStructuralWriter.writeInsert as ReturnType<typeof vi.fn>;
const writeAppendPage = viteStructuralWriter.writeAppendPage as ReturnType<typeof vi.fn>;

const PAGE = 'src/pages/index.astro';
const RECT = { top: 0, left: 0, width: 100, height: 100 };

function scanned(partial: Partial<ScannedElement> & { key: string; tagName: string }): ScannedElement {
  return {
    classes: '',
    rect: RECT,
    parentKey: null,
    hasSourceTracking: true,
    ...partial,
  } as ScannedElement;
}

// <main> is the page's lone root; <section> nests in it; <img> is a void leaf.
const mainEl = scanned({
  key: `${PAGE}:10:1`,
  tagName: 'main',
  sourceLocation: { file: PAGE, line: 10, column: 1 },
});
const sectionEl = scanned({
  key: `${PAGE}:12:3`,
  tagName: 'section',
  parentKey: mainEl.key,
  sourceLocation: { file: PAGE, line: 12, column: 3 },
});
const imgEl = scanned({
  key: `${PAGE}:14:5`,
  tagName: 'img',
  parentKey: sectionEl.key,
  sourceLocation: { file: PAGE, line: 14, column: 5 },
});
const instanceEl = scanned({
  key: `${PAGE}:12:3#2`,
  tagName: 'section',
  parentKey: mainEl.key,
  sourceLocation: { file: PAGE, line: 12, column: 3 },
});
const SCAN = [mainEl, sectionEl, imgEl, instanceEl];

const frameDraw = {
  tag: 'div',
  classes: 'w-[120px] h-[80px] border border-dashed border-gray-300 bg-white',
  textContent: '',
  parentKey: sectionEl.key,
};

function args(overrides: Record<string, unknown> = {}) {
  return {
    draw: frameDraw,
    isSlotDraw: false,
    scannedElements: SCAN,
    pageFile: PAGE,
    ...overrides,
  };
}

/** Files whose write was refused as an instance-scope edit of a master. */
let refusals: string[] = [];
const onRefusal = (e: Event) => refusals.push((e as CustomEvent).detail.file);
beforeAll(() => window.addEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, onRefusal));
afterAll(() => window.removeEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, onRefusal));

beforeEach(() => {
  refusals = [];
  vi.clearAllMocks();
  clearLocalPendingSelection();
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  // Real insert replies carry the splice-region fields (own-line case here).
  writeInsert.mockResolvedValue({
    success: true, insertedLine: 13, file: PAGE,
    replacedLine: 13, replacedLineCount: 1, originalSegment: '',
  });
});

afterEach(() => {
  _resetStructuralWriteInFlightForTests();
});

describe('insertLocalDrawnElement — placement', () => {
  it('frame over a container: serialized <div> with classes, inside-end of the target', async () => {
    const res = await insertLocalDrawnElement(args());
    // task-133 Task 9: result object — {ok:true} carries the real write location.
    expect(res).toEqual({ ok: true, file: PAGE, insertedLine: 13 });
    expect(writeInsert).toHaveBeenCalledWith(
      { file: PAGE, line: 12, column: 3 },
      `<div class="${frameDraw.classes}"></div>`,
      'inside-end', expect.anything(),
    );
    expect(peekLocalPendingSelection()).toEqual({ file: PAGE, predicted: `${PAGE}:13:`, selectionEpoch: getSelectionEpoch() });
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('frame over a void element (img): lands after it, no promotion', async () => {
    await insertLocalDrawnElement(args({ draw: { ...frameDraw, parentKey: imgEl.key } }));
    expect(writeInsert).toHaveBeenCalledWith(
      { file: PAGE, line: 14, column: 5 },
      expect.stringMatching(/^<div /),
      'after', expect.anything(),
    );
  });

  it('empty-canvas draw (parentKey null): page-anchor fallback + div→section promotion', async () => {
    await insertLocalDrawnElement(args({ draw: { ...frameDraw, parentKey: null } }));
    // Fallback anchor = last root-level element of the page file (<main>).
    expect(writeInsert).toHaveBeenCalledWith(
      { file: PAGE, line: 10, column: 1 },
      `<section class="${frameDraw.classes}"></section>`,
      'inside-end', expect.anything(),
    );
  });

  it('draw over a key missing from the scan (e.g. layout slot): fallback + promotion', async () => {
    await insertLocalDrawnElement(args({ draw: { ...frameDraw, parentKey: 'slot-key-not-scanned' } }));
    expect(writeInsert).toHaveBeenCalledWith(
      { file: PAGE, line: 10, column: 1 },
      expect.stringMatching(/^<section /),
      'inside-end', expect.anything(),
    );
  });

  it('non-div tags are never promoted at root level', async () => {
    await insertLocalDrawnElement(
      args({ draw: { tag: 'p', classes: 'w-[10px]', textContent: 'hi', parentKey: null } }),
    );
    expect(writeInsert).toHaveBeenCalledWith(
      expect.anything(),
      '<p class="w-[10px]">hi</p>',
      'inside-end', expect.anything(),
    );
  });
});

describe('insertLocalDrawnElement — serialization', () => {
  it('text draw: textContent is HTML-escaped', async () => {
    await insertLocalDrawnElement(
      args({ draw: { tag: 'p', classes: 'w-[80px]', textContent: 'Type <here> & now', parentKey: sectionEl.key } }),
    );
    expect(writeInsert).toHaveBeenCalledWith(
      expect.anything(),
      '<p class="w-[80px]">Type &lt;here&gt; &amp; now</p>',
      'inside-end', expect.anything(),
    );
  });

  it('shape/pen draw: staticMarkup passes through raw inside the wrapper', async () => {
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 0 L10 10" /></svg>';
    await insertLocalDrawnElement(
      args({
        draw: {
          tag: 'div', classes: 'w-[10px] fill-none stroke-current', textContent: '',
          parentKey: sectionEl.key, staticMarkup: svg, penPath: '{"anchors":[]}',
        },
      }),
    );
    expect(writeInsert).toHaveBeenCalledWith(
      expect.anything(),
      `<div class="w-[10px] fill-none stroke-current">${svg}</div>`,
      'inside-end', expect.anything(),
    );
  });
});

describe('insertLocalDrawnElement — refusals', () => {
  it('blog/slot draw: honest toast, no write', async () => {
    const res = await insertLocalDrawnElement(args({ isSlotDraw: true }));
    expect(res).toMatchObject({ ok: false, reason: expect.stringContaining('not supported in local mode') });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('not supported in local mode'));
    expect(writeInsert).not.toHaveBeenCalled();
  });

  it('no page file: toast, no write', async () => {
    const res = await insertLocalDrawnElement(args({ pageFile: null }));
    expect(res).toMatchObject({ ok: false });
    expect(toast).toHaveBeenCalled();
    expect(writeInsert).not.toHaveBeenCalled();
  });

  it('draw over a #n instance copy: refusal toast, no write', async () => {
    const res = await insertLocalDrawnElement(args({ draw: { ...frameDraw, parentKey: instanceEl.key } }));
    expect(res).toMatchObject({ ok: false });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Loop copies'));
    expect(writeInsert).not.toHaveBeenCalled();
  });

  // Fix 1 (task-148) REVERSES the old "empty scan → toast, no write" pin: a
  // component-only page has no scanned node keyed to the page file, so the
  // draw routes to the page-body anchor (see the page-body describe block).
  it('empty scan: page-body append, no refusal', async () => {
    writeAppendPage.mockResolvedValue({ success: true, insertedLine: 6, file: PAGE });
    const res = await insertLocalDrawnElement(
      args({ draw: { ...frameDraw, parentKey: null }, scannedElements: [] }),
    );
    expect(res).toMatchObject({ ok: true });
    expect(writeInsert).not.toHaveBeenCalled();
    expect(writeAppendPage).toHaveBeenCalled();
  });

  // Fix 2 (task-148): refusals are surfaced, once, with a shared toast id.
  // Owner 2026-11-10: never "Still saving the last change" — it waits its turn.
  it('in-flight structural write (shared Task 6 guard): the draw waits its turn, then writes — no toast', async () => {
    expect(tryAcquireStructuralWrite()).toBe(true); // simulate a pending delete/move
    const pending = insertLocalDrawnElement(args());
    await new Promise((r) => setTimeout(r, 0));
    expect(writeInsert).not.toHaveBeenCalled();
    releaseStructuralWrite();
    expect((await pending).ok).toBe(true);
    expect(writeInsert).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('guard is released after a successful insert (second draw works)', async () => {
    await insertLocalDrawnElement(args());
    await insertLocalDrawnElement(args());
    expect(writeInsert).toHaveBeenCalledTimes(2);
  });
});

describe('insertLocalDrawnElement — failures', () => {
  it('write {success:false}: toast.error, NO pending selection, false', async () => {
    writeInsert.mockResolvedValue({ success: false, insertedLine: 0, file: PAGE });
    const res = await insertLocalDrawnElement(args());
    expect(res).toMatchObject({ ok: false, reason: expect.stringContaining("Couldn't add the shape") });
    expect(toast.error).toHaveBeenCalled();
    expect(peekLocalPendingSelection()).toBeNull();
  });

  it('write resolves false (writes not armed): toast.error, false', async () => {
    writeInsert.mockResolvedValue(false);
    const res = await insertLocalDrawnElement(args());
    expect(res).toMatchObject({ ok: false });
    expect(toast.error).toHaveBeenCalled();
    expect(peekLocalPendingSelection()).toBeNull();
  });

  it('write rejects: toast.error with the message, false, guard released', async () => {
    writeInsert.mockRejectedValue(new Error('unbalanced span'));
    const res = await insertLocalDrawnElement(args());
    expect(res).toMatchObject({ ok: false, reason: expect.stringContaining('unbalanced span') });
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Couldn't add the shape/));
    expect(peekLocalPendingSelection()).toBeNull();
    // Guard must not stay stuck after the failure.
    writeInsert.mockResolvedValue({ success: true, insertedLine: 13, file: PAGE });
    expect(await insertLocalDrawnElement(args())).toMatchObject({ ok: true });
  });
});

// task-133 Task 8: a successful draw pushes an undo record — forward insert,
// inverse remove at the predicted inserted line.
describe('undo records (Task 8)', () => {
  it('success pushes forward insert + inverse region restore', async () => {
    const pushUndo = vi.fn();
    await insertLocalDrawnElement(args({ pushUndo }) as never);
    expect(writeInsert).toHaveBeenCalledTimes(1);
    const [loc, markup, position] = writeInsert.mock.calls[0];
    expect(pushUndo).toHaveBeenCalledExactlyOnceWith({
      origin: expect.objectContaining({ armed: expect.any(Boolean) }), // its page: ⌘Z replays there
      structuralOp: {
        forward: [{ kind: 'insert', loc, markup, position }],
        inverse: [{ kind: 'restore-region', loc: { file: PAGE, line: 13, column: 1 }, lineCount: 1, segment: '' }],
      },
    });
  });

  // LIVE SMOKE (Critical): draw into a single-line container splits its line
  // (mid-line splice) — the inverse region restore carries the original bytes.
  it('mid-line splice reply: inverse restore-region rejoins the split line', async () => {
    writeInsert.mockResolvedValue({
      success: true, insertedLine: 5, file: PAGE,
      replacedLine: 4, replacedLineCount: 3, originalSegment: '  <h1>About</h1>\n',
    });
    const pushUndo = vi.fn();
    await insertLocalDrawnElement(args({ pushUndo }) as never);
    expect(pushUndo.mock.calls[0][0].structuralOp.inverse).toEqual([
      { kind: 'restore-region', loc: { file: PAGE, line: 4, column: 1 }, lineCount: 3, segment: '  <h1>About</h1>\n' },
    ]);
  });

  it('legacy reply without region fields: inverse falls back to remove-at-insertedLine', async () => {
    writeInsert.mockResolvedValue({ success: true, insertedLine: 13, file: PAGE });
    const pushUndo = vi.fn();
    await insertLocalDrawnElement(args({ pushUndo }) as never);
    expect(pushUndo.mock.calls[0][0].structuralOp.inverse).toEqual([
      { kind: 'remove', loc: { file: PAGE, line: 13, column: 1 }, allowRootRemoval: true },
    ]);
  });

  // task-133 Task 9 review pin: draws are single-root BY CONSTRUCTION
  // (serializeDrawnPayload emits one node) — a rootCount in the write reply
  // is ignored and the inverse stays exactly ONE remove.
  it('ignores a rootCount in the reply — inverse stays a single remove', async () => {
    writeInsert.mockResolvedValue({ success: true, insertedLine: 13, file: PAGE, rootCount: 3 });
    const pushUndo = vi.fn();
    await insertLocalDrawnElement(args({ pushUndo }) as never);
    expect(pushUndo).toHaveBeenCalledTimes(1);
    expect(pushUndo.mock.calls[0][0].structuralOp.inverse).toHaveLength(1);
  });

  it('failed draw pushes nothing', async () => {
    writeInsert.mockResolvedValue({ success: false, insertedLine: 0, file: PAGE });
    const pushUndo = vi.fn();
    await insertLocalDrawnElement(args({ pushUndo }) as never);
    expect(pushUndo).not.toHaveBeenCalled();
  });
});

// ── Fix 1 (task-148): drawing on a component-only page (no scanned node keyed
// to the page file) must still materialize — the page-body anchor is resolved
// server-side from the file (sq:write-append-page).
describe('insertLocalDrawnElement — page-body anchor', () => {
  beforeEach(() => {
    writeAppendPage.mockResolvedValue({
      success: true, insertedLine: 6, file: PAGE,
      replacedLine: 6, replacedLineCount: 1, originalSegment: '',
    });
  });

  it('empty scan → writeAppendPage with the root-promoted markup, pending selection stashed', async () => {
    const res = await insertLocalDrawnElement({
      draw: { tag: 'div', classes: 'bg-red-500', textContent: '', parentKey: null },
      isSlotDraw: false,
      scannedElements: [],
      pageFile: PAGE,
    });

    expect(writeInsert).not.toHaveBeenCalled();
    expect(writeAppendPage).toHaveBeenCalledTimes(1);
    const [file, markup] = writeAppendPage.mock.calls[0];
    expect(file).toBe(PAGE);
    // root-level promotion parity with WC: a plain div frame becomes a section
    expect(markup).toContain('<section');
    expect(markup).toContain('bg-red-500');
    expect(res).toEqual({ ok: true, file: PAGE, insertedLine: 6 });
    expect(peekLocalPendingSelection()).toEqual({ file: PAGE, predicted: `${PAGE}:6:`, selectionEpoch: getSelectionEpoch() });
  });

  it('pushes an undo record whose inverse is the region restore', async () => {
    const pushUndo = vi.fn();
    await insertLocalDrawnElement({
      draw: { tag: 'div', classes: '', textContent: '', parentKey: null },
      isSlotDraw: false, scannedElements: [], pageFile: PAGE, pushUndo,
    });
    const record = pushUndo.mock.calls[0][0];
    expect(record.structuralOp.forward[0]).toMatchObject({ kind: 'append-page', pageFile: PAGE });
    expect(record.structuralOp.inverse).toEqual([
      { kind: 'restore-region', loc: { file: PAGE, line: 6, column: 1 }, lineCount: 1, segment: '' },
    ]);
  });

  it('a scanned page element still uses writeInsert (regression pin)', async () => {
    writeInsert.mockResolvedValue({ success: true, insertedLine: 11, file: PAGE });
    await insertLocalDrawnElement({
      draw: { tag: 'div', classes: '', textContent: '', parentKey: null },
      isSlotDraw: false, scannedElements: SCAN, pageFile: PAGE,
    });
    expect(writeInsert).toHaveBeenCalled();
    expect(writeAppendPage).not.toHaveBeenCalled();
  });

  it('failed append → toast + honest reason, no pending selection', async () => {
    writeAppendPage.mockResolvedValue({ success: false });
    const res = await insertLocalDrawnElement({
      draw: { tag: 'div', classes: '', textContent: '', parentKey: null },
      isSlotDraw: false, scannedElements: [], pageFile: PAGE,
    });
    expect(res.ok).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(peekLocalPendingSelection()).toBeNull();
  });
});

// ── Wrong-file-write guard (live-smoke Critical): see localPageSync.ts.
describe('insertLocalDrawnElement — page-switch-in-flight guard', () => {
  beforeEach(() => { _resetLocalPageSyncForTests(); });

  // Owner 2026-11-10: "it must just SWITCH, no delays no errors" — a draw
  // made before the switched-to page has scanned is never refused: it lands on
  // THAT page (its own scan + file) as soon as the scan arrives.
  it('scan still on the previous page → waits, then draws on the page the user switched to; no toast', async () => {
    const ABOUT = 'src/pages/about.astro';
    const aboutMain = scanned({ key: `${ABOUT}:4:1`, tagName: 'main', sourceLocation: { file: ABOUT, line: 4, column: 1 } });
    setLocalExpectedRoute('/'); setLocalScannedRoute('/'); setLocalPageFile(PAGE);
    setLocalExpectedRoute('/about'); setLocalPageFile(ABOUT); // the Pages click
    writeInsert.mockResolvedValue({ success: true, insertedLine: 5, file: ABOUT });
    const pending = insertLocalDrawnElement(args()); // drawn over the outgoing page's <section>
    await new Promise((r) => setTimeout(r, 0));
    expect(writeInsert).not.toHaveBeenCalled();
    admitLocalSourceScan(undefined, '/about', [aboutMain]);
    expect(await pending).toEqual({ ok: true, file: ABOUT, insertedLine: 5 });
    expect(writeInsert).toHaveBeenCalledWith(expect.objectContaining({ file: ABOUT, line: 4, column: 1 }), expect.stringContaining('<section'), 'inside-end', expect.anything());
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('the editor goes away before the page lands → nothing written, no toast', async () => {
    setLocalExpectedRoute('/'); setLocalScannedRoute('/');
    setLocalExpectedRoute('/about');
    const pending = insertLocalDrawnElement(args());
    setLocalExpectedRoute(null);
    expect((await pending).ok).toBe(false);
    expect(writeInsert).not.toHaveBeenCalled();
    expect(writeAppendPage).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('scan matches the current page → proceeds', async () => {
    setLocalExpectedRoute('/layout-only');
    setLocalScannedRoute('/layout-only');
    writeInsert.mockResolvedValue({ success: true, insertedLine: 11, file: PAGE });
    const res = await insertLocalDrawnElement(args());
    expect(res.ok).toBe(true);
  });

  it('gate disarmed → proceeds', async () => {
    writeInsert.mockResolvedValue({ success: true, insertedLine: 11, file: PAGE });
    expect((await insertLocalDrawnElement(args())).ok).toBe(true);
  });
});

/**
 * THE write-scope law (2026-08-02 incident): drawing onto an element that
 * belongs to a shared component targets that component's FILE — the box would
 * appear on every page using it, from a gesture made on one page. Refused; the
 * component view is where that draw belongs.
 */
describe('cross-file draw (instance edits never write the master)', () => {
  const COMPONENT = 'src/components/Header.astro';
  const headerEl = scanned({
    key: `${COMPONENT}:4:1`,
    tagName: 'header',
    sourceLocation: { file: COMPONENT, line: 4, column: 1 },
  });

  it('drawing into a rendered component is refused before any write', async () => {
    const res = await insertLocalDrawnElement(args({
      draw: { ...frameDraw, parentKey: headerEl.key },
      scannedElements: [...SCAN, headerEl],
    }));
    expect(res).toEqual({ ok: false, reason: expect.stringContaining(COMPONENT) });
    expect(writeInsert).not.toHaveBeenCalled();
    expect(writeAppendPage).not.toHaveBeenCalled();
    expect(refusals).toEqual([COMPONENT]);
  });

  it('the same draw in the component view (surface = the component) proceeds', async () => {
    writeInsert.mockResolvedValue({ success: true, insertedLine: 5, file: COMPONENT });
    const res = await insertLocalDrawnElement(args({
      draw: { ...frameDraw, parentKey: headerEl.key },
      scannedElements: [headerEl],
      pageFile: COMPONENT,
    }));
    expect(res.ok).toBe(true);
    expect(writeInsert).toHaveBeenCalledWith(
      { file: COMPONENT, line: 4, column: 1 }, expect.any(String), 'inside-end', expect.anything(),
    );
    expect(refusals).toEqual([]);
  });

  it('a draw onto the page itself is unchanged (regression pin)', async () => {
    const res = await insertLocalDrawnElement(args());
    expect(res.ok).toBe(true);
    expect(refusals).toEqual([]);
  });
});
