/**
 * Issue #5 — "Create container": wrap the selected layers in a new class-less
 * <div>, through the real gesture + durable acceptance + temp disk. One accepted
 * write, one undo record whose replay is byte-exact both ways.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import toast from 'react-hot-toast';
import * as Y from 'yjs';
import * as storage from '@/services/durableEdits/store';
import { applyStructuralTransform } from '@/services/durableEdits/structuralTransform';
import { acceptStructuralReplay } from '@/services/durableEdits/structuralReplayAcceptance';
import { clearLocalPendingSelection, peekLocalPendingSelection, noteSelectionChanged } from '@/utils/localPendingSelection';
import { setLocalPageFile } from '@/utils/localPageSync';
import { LOCAL_CROSS_FILE_WRITE_EVENT } from '@/utils/localWriteScope';
import type { StructuralUndoRecord } from '@/store/structuralUndo';
import {
  freshLocalProjectId, startLocalDeleteRuntime, stopLocalDeleteRuntime, flushAccepted, PAGE_FILE,
} from '@/hooks/__tests__/localDeleteRuntime';
import {
  wrapLocalElements, WRAP_DIFFERENT_PARENTS, WRAP_NOT_SIBLINGS, WRAP_IN_PARAGRAPH, WRAP_IN_LIST_OR_TABLE, WRAP_PAGE_ROOT,
} from '../localStructuralOps';

type Node = { parentKey: string | null; tagName: string; sourceLocation?: { file: string; line: number; column: number }; usageLocation?: { file: string; line: number; column: number } };

const ORIGINAL = "---\nimport Layout from '../layouts/Layout.astro';\n---\n<Layout title=\"x\">\n  <main class=\"p-8\">\n    <h1 class=\"t\">Title</h1>\n\n    <p class=\"a\">First</p>\n\n    <p class=\"b\">Second</p>\n\n    <img src=\"/a.png\" />\n  </main>\n</Layout>\n";
const k = (line: number, col = 5) => `${PAGE_FILE}:${line}:${col}`;
const MAIN = k(5, 3);
const H1 = k(6), PA = k(8), PB = k(10), IMG = k(12);
const pageScan = (): Map<string, Node> => new Map<string, Node>([
  [MAIN, { parentKey: 'layoutchrome-body', tagName: 'main' }],
  [H1, { parentKey: MAIN, tagName: 'h1' }],
  [PA, { parentKey: MAIN, tagName: 'p' }],
  [PB, { parentKey: MAIN, tagName: 'p' }],
  [IMG, { parentKey: MAIN, tagName: 'img' }],
]);

let projectId: string;
let runtime: Awaited<ReturnType<typeof startLocalDeleteRuntime>>;
const deselect = vi.fn();
const pushUndo = vi.fn<(r: StructuralUndoRecord) => void>();

async function start(files: Record<string, string>) {
  projectId = freshLocalProjectId('wrap');
  runtime = await startLocalDeleteRuntime(projectId, files);
}
const disk = async () => { await flushAccepted(projectId); return runtime.read(PAGE_FILE); };
const wrap = (keys: string[], scannedByKey: Map<string, Node> = pageScan()) =>
  wrapLocalElements({ keys, scannedByKey, pushUndo, deselect });

/** Nothing written, nothing recorded, the selection left alone. */
async function expectRefused(ok: boolean, original: string) {
  expect(ok).toBe(false);
  expect(await flushAccepted(projectId)).toBe(0);
  expect(runtime.read(PAGE_FILE)).toBe(original);
  expect(pushUndo).not.toHaveBeenCalled();
  expect(deselect).not.toHaveBeenCalled();
  expect(peekLocalPendingSelection()).toBeNull();
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearLocalPendingSelection();
  await start({ [PAGE_FILE]: ORIGINAL });
});
afterEach(async () => {
  await stopLocalDeleteRuntime(runtime, projectId);
  clearLocalPendingSelection();
});

describe('wrapLocalElements — writes', () => {
  it('adjacent layers (given in click order) → one container at the first one, blank lines between them dropped; one undo record, byte-exact both ways', async () => {
    expect(await wrap([PB, PA])).toBe(true);
    const wrapped = "---\nimport Layout from '../layouts/Layout.astro';\n---\n<Layout title=\"x\">\n  <main class=\"p-8\">\n    <h1 class=\"t\">Title</h1>\n\n    <div>\n      <p class=\"a\">First</p>\n      <p class=\"b\">Second</p>\n    </div>\n\n    <img src=\"/a.png\" />\n  </main>\n</Layout>\n";
    expect(await disk()).toBe(wrapped);
    expect(await flushAccepted(projectId)).toBe(1); // ONE accepted revision
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    expect(pushUndo).toHaveBeenCalledTimes(1);
    const { forward, inverse, sourceFiles } = pushUndo.mock.calls[0][0].structuralOp;
    expect(forward.map(op => op.kind)).toEqual(['insert', 'move', 'move', 'restore-region']);
    expect(sourceFiles?.map(f => [f.file, f.beforeSource, f.afterSource])).toEqual([[PAGE_FILE, ORIGINAL, wrapped]]);
    // The op lists are honest too (the replay itself swaps sourceFiles).
    expect(forward.reduce((src, op) => applyStructuralTransform(src, op).content, ORIGINAL)).toBe(wrapped);
    expect(inverse.reduce((src, op) => applyStructuralTransform(src, op).content, wrapped)).toBe(ORIGINAL);

    // ⌘Z / ⇧⌘Z through the real replay.
    const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
    const { origin } = pushUndo.mock.calls[0][0];
    await acceptStructuralReplay(doc, inverse, sourceFiles, 'before', undefined, false, origin);
    expect(await disk()).toBe(ORIGINAL);
    await acceptStructuralReplay(doc, forward, sourceFiles, 'after', undefined, false, origin);
    expect(await disk()).toBe(wrapped);
  });

  it('the wrapped layers stop being the selection and the next scan selects the container', async () => {
    await wrap([PA, PB]);
    expect(deselect).toHaveBeenCalledTimes(1);
    expect(peekLocalPendingSelection()).toMatchObject({ file: PAGE_FILE, predicted: `${PAGE_FILE}:8:`, sourceLocation: { file: PAGE_FILE, line: 8, column: 5 } });
  });

  it('a selection the user changed while the write was accepted is left alone', async () => {
    const pending = wrap([PA, PB]);
    noteSelectionChanged(); // the user clicked something else meanwhile
    expect(await pending).toBe(true);
    expect(deselect).not.toHaveBeenCalled();
    expect(peekLocalPendingSelection()).toBeNull();
  });

  it('a single layer wraps in place', async () => {
    expect(await wrap([IMG])).toBe(true);
    expect(await disk()).toBe(ORIGINAL.replace('    <img src="/a.png" />\n', '    <div>\n      <img src="/a.png" />\n    </div>\n'));
  });

  it('non-adjacent siblings → container at the first one, holding the selected in source order; the unselected stay outside', async () => {
    expect(await wrap([IMG, H1])).toBe(true);
    expect(await disk()).toBe("---\nimport Layout from '../layouts/Layout.astro';\n---\n<Layout title=\"x\">\n  <main class=\"p-8\">\n    <div>\n      <h1 class=\"t\">Title</h1>\n      <img src=\"/a.png\" />\n    </div>\n\n    <p class=\"a\">First</p>\n\n    <p class=\"b\">Second</p>\n\n  </main>\n</Layout>\n");
    const { forward, inverse } = pushUndo.mock.calls[0][0].structuralOp;
    expect(inverse.reduce((src, op) => applyStructuralTransform(src, op).content, forward.reduce((src, op) => applyStructuralTransform(src, op).content, ORIGINAL))).toBe(ORIGINAL);
  });

  it('a layer selected with its own descendant wraps the ancestor only', async () => {
    expect(await wrap([PA, MAIN])).toBe(true);
    expect(await disk()).toBe("---\nimport Layout from '../layouts/Layout.astro';\n---\n<Layout title=\"x\">\n  <div>\n    <main class=\"p-8\">\n      <h1 class=\"t\">Title</h1>\n\n      <p class=\"a\">First</p>\n\n      <p class=\"b\">Second</p>\n\n      <img src=\"/a.png\" />\n    </main>\n  </div>\n</Layout>\n");
  });

  it('two roots of one component invocation wrap its usage tag once', async () => {
    await stopLocalDeleteRuntime(runtime, projectId);
    const src = "---\nimport Card from '../components/Card.astro';\n---\n<main>\n  <Card />\n</main>\n";
    await start({ [PAGE_FILE]: src });
    const usage = { file: PAGE_FILE, line: 5, column: 3 };
    const scan = new Map<string, Node>([
      [`${PAGE_FILE}:4:1`, { parentKey: null, tagName: 'main' }],
      ['src/components/Card.astro:1:1', { parentKey: `${PAGE_FILE}:4:1`, tagName: 'h2', sourceLocation: { file: 'src/components/Card.astro', line: 1, column: 1 }, usageLocation: usage }],
      ['src/components/Card.astro:2:1', { parentKey: `${PAGE_FILE}:4:1`, tagName: 'p', sourceLocation: { file: 'src/components/Card.astro', line: 2, column: 1 }, usageLocation: usage }],
    ]);
    expect(await wrap(['src/components/Card.astro:1:1', 'src/components/Card.astro:2:1'], scan)).toBe(true);
    expect(await disk()).toBe("---\nimport Card from '../components/Card.astro';\n---\n<main>\n  <div>\n    <Card />\n  </div>\n</main>\n");
  });

  it('keeps CRLF line endings', async () => {
    await stopLocalDeleteRuntime(runtime, projectId);
    const crlf = ORIGINAL.replace(/\n/g, '\r\n');
    await start({ [PAGE_FILE]: crlf });
    expect(await wrap([PA, PB])).toBe(true);
    const after = await disk();
    expect(after).toContain('    <div>\r\n      <p class="a">First</p>\r\n      <p class="b">Second</p>\r\n    </div>\r\n');
    expect(after.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('wrapLocalElements — refusals change nothing', () => {
  it('layers with different parents', async () => {
    const scan = pageScan(); scan.set(PB, { parentKey: H1, tagName: 'p' });
    expect(await wrap([PA, PB], scan)).toBe(false);
    expect(toast).toHaveBeenCalledWith(WRAP_DIFFERENT_PARENTS);
    await expectRefused(false, ORIGINAL);
  });

  it.each([
    ['text', '<main>\n  <p>a</p>\n  some text\n  <p>b</p>\n</main>\n', 2, 4],
    ['an expression', '<main>\n  <p>a</p>\n  {count}\n  <p>b</p>\n</main>\n', 2, 4],
    ['the end of a loop body', '<ul>\n  {items.map((i) => (\n    <li>{i}</li>\n  ))}\n  <li>x</li>\n</ul>\n', 3, 5],
  ])('%s between the layers in the source', async (_what, src, a, b) => {
    await stopLocalDeleteRuntime(runtime, projectId);
    await start({ [PAGE_FILE]: src });
    const col = (line: number) => src.split('\n')[line - 1].search(/</) + 1;
    const A = k(a, col(a)), B = k(b, col(b));
    const scan = new Map<string, Node>([[A, { parentKey: 'P', tagName: 'p' }], [B, { parentKey: 'P', tagName: 'p' }], ['P', { parentKey: null, tagName: 'main' }]]);
    expect(await wrap([A, B], scan)).toBe(false);
    expect(toast).toHaveBeenCalledWith(WRAP_NOT_SIBLINGS);
    await expectRefused(false, src);
  });

  it('a loop copy, alone or among others', async () => {
    expect(await wrap([PA, `${PB}#2`])).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Loop copies/));
    await expectRefused(false, ORIGINAL);
  });

  it('a layer with no source location (layout chrome, drawn doc element, instance key)', async () => {
    expect(await wrap(['layoutchrome-header'])).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/no source location/));
    await expectRefused(false, ORIGINAL);
  });

  it('an element inside a component instance, from a page', async () => {
    const heard = vi.fn();
    window.addEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, heard);
    const inner = 'src/components/Card.astro:3:5';
    const scan = pageScan();
    scan.set('src/components/Card.astro:1:1', { parentKey: MAIN, tagName: 'div' });
    scan.set(inner, { parentKey: 'src/components/Card.astro:1:1', tagName: 'p' });
    expect(await wrap([inner], scan)).toBe(false);
    window.removeEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
    await expectRefused(false, ORIGINAL);
  });

  it('a paragraph parent', async () => {
    const scan = pageScan(); scan.set(MAIN, { parentKey: null, tagName: 'p' });
    expect(await wrap([PA], scan)).toBe(false);
    expect(toast).toHaveBeenCalledWith(WRAP_IN_PARAGRAPH);
    await expectRefused(false, ORIGINAL);
  });

  it.each(['ul', 'ol', 'dl', 'table', 'tbody', 'tr', 'select'])('a %s parent', async (tag) => {
    const scan = pageScan(); scan.set(MAIN, { parentKey: null, tagName: tag });
    expect(await wrap([PA, PB], scan)).toBe(false);
    expect(toast).toHaveBeenCalledWith(WRAP_IN_LIST_OR_TABLE);
    await expectRefused(false, ORIGINAL);
  });

  it('the page body', async () => {
    const scan = pageScan(); scan.set(MAIN, { parentKey: null, tagName: 'body' });
    expect(await wrap([MAIN], scan)).toBe(false);
    expect(toast).toHaveBeenCalledWith(WRAP_PAGE_ROOT);
    await expectRefused(false, ORIGINAL);
  });

  it('no surface file yet', async () => {
    setLocalPageFile(null);
    expect(await wrap([PA])).toBe(false);
    expect(toast).not.toHaveBeenCalled();
    await expectRefused(false, ORIGINAL);
  });
});
