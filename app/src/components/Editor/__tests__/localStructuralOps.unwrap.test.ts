/**
 * "Remove container" (⇧⌘G), the inverse of Create container: the selected
 * element's child layers move out to its place, in order, and the element goes.
 * Real gesture + durable acceptance + temp disk; one accepted write, one undo
 * record whose replay is byte-exact both ways.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import toast from 'react-hot-toast';
import * as Y from 'yjs';
import { applyStructuralTransform } from '@/services/durableEdits/structuralTransform';
import { acceptStructuralReplay } from '@/services/durableEdits/structuralReplayAcceptance';
import { clearLocalPendingSelection, peekLocalPendingSelection } from '@/utils/localPendingSelection';
import { LOCAL_CROSS_FILE_WRITE_EVENT } from '@/utils/localWriteScope';
import type { StructuralUndoRecord } from '@/store/structuralUndo';
import {
  freshLocalProjectId, startLocalDeleteRuntime, stopLocalDeleteRuntime, flushAccepted, PAGE_FILE,
} from '@/hooks/__tests__/localDeleteRuntime';
import {
  unwrapLocalElement, UNWRAP_EMPTY, UNWRAP_TEXT_OR_CODE, UNWRAP_COMPONENT, WRAP_IN_PARAGRAPH, WRAP_IN_LIST_OR_TABLE, WRAP_PAGE_ROOT,
} from '../localStructuralOps';

type Node = { parentKey: string | null; tagName: string; sourceLocation?: { file: string; line: number; column: number } };

const HEAD = "---\nimport Layout from '../layouts/Layout.astro';\nconst show = true;\n---\n<Layout title=\"x\">\n  <main class=\"p-8\">\n    <h1 class=\"t\">Title</h1>\n";
const TAIL = "\n    <img src=\"/a.png\" />\n  </main>\n</Layout>\n";
const ORIGINAL = HEAD + "    <div class=\"box\">\n      <p class=\"a\">First</p>\n\n      {show && <p class=\"b\">Second</p>}\n    </div>\n" + TAIL;
const UNWRAPPED = HEAD + "    <p class=\"a\">First</p>\n    {show && <p class=\"b\">Second</p>}\n" + TAIL;
const k = (line: number, col = 5) => `${PAGE_FILE}:${line}:${col}`;
const MAIN = k(6, 3), H1 = k(7), BOX = k(8), PA = k(9, 7), PB = k(11, 16), IMG = k(14);
const pageScan = (): Map<string, Node> => new Map<string, Node>([
  [MAIN, { parentKey: 'layoutchrome-body', tagName: 'main' }],
  [H1, { parentKey: MAIN, tagName: 'h1' }],
  [BOX, { parentKey: MAIN, tagName: 'div' }],
  [PA, { parentKey: BOX, tagName: 'p' }],
  [PB, { parentKey: BOX, tagName: 'p' }],
  [IMG, { parentKey: MAIN, tagName: 'img' }],
]);

let projectId: string;
let runtime: Awaited<ReturnType<typeof startLocalDeleteRuntime>>;
const deselect = vi.fn();
const pushUndo = vi.fn<(r: StructuralUndoRecord) => void>();

async function start(src: string) {
  projectId = freshLocalProjectId('unwrap');
  runtime = await startLocalDeleteRuntime(projectId, { [PAGE_FILE]: src });
}
async function restart(src: string) { await stopLocalDeleteRuntime(runtime, projectId); await start(src); }
const disk = async () => { await flushAccepted(projectId); return runtime.read(PAGE_FILE); };
const unwrap = (keys: string[], scannedByKey: Map<string, Node> = pageScan()) =>
  unwrapLocalElement({ keys, scannedByKey, pushUndo, deselect });

/** Refused with `message`: nothing written, nothing recorded, the selection left alone. */
async function expectRefused(ok: boolean, message: unknown, original = ORIGINAL) {
  expect(ok).toBe(false);
  if (message) expect(toast).toHaveBeenCalledWith(message);
  expect(toast.error).not.toHaveBeenCalled();
  expect(await flushAccepted(projectId)).toBe(0);
  expect(runtime.read(PAGE_FILE)).toBe(original);
  expect(pushUndo).not.toHaveBeenCalled();
  expect(deselect).not.toHaveBeenCalled();
  expect(peekLocalPendingSelection()).toBeNull();
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearLocalPendingSelection();
  await start(ORIGINAL);
});
afterEach(async () => {
  await stopLocalDeleteRuntime(runtime, projectId);
  clearLocalPendingSelection();
});

describe('unwrapLocalElement — writes', () => {
  it('the children move out to its place, in order, and it goes; one undo record, byte-exact both ways', async () => {
    expect(await unwrap([BOX])).toBe(true);
    expect(await disk()).toBe(UNWRAPPED);
    expect(await flushAccepted(projectId)).toBe(1); // ONE accepted revision
    expect(toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    expect(pushUndo).toHaveBeenCalledTimes(1);
    const { forward, inverse, sourceFiles } = pushUndo.mock.calls[0][0].structuralOp;
    expect(forward.map(op => op.kind)).toEqual(['move', 'move', 'remove']);
    expect(sourceFiles?.map(f => [f.file, f.beforeSource, f.afterSource])).toEqual([[PAGE_FILE, ORIGINAL, UNWRAPPED]]);
    expect(forward.reduce((src, op) => applyStructuralTransform(src, op).content, ORIGINAL)).toBe(UNWRAPPED);
    expect(inverse.reduce((src, op) => applyStructuralTransform(src, op).content, UNWRAPPED)).toBe(ORIGINAL);

    // ⌘Z / ⇧⌘Z through the real replay.
    const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
    const { origin } = pushUndo.mock.calls[0][0];
    await acceptStructuralReplay(doc, inverse, sourceFiles, 'before', undefined, false, origin);
    expect(await disk()).toBe(ORIGINAL);
    await acceptStructuralReplay(doc, forward, sourceFiles, 'after', undefined, false, origin);
    expect(await disk()).toBe(UNWRAPPED);
  });

  it('the first former child becomes the selection on the next scan', async () => {
    await unwrap([BOX]);
    expect(deselect).toHaveBeenCalledTimes(1);
    expect(peekLocalPendingSelection()).toMatchObject({ file: PAGE_FILE, sourceLocation: { file: PAGE_FILE, line: 8, column: 5 } });
  });

  it('extra selected layers are ignored: only the primary is removed', async () => {
    expect(await unwrap([BOX, H1, IMG])).toBe(true);
    expect(await disk()).toBe(UNWRAPPED);
  });

  it('comments between the children are allowed (they go with the container)', async () => {
    await restart(ORIGINAL.replace('\n\n      {show', '\n      <!-- note -->\n      {show'));
    expect(await unwrap([BOX])).toBe(true);
    expect(await disk()).toBe(UNWRAPPED);
  });
});

describe('unwrapLocalElement — refusals change nothing', () => {
  it('an element with no child layers', async () => {
    await expectRefused(await unwrap([IMG]), UNWRAP_EMPTY);
  });

  it.each([
    ['text', '<main>\n  <div>\n    <p>a</p>\n    some text\n  </div>\n</main>\n'],
    ['an expression', '<main>\n  <div>\n    <p>a</p>\n    {count}\n  </div>\n</main>\n'],
    ['a condition around it', '<main>\n  {show && <div>\n    <p>a</p>\n  </div>}\n</main>\n'],
  ])('%s', async (_what, src) => {
    await restart(src);
    const line = src.split('\n').findIndex(l => l.includes('<div>')) + 1;
    const DIV = k(line, src.split('\n')[line - 1].indexOf('<div>') + 1);
    const scan = new Map<string, Node>([['M', { parentKey: null, tagName: 'main' }], [DIV, { parentKey: 'M', tagName: 'div' }]]);
    await expectRefused(await unwrap([DIV], scan), UNWRAP_TEXT_OR_CODE, src);
  });

  it('a component usage', async () => {
    const src = "---\nimport Card from '../components/Card.astro';\n---\n<main>\n  <Card>\n    <p>a</p>\n  </Card>\n</main>\n";
    await restart(src);
    const scan = new Map<string, Node>([['M', { parentKey: null, tagName: 'main' }], [k(5, 3), { parentKey: 'M', tagName: 'div' }]]);
    await expectRefused(await unwrap([k(5, 3)], scan), UNWRAP_COMPONENT, src);
  });

  it('a loop copy', async () => {
    await expectRefused(await unwrap([`${BOX}#2`]), expect.stringMatching(/^Loop copies/));
  });

  it('layout chrome / no source location', async () => {
    await expectRefused(await unwrap(['layoutchrome-header']), expect.stringMatching(/no source location/));
  });

  it('an element inside a component instance, from a page', async () => {
    const heard = vi.fn();
    window.addEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, heard);
    const scan = pageScan();
    scan.set('src/components/Card.astro:1:1', { parentKey: MAIN, tagName: 'div' });
    const ok = await unwrap(['src/components/Card.astro:1:1'], scan);
    window.removeEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
    await expectRefused(ok, null);
  });

  it('the page body', async () => {
    const scan = pageScan(); scan.set(BOX, { parentKey: null, tagName: 'body' });
    await expectRefused(await unwrap([BOX], scan), WRAP_PAGE_ROOT);
  });

  it('a paragraph parent', async () => {
    const scan = pageScan(); scan.set(MAIN, { parentKey: null, tagName: 'p' });
    await expectRefused(await unwrap([BOX], scan), WRAP_IN_PARAGRAPH);
  });

  it.each(['ul', 'table', 'tr', 'select'])('a %s parent', async (tag) => {
    const scan = pageScan(); scan.set(MAIN, { parentKey: null, tagName: tag });
    await expectRefused(await unwrap([BOX], scan), WRAP_IN_LIST_OR_TABLE);
  });
});
