import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyCommand } from '@/store/commands';
import { emptyClassData } from '@/store/types';
import * as Y from 'yjs';
import { CLIPBOARD_VERSION, type ClipboardEnvelope } from '../envelope';

vi.mock('../capture', () => ({ captureSelection: vi.fn() }));
vi.mock('../systemClipboard', () => ({ writeClipboardHtml: vi.fn(), readClipboardHtml: vi.fn() }));
vi.mock('../pasteDoc', () => ({ pasteEnvelopeIntoDoc: vi.fn(async () => true) }));
vi.mock('../pasteLocal', () => ({ pasteEnvelopeIntoLocal: vi.fn(async () => true) }));

import { captureSelection } from '../capture';
import { writeClipboardHtml, readClipboardHtml } from '../systemClipboard';
import { pasteEnvelopeIntoDoc } from '../pasteDoc';
import { pasteEnvelopeIntoLocal } from '../pasteLocal';
import { encodeEnvelopeHtml } from '../envelope';
import { copySelection, cutSelection, pasteClipboard, duplicateSelection, type ClipboardActionDeps } from '../clipboardActions';

const capture = captureSelection as ReturnType<typeof vi.fn>;
const writeHtml = writeClipboardHtml as ReturnType<typeof vi.fn>;
const readHtml = readClipboardHtml as ReturnType<typeof vi.fn>;
const pasteDocFn = pasteEnvelopeIntoDoc as ReturnType<typeof vi.fn>;
const pasteLocalFn = pasteEnvelopeIntoLocal as ReturnType<typeof vi.fn>;

const env = (roots = 1): ClipboardEnvelope => ({
  v: CLIPBOARD_VERSION,
  sourceProjectId: 'browser_src',
  roots: Array.from({ length: roots }, (_, i) => ({ label: `r${i}`, html: `<div>${i}</div>` })),
  masters: [],
  assets: [],
});

function makeDeps(over: Partial<ClipboardActionDeps> = {}): ClipboardActionDeps & {
  toast: ReturnType<typeof vi.fn>; takeSnapshot: ReturnType<typeof vi.fn>;
  clearSelection: ReturnType<typeof vi.fn>; deleteLocalGroup: ReturnType<typeof vi.fn>;
} {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'e1', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: emptyClassData() } });
  return {
    doc,
    entries: [{ key: 'e1', elementId: 'e1' }],
    scannedByKey: new Map(),
    scannedElements: [],
    pageId: 'page-1',
    projectId: 'browser_target',
    selectedElementId: null,
    selectedKey: null,
    pageFile: null,
    dispatch: vi.fn(() => true),
    takeSnapshot: vi.fn(),
    clearSelection: vi.fn(),
    pushStructuralUndo: vi.fn(),
    deleteLocalGroup: vi.fn(async () => {}),
    toast: vi.fn(),
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  capture.mockResolvedValue(env());
  writeHtml.mockResolvedValue(true);
  readHtml.mockResolvedValue(null);
});

describe('copySelection', () => {
  it('captures, writes, toasts the count', async () => {
    const deps = makeDeps();
    await expect(copySelection(deps)).resolves.toBe(true);
    expect(writeHtml).toHaveBeenCalledTimes(1);
    expect(deps.toast).toHaveBeenCalledWith('Copied 1 element');
  });

  it('returns false without writing when capture yields null', async () => {
    capture.mockResolvedValue(null);
    await expect(copySelection(makeDeps())).resolves.toBe(false);
    expect(writeHtml).not.toHaveBeenCalled();
  });
});

describe('cutSelection', () => {
  it('deletes entries only after a successful copy', async () => {
    const deps = makeDeps();
    await cutSelection(deps);
    expect(deps.doc.getMap('elements').has('e1')).toBe(false);
    expect(deps.takeSnapshot).toHaveBeenCalled();
    expect(deps.clearSelection).toHaveBeenCalled();
  });

  it('does NOT delete when the clipboard write fails', async () => {
    writeHtml.mockResolvedValue(false);
    const deps = makeDeps();
    await cutSelection(deps);
    expect(deps.doc.getMap('elements').has('e1')).toBe(true);
  });

  it('routes source-keyed members through deleteLocalGroup on the local runtime', async () => {
    const deps = makeDeps({
      projectId: 'browser_lf_folder',
      entries: [{ key: 'src/pages/index.astro:5:1', elementId: null }],
    });
    await cutSelection(deps);
    expect(deps.deleteLocalGroup).toHaveBeenCalledTimes(1);
    expect(deps.doc.getMap('elements').has('e1')).toBe(true);
  });
});

describe('pasteClipboard', () => {
  it('is a silent no-op when the clipboard html has no sentinel', async () => {
    readHtml.mockResolvedValue('<p>external content</p>');
    const deps = makeDeps();
    await pasteClipboard(deps);
    expect(pasteDocFn).not.toHaveBeenCalled();
    expect(pasteLocalFn).not.toHaveBeenCalled();
    expect(deps.toast).not.toHaveBeenCalled();
  });

  it('toasts "Nothing to paste" when the clipboard is empty/unreadable', async () => {
    readHtml.mockResolvedValue(null);
    const deps = makeDeps();
    await pasteClipboard(deps);
    expect(deps.toast).toHaveBeenCalledWith('Nothing to paste');
  });

  it('toasts the version message when the sentinel is present but undecodable', async () => {
    readHtml.mockResolvedValue('<span data-sq-clipboard="!!!bad!!!">x</span>');
    const deps = makeDeps();
    await pasteClipboard(deps);
    expect(deps.toast).toHaveBeenCalledWith("Can't paste — copied with an older Starquix version");
    expect(pasteDocFn).not.toHaveBeenCalled();
  });

  it('routes a doc-runtime paste to pasteEnvelopeIntoDoc', async () => {
    readHtml.mockResolvedValue(encodeEnvelopeHtml(env()));
    const deps = makeDeps();
    await pasteClipboard(deps);
    expect(pasteDocFn).toHaveBeenCalledTimes(1);
    expect(pasteLocalFn).not.toHaveBeenCalled();
  });

  it('routes a local-runtime paste to pasteEnvelopeIntoLocal', async () => {
    readHtml.mockResolvedValue(encodeEnvelopeHtml(env()));
    const deps = makeDeps({ projectId: 'browser_lf_folder', pageFile: 'src/pages/index.astro' });
    await pasteClipboard(deps);
    expect(pasteLocalFn).toHaveBeenCalledTimes(1);
    expect(pasteDocFn).not.toHaveBeenCalled();
  });
});

describe('duplicateSelection', () => {
  it('captures and pastes directly, never touching the OS clipboard', async () => {
    const deps = makeDeps();
    await duplicateSelection(deps);
    expect(writeHtml).not.toHaveBeenCalled();
    expect(readHtml).not.toHaveBeenCalled();
    expect(pasteDocFn).toHaveBeenCalledTimes(1);
  });
});
