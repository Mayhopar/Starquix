// Local-runtime paste: real file writes through viteStructuralWriter, gesture
// order per task-133 (sync gate → guard → resolve → write → stale-mark → undo).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScannedElement } from '@/context/SelectionContext';

vi.mock('@/services/ViteStructuralWriter', () => ({
  viteStructuralWriter: {
    writeInsert: vi.fn(),
    writeAppendPage: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { _resetStructuralWriteInFlightForTests, releaseStructuralWrite, tryAcquireStructuralWrite } from '@/store/structuralWriteGuard';
import {
  setLocalExpectedRoute,
  setLocalScannedRoute,
  setLocalPageFile,
  admitLocalSourceScan,
  isLocalScanStaleAfterWrite,
  _resetLocalPageSyncForTests,
} from '@/utils/localPageSync';
import toast from 'react-hot-toast';
import { clearLocalPendingSelection, peekLocalPendingSelection, getSelectionEpoch, noteSelectionChanged } from '@/utils/localPendingSelection';
import { CLIPBOARD_VERSION, type ClipboardEnvelope } from '../envelope';
import { pasteEnvelopeIntoLocal, type PasteLocalDeps } from '../pasteLocal';

const writeInsert = viteStructuralWriter.writeInsert as ReturnType<typeof vi.fn>;
const writeAppendPage = viteStructuralWriter.writeAppendPage as ReturnType<typeof vi.fn>;

const PAGE = 'src/pages/index.astro';

const el = (over: Partial<ScannedElement> = {}): ScannedElement => ({
  key: `${PAGE}:8:3`,
  tagName: 'section',
  classes: '',
  sourceLocation: { file: PAGE, line: 8, column: 3 },
  rect: { top: 0, left: 0, width: 10, height: 10 },
  parentKey: null,
  hasSourceTracking: true,
  ...over,
} as ScannedElement);

const envelope = (htmls: string[]): ClipboardEnvelope => ({
  v: CLIPBOARD_VERSION,
  sourceProjectId: 'browser_lf_src',
  roots: htmls.map((html, i) => ({ label: `r${i}`, html })),
  masters: [],
  assets: [],
});

function makeDeps(over: Partial<PasteLocalDeps> = {}): PasteLocalDeps & { pushUndo: ReturnType<typeof vi.fn>; toast: ReturnType<typeof vi.fn> } {
  const selection = el();
  return {
    scannedElements: [selection],
    scannedByKey: new Map([[selection.key, selection]]),
    selectedKey: selection.key,
    pageFile: PAGE,
    pushUndo: vi.fn(),
    toast: vi.fn(),
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearLocalPendingSelection();
  _resetStructuralWriteInFlightForTests();
  _resetLocalPageSyncForTests();
  setLocalExpectedRoute('/');
  setLocalScannedRoute('/');
  writeInsert.mockResolvedValue({
    success: true, insertedLine: 9, file: PAGE,
    replacedLine: 9, replacedLineCount: 1, originalSegment: '',
  });
  writeAppendPage.mockResolvedValue({
    success: true, insertedLine: 6, file: PAGE,
    replacedLine: 6, replacedLineCount: 1, originalSegment: '',
  });
});

describe('pasteEnvelopeIntoLocal', () => {
  it('selected container → writeInsert(loc, joined, inside-end)', async () => {
    const deps = makeDeps();
    const ok = await pasteEnvelopeIntoLocal(envelope(['<div>a</div>']), deps);
    expect(ok).toBe(true);
    expect(writeInsert).toHaveBeenCalledWith({ file: PAGE, line: 8, column: 3 }, '<div>a</div>', 'inside-end', expect.anything());
    expect(writeAppendPage).not.toHaveBeenCalled();
  });

  it('no selection → writeAppendPage(pageFile, joined)', async () => {
    const deps = makeDeps({ selectedKey: null, scannedElements: [], scannedByKey: new Map() });
    const ok = await pasteEnvelopeIntoLocal(envelope(['<div>a</div>']), deps);
    expect(ok).toBe(true);
    expect(writeAppendPage).toHaveBeenCalledWith(PAGE, '<div>a</div>', expect.anything());
  });

  it('success → stale-marked, restore-region undo pushed, pending selection set, guard released', async () => {
    const deps = makeDeps();
    await pasteEnvelopeIntoLocal(envelope(['<div>a</div>']), deps);
    expect(isLocalScanStaleAfterWrite()).toBe(true);
    expect(deps.pushUndo).toHaveBeenCalledTimes(1);
    const record = deps.pushUndo.mock.calls[0][0];
    expect(record.structuralOp.inverse[0]).toMatchObject({ kind: 'restore-region', lineCount: 1 });
    expect(peekLocalPendingSelection()).toEqual({ file: PAGE, predicted: `${PAGE}:9:`, selectionEpoch: getSelectionEpoch() });
    expect(tryAcquireStructuralWrite()).toBe(true); // released
  });

  it('writeInsert failure → toast, NO undo push, guard released', async () => {
    writeInsert.mockResolvedValue(false);
    const deps = makeDeps();
    const ok = await pasteEnvelopeIntoLocal(envelope(['<div>a</div>']), deps);
    expect(ok).toBe(false);
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(tryAcquireStructuralWrite()).toBe(true); // released
  });

  // Owner 2026-11-10: never "Still saving the last change" — it waits its turn.
  it('busy guard → the paste waits its turn, then writes', async () => {
    expect(tryAcquireStructuralWrite()).toBe(true); // hold the guard
    const deps = makeDeps();
    const pending = pasteEnvelopeIntoLocal(envelope(['<div>a</div>']), deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(writeInsert).not.toHaveBeenCalled();
    releaseStructuralWrite();
    expect(await pending).toBe(true);
    expect(writeInsert).toHaveBeenCalledTimes(1);
    expect(deps.toast).not.toHaveBeenCalled();
  });

  // e2e A2 2026-11-10: the user's newer selection wins over the gesture's own.
  it('a selection change while the paste waits its turn → it lands, but does not grab the selection', async () => {
    expect(tryAcquireStructuralWrite()).toBe(true); // hold the guard
    const deps = makeDeps({ selectionEpoch: getSelectionEpoch() });
    const pending = pasteEnvelopeIntoLocal(envelope(['<div>a</div>']), deps);
    noteSelectionChanged(); // the user clicked another element meanwhile
    releaseStructuralWrite();
    expect(await pending).toBe(true);
    expect(writeInsert).toHaveBeenCalledTimes(1);
    expect(peekLocalPendingSelection()).toBeNull();
  });

  // Owner 2026-11-10: "it must just SWITCH, no delays no errors" — ⌘V right
  // after a Pages click pastes into the page the user switched to, once its
  // scan lands; never into the page they left, never a refusal.
  it('mid-switch paste → waits, then lands on the switched-to page (selection on the old page ignored)', async () => {
    const ABOUT = 'src/pages/about.astro';
    setLocalPageFile(PAGE);
    setLocalExpectedRoute('/about'); setLocalPageFile(ABOUT); // scan still vouches for '/'
    writeAppendPage.mockResolvedValue({ success: true, insertedLine: 6, file: ABOUT, replacedLine: 6, replacedLineCount: 1, originalSegment: '' });
    const deps = makeDeps(); // captured on '/': its scan, its selection, its file
    const pending = pasteEnvelopeIntoLocal(envelope(['<div>a</div>']), deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(writeInsert).not.toHaveBeenCalled();
    expect(writeAppendPage).not.toHaveBeenCalled();
    admitLocalSourceScan(undefined, '/about', []);
    expect(await pending).toBe(true);
    expect(writeAppendPage).toHaveBeenCalledWith(ABOUT, '<div>a</div>', expect.anything());
    expect(writeInsert).not.toHaveBeenCalled();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('mid-switch ⌘D (duplicate of an element on the page being left) → nothing written, no message', async () => {
    setLocalExpectedRoute('/about'); // scan still vouches for '/'
    const deps = makeDeps({ duplicateOf: `${PAGE}:8:3` });
    const ok = await pasteEnvelopeIntoLocal(envelope(['<div>a</div>']), deps);
    expect(ok).toBe(false);
    expect(writeInsert).not.toHaveBeenCalled();
    expect(writeAppendPage).not.toHaveBeenCalled();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('multi-root envelope → ONE write with joined markup', async () => {
    const deps = makeDeps({ selectedKey: null, scannedElements: [], scannedByKey: new Map() });
    await pasteEnvelopeIntoLocal(envelope(['<div>a</div>', '<p>b</p>']), deps);
    expect(writeAppendPage).toHaveBeenCalledTimes(1);
    expect(writeAppendPage).toHaveBeenCalledWith(PAGE, '<div>a</div>\n<p>b</p>', expect.anything());
  });
});

// Security (audit 2026-10-18): any web page can put our clipboard marker on the
// system clipboard, and paste writes roots[].html into an .astro file — where
// `{…}` runs as server-side code. ⌘D (duplicate) takes the same path.
describe('pasteEnvelopeIntoLocal — braces are text', () => {
  it('writes text braces as entities', async () => {
    const deps = makeDeps();
    await pasteEnvelopeIntoLocal(envelope(['<p>Price {total}</p>']), deps);
    expect(writeInsert).toHaveBeenCalledWith({ file: PAGE, line: 8, column: 3 }, '<p>Price &#123;total&#125;</p>', 'inside-end', expect.anything());
    expect(deps.pushUndo.mock.calls[0][0].structuralOp.forward[0].markup).toBe('<p>Price &#123;total&#125;</p>');
  });

  it('neutralizes every context Astro evaluates; HTML <script>/<style> bodies stay raw', async () => {
    const deps = makeDeps();
    await pasteEnvelopeIntoLocal(envelope([
      '<svg><script>{a()}</script><Foo x="1"></Foo><g><text>{s()}</text></g></svg>',
      '<template><b>{b()}</b></template>',
      '<noscript>{c()}</noscript>',
      '<textarea>{d()}</textarea>',
      '<foo.bar>{e()}</foo.bar>',
      '<div title="<script>">{f()}</div>',
      '<div {...g()}="" data-x="{h()}">i</div>',
      '<style>.a{color:red}</style><script>const j = {k: 1};</script>',
    ]), deps);
    const markup = writeInsert.mock.calls[0][1] as string;
    for (const call of ['a()', 's()', 'b()', 'c()', 'd()', 'f()']) expect(markup).toContain(`&#123;${call}&#125;`);
    expect(markup).not.toMatch(/Foo|foo\.bar|e\(\)/); // component-call tags are dropped whole
    expect(markup).toContain('<style>.a{color:red}</style><script>const j = {k: 1};</script>');
    const outsideRaw = markup.replace('<style>.a{color:red}</style><script>const j = {k: 1};</script>', '');
    expect(outsideRaw).not.toMatch(/[{}]/);
  });
});

// Predicted paint (filmstrip 2026-11-08): ⌘D paints its copy at acceptance —
// the write's refresh lands 150–400 ms later and adopts it.
describe('duplicate paints its copy at once', () => {
  const clones = (calls: unknown[][]) => calls.map((c) => c[0] as { type: string; payload: unknown })
    .filter((m) => m.type === 'SYNC_CLONE_ELEMENT_IN_DOM');

  it('posts the clone at the same slot the write targets', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const p = el({ tagName: 'p' });
    await pasteEnvelopeIntoLocal(envelope(['<p>a</p>']), makeDeps({ scannedElements: [p], scannedByKey: new Map([[p.key, p]]), duplicateOf: p.key }));
    expect(clones(post.mock.calls)).toEqual([{ type: 'SYNC_CLONE_ELEMENT_IN_DOM', payload: { key: p.key, anchorKey: p.key, position: 'after' } }]);
    post.mockClear();
    await pasteEnvelopeIntoLocal(envelope(['<div>a</div>']), makeDeps({ duplicateOf: `${PAGE}:8:3` }));
    expect(clones(post.mock.calls)[0].payload).toEqual({ key: `${PAGE}:8:3`, anchorKey: `${PAGE}:8:3`, position: 'inside-end' });
    post.mockRestore();
  });

  it('a paste (other content), a multi-root copy or a failed write paints nothing', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    await pasteEnvelopeIntoLocal(envelope(['<p>x</p>']), makeDeps());
    await pasteEnvelopeIntoLocal(envelope(['<p>x</p>', '<p>y</p>']), makeDeps({ duplicateOf: `${PAGE}:8:3` }));
    writeInsert.mockResolvedValueOnce({ success: false });
    await pasteEnvelopeIntoLocal(envelope(['<p>x</p>']), makeDeps({ duplicateOf: `${PAGE}:8:3` }));
    expect(clones(post.mock.calls)).toEqual([]);
    post.mockRestore();
  });
});
