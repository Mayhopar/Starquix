// Gap-9 (WC↔local parity): multi-select group Delete in the LOCAL runtime.
// Before the fix, any group containing a source-keyed member was refused with
// LOCAL_GROUP_BLOCKED ("One element at a time in local mode"). Now the group
// deletes member-by-member through the SAME deleteLocalElement path a single
// delete uses, ordered BOTTOM-UP (descending effective file:line) so no
// member's span goes stale, with doc-backed (drawn) members riding the WC
// per-kind matrix under one snapshot, and ONE combined structural-undo record.

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import toast from 'react-hot-toast';
import {
  useKeyboardShortcuts,
  deleteLocalElementGroup,
} from '../useKeyboardShortcuts';
import {
  LOCAL_GROUP_BLOCKED,
  tryAcquireStructuralWrite,
  releaseStructuralWrite,
  _resetStructuralWriteInFlightForTests,
} from '@/components/Editor/localStructuralOps';
import type { MultiSelectionEntry, ScannedElement } from '@/context/SelectionContext';
import type { StructuralUndoRecord } from '@/store/structuralUndo';
import { db } from '@/db';
import {
  PAGE_FILE, pageSource, startLocalDeleteRuntime, stopLocalDeleteRuntime, flushAccepted, freshLocalProjectId,
} from './localDeleteRuntime';

let PROJECT_ID = '';
let runtime: Awaited<ReturnType<typeof startLocalDeleteRuntime>> | undefined;

const { mockResolveUsage } = vi.hoisted(() => ({
  mockResolveUsage: vi.fn(),
}));

// Since fdd2d12f the group no longer calls deleteLocalElement per member: every
// source member is planned into ONE source gesture and accepted durably. The
// tests observe the REAL gesture — the combined undo record (forward = deletion
// order) and the temp disk — instead of a per-member op spy.
vi.mock('@/utils/localUsageTarget', () => ({
  resolveLocalUsageTarget: mockResolveUsage,
}));

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  });
  return { default: t, toast: t, Toaster: () => null };
});

let mockDoc = new Y.Doc();
const mockDispatch = vi.fn();
const mockTakeSnapshot = vi.fn();
const mockPushStructuralUndo = vi.fn();
const mockClearSelection = vi.fn();

let mockSelectedKey: string | null = null;
let mockSelectedElementId: string | null = null;
let mockAdditionalSelections: MultiSelectionEntry[] = [];
let mockScanned: ScannedElement[] = [];

vi.mock('@/context', () => ({
  useClassStore: () => ({ saveAll: vi.fn(), hasUnsavedChanges: false }),
  useTool: () => ({
    activeTool: 'select',
    setActiveTool: vi.fn(),
    isPreview: false,
    setPreview: vi.fn(),
  }),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useYjsValue: () => mockSelectedElementId,
  useEditorDoc: () => mockDoc,
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({
    undo: vi.fn(),
    redo: vi.fn(),
    takeSnapshot: mockTakeSnapshot,
    pushStructuralUndo: mockPushStructuralUndo,
  }),
}));

vi.mock('@/context/SelectionContext', () => ({
  useSelectionContext: () => ({
    selectedKey: mockSelectedKey,
    selectedElementId: mockSelectedElementId,
    selectedSourceLocation: null,
    clearSelection: mockClearSelection,
    contextKey: null,
    enterContext: vi.fn(),
    exitContext: vi.fn(),
    select: vi.fn(),
    additionalSelections: mockAdditionalSelections,
    clearAdditionalSelections: vi.fn(),
  }),
  useScannedElementsRef: () => ({
    scannedElementsRef: { current: mockScanned },
    scannedByKeyRef: { current: new Map(mockScanned.map((el) => [el.key, el])) },
    treeNodesRef: { current: [] },
  }),
}));

function scanned(key: string, parentKey: string | null = null): ScannedElement {
  return {
    key, parentKey, tagName: 'div', classes: '',
    rect: { top: 0, left: 0, width: 10, height: 10 },
    hasSourceTracking: true,
  } as unknown as ScannedElement;
}

function press(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
}

/** The ONE combined record the gesture published (forward = deletion order). */
function pushed(): StructuralUndoRecord {
  expect(mockPushStructuralUndo).toHaveBeenCalledTimes(1);
  return mockPushStructuralUndo.mock.calls[0][0] as StructuralUndoRecord;
}
const forwardLines = (r: StructuralUndoRecord) =>
  r.structuralOp.forward.map((op) => (op as { loc: { line: number } }).loc.line);

async function start(lines: Record<number, string> = {}) {
  runtime = await startLocalDeleteRuntime(PROJECT_ID, { [PAGE_FILE]: pageSource(32, lines) });
}

afterEach(async () => {
  await stopLocalDeleteRuntime(runtime, PROJECT_ID);
  runtime = undefined;
});

beforeEach(() => {
  vi.clearAllMocks();
  _resetStructuralWriteInFlightForTests();
  mockDoc = new Y.Doc();
  PROJECT_ID = freshLocalProjectId('group');
  mockDoc.getMap('meta').set('projectId', PROJECT_ID);
  mockSelectedKey = null;
  mockSelectedElementId = null;
  mockAdditionalSelections = [];
  mockScanned = [];
  mockResolveUsage.mockReturnValue(null);
});

describe('local group Delete via keydown (regression: was LOCAL_GROUP_BLOCKED)', () => {
  it('deletes a source-keyed group bottom-up instead of refusing', async () => {
    await start();
    const keyA = `${PAGE_FILE}:5:1`;
    const keyB = `${PAGE_FILE}:20:1`;
    mockScanned = [scanned(keyA), scanned(keyB)];
    mockSelectedKey = keyA;
    mockAdditionalSelections = [{ key: keyB, elementId: null }];

    renderHook(() => useKeyboardShortcuts());
    press('Delete');

    await vi.waitFor(() => expect(mockPushStructuralUndo).toHaveBeenCalledTimes(1));
    // The old refusal must be gone.
    expect(vi.mocked(toast)).not.toHaveBeenCalledWith(LOCAL_GROUP_BLOCKED);
    // BOTTOM-UP: line 20 deleted before line 5 (descending file:line).
    expect(forwardLines(pushed())).toEqual([20, 5]);
    // ONE clear for the whole gesture.
    await vi.waitFor(() => expect(mockClearSelection).toHaveBeenCalledTimes(1));
    await flushAccepted(PROJECT_ID);
    const disk = runtime!.read(PAGE_FILE);
    expect(disk).not.toContain('<p>L5</p>');
    expect(disk).not.toContain('<p>L20</p>');
    expect(disk).toContain('<p>L4</p>');
    expect(disk).toContain('<p>L21</p>');
  });

  it('mixed group: drawn member goes through the doc matrix under one snapshot, source member through the writer', async () => {
    await start();
    mockDoc.getMap('elements').set('drawn-x', new Y.Map([['isDrawn', true]]));
    const srcKey = `${PAGE_FILE}:8:1`;
    mockScanned = [scanned('drawn-x'), scanned(srcKey)];
    mockSelectedKey = 'drawn-x';
    mockSelectedElementId = 'drawn-x';
    mockAdditionalSelections = [{ key: srcKey, elementId: null }];

    renderHook(() => useKeyboardShortcuts());
    press('Delete');

    await vi.waitFor(() => expect(mockPushStructuralUndo).toHaveBeenCalledTimes(1));
    expect(forwardLines(pushed())).toEqual([8]);
    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(mockDoc.getMap('elements').has('drawn-x')).toBe(false);
    await flushAccepted(PROJECT_ID);
    expect(runtime!.read(PAGE_FILE)).not.toContain('<p>L8</p>');
  });

  it('descendant members are pruned — the ancestor delete carries them', async () => {
    await start({ 5: '<div>', 6: '  <span>L6</span>', 7: '</div>' });
    const parent = `${PAGE_FILE}:5:1`;
    const child = `${PAGE_FILE}:6:3`;
    mockScanned = [scanned(parent), scanned(child, parent)];
    mockSelectedKey = parent;
    mockAdditionalSelections = [{ key: child, elementId: null }];

    renderHook(() => useKeyboardShortcuts());
    press('Delete');

    await vi.waitFor(() => expect(mockPushStructuralUndo).toHaveBeenCalledTimes(1));
    expect(forwardLines(pushed())).toEqual([5]);
    await flushAccepted(PROJECT_ID);
    const disk = runtime!.read(PAGE_FILE);
    expect(disk).not.toContain('<span>L6</span>');
    expect(disk).toContain('<p>L4</p>');
    expect(disk).toContain('<p>L8</p>');
  });

  it('auto-repeat keydown is dropped', async () => {
    await start();
    const keyA = `${PAGE_FILE}:5:1`;
    mockScanned = [scanned(keyA), scanned(`${PAGE_FILE}:9:1`)];
    mockSelectedKey = keyA;
    mockAdditionalSelections = [{ key: `${PAGE_FILE}:9:1`, elementId: null }];

    renderHook(() => useKeyboardShortcuts());
    press('Delete', { repeat: true });

    await new Promise((r) => setTimeout(r, 20));
    expect(mockPushStructuralUndo).not.toHaveBeenCalled();
    expect(await db.durableEdits.count()).toBe(0);
  });
});

describe('deleteLocalElementGroup (direct)', () => {
  const docDeps = () => ({ doc: mockDoc, dispatch: mockDispatch, scannedElements: [] });
  const baseDeps = () => ({
    clearSelection: mockClearSelection,
    pushUndo: mockPushStructuralUndo,
    scannedByKey: new Map(),
    docDeps: docDeps(),
    takeSnapshot: mockTakeSnapshot,
  });

  // Owner 2026-11-10: no refusal — the group waits its turn, then deletes.
  it('a structural write in flight → the whole group waits its turn, then deletes', async () => {
    await start();
    expect(tryAcquireStructuralWrite()).toBe(true); // simulate an in-flight write
    const pending = deleteLocalElementGroup([{ key: `${PAGE_FILE}:5:1`, elementId: null }], baseDeps());
    await new Promise((r) => setTimeout(r, 0));
    expect(await db.durableEdits.count()).toBe(0); // still waiting
    releaseStructuralWrite();
    await pending;
    expect(await db.durableEdits.count()).toBe(1);
    expect(mockPushStructuralUndo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast)).not.toHaveBeenCalled();
  });

  it('pushes ONE combined undo record: forward in deletion order, inverse reversed', async () => {
    await start();
    const keyLow = `${PAGE_FILE}:5:1`;
    const keyHigh = `${PAGE_FILE}:20:1`;
    await deleteLocalElementGroup(
      [{ key: keyLow, elementId: null }, { key: keyHigh, elementId: null }],
      baseDeps(),
    );

    const combined = pushed();
    expect(combined.structuralOp.forward).toHaveLength(2);
    expect(combined.structuralOp.inverse).toHaveLength(2);
    // Deletion (forward) order: high line first; inverse restores the low
    // line's element first (reverse deletion order).
    expect(forwardLines(combined)).toEqual([20, 5]);
    const inverseTexts = combined.structuralOp.inverse.map(
      (op) => (op as { text: string }).text.trim(),
    );
    expect(inverseTexts).toEqual(['<p>L5</p>', '<p>L20</p>']);
  });

  it('orders by the EFFECTIVE target (usage retarget) and dedupes members resolving to one usage tag', async () => {
    await start();
    const cardA = 'src/components/Card.astro:2:1~p0000000000000001';
    const cardB = 'src/components/Card.astro:2:1~p0000000000000002';
    const pageEl = `${PAGE_FILE}:10:1`;
    // Both card members retarget to the SAME usage tag at page line 30.
    mockResolveUsage.mockImplementation((key: string) =>
      key === cardA || key === cardB
        ? { file: PAGE_FILE, line: 30, column: 1 }
        : null,
    );
    await deleteLocalElementGroup(
      [
        { key: pageEl, elementId: null },
        { key: cardA, elementId: null },
        { key: cardB, elementId: null },
      ],
      baseDeps(),
    );

    // cardB deduped (same effective span as cardA); usage line 30 deleted
    // BEFORE the raw page element at line 10.
    expect(forwardLines(pushed())).toEqual([30, 10]);
    await flushAccepted(PROJECT_ID);
    const disk = runtime!.read(PAGE_FILE);
    expect(disk).not.toContain('<p>L30</p>');
    expect(disk).not.toContain('<p>L10</p>');
    expect(disk).toContain('<p>L29</p>');
    expect(disk).toContain('<p>L31</p>');
  });

  it('a refused member skips, the rest still delete; nothing deleted → selection kept', async () => {
    await start();
    const keyA = `${PAGE_FILE}:5:1`;
    // A `#n` loop copy is refused per member (INSTANCE_BLOCKED).
    const refusedB = `${PAGE_FILE}:20:1#1`;
    await deleteLocalElementGroup(
      [{ key: keyA, elementId: null }, { key: refusedB, elementId: null }],
      baseDeps(),
    );
    expect(forwardLines(pushed())).toEqual([5]);
    expect(mockClearSelection).toHaveBeenCalledTimes(1);

    // All members refused → selection stays for the retry.
    vi.clearAllMocks();
    await deleteLocalElementGroup(
      [{ key: `${PAGE_FILE}:8:1#1`, elementId: null }, { key: `${PAGE_FILE}:12:1#2`, elementId: null }],
      baseDeps(),
    );
    expect(mockClearSelection).not.toHaveBeenCalled();
    expect(mockPushStructuralUndo).not.toHaveBeenCalled();
  });
});
