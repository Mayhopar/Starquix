// Findings 13/19 (adversarial review of the gap-9 group delete): the sort/
// dedupe collapses a `#n` loop-copy member and its unsuffixed twin onto ONE
// effective target, and the STABLE sort kept whichever came first in selection
// order. When the suffixed member won the dedupe slot, deleteLocalElement
// refused it (INSTANCE_BLOCKED — the refusal runs BEFORE its usage retarget),
// and the unsuffixed twin that WOULD have deleted was already filtered out:
// net effect, nothing deleted. The fix orders the unsuffixed member first
// among equal effective targets so the dedupe keeps the writable one.
//
// Uses the REAL resolveLocalUsageTarget (unlike the sibling localGroupDelete
// test) so finding 19's exact path is exercised: isPlacementRoot's parseKey
// silently truncates `#n`, letting a suffixed loop-copy resolve to the SAME
// usage tag as the unsuffixed root.

// Since fdd2d12f the group no longer calls a per-member deleteLocal seam: it
// plans every member into ONE source gesture. So the dedupe winner is observed
// on the REAL gesture: the combined undo record's forward ops (and the
// INSTANCE_BLOCKED refusal toast a suffixed winner would raise).

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import toast from 'react-hot-toast';
import { deleteLocalElementGroup } from '../useKeyboardShortcuts';
import type { UsageTargetNode } from '@/utils/localUsageTarget';
import type { StructuralUndoRecord } from '@/store/structuralUndo';
import {
  PAGE_FILE, pageSource, startLocalDeleteRuntime, stopLocalDeleteRuntime, freshLocalProjectId,
} from './localDeleteRuntime';

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  });
  return { default: t, toast: t, Toaster: () => null };
});

// localStructuralOps' INSTANCE_BLOCKED copy (module-private).
const isInstanceBlocked = (m: unknown) => typeof m === 'string' && m.startsWith('Loop copies / component internals');
const instanceBlockedToasts = () => vi.mocked(toast).mock.calls.filter(([m]) => isInstanceBlocked(m)).length;

const mockClearSelection = vi.fn();
const mockPushUndo = vi.fn();
let projectId = '';
let doc: Y.Doc;
let runtime: Awaited<ReturnType<typeof startLocalDeleteRuntime>> | undefined;

function deps(scannedByKey: ReadonlyMap<string, UsageTargetNode>) {
  return {
    clearSelection: mockClearSelection,
    pushUndo: mockPushUndo,
    scannedByKey,
    docDeps: {
      doc,
      dispatch: vi.fn(),
      scannedElements: [],
    },
    takeSnapshot: vi.fn(),
  };
}

const forwardLocs = () => {
  expect(mockPushUndo).toHaveBeenCalledTimes(1);
  return (mockPushUndo.mock.calls[0][0] as StructuralUndoRecord).structuralOp.forward
    .map((op) => (op as { loc: { line: number; column: number } }).loc)
    .map(({ line, column }) => `${line}:${column}`);
};

beforeEach(async () => {
  vi.clearAllMocks();
  projectId = freshLocalProjectId('suffix');
  doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  runtime = await startLocalDeleteRuntime(projectId, {
    [PAGE_FILE]: pageSource(32, { 10: '    <p>L10</p>', 30: '  <p>L30</p>' }),
  });
});

afterEach(async () => {
  await stopLocalDeleteRuntime(runtime, projectId);
  runtime = undefined;
});

describe('group delete suffix dedupe (findings 13/19)', () => {
  it('finding 13: template + its #n loop copy — the UNSUFFIXED member survives the dedupe even when the suffixed one was selected first', async () => {
    const template = `${PAGE_FILE}:10:5`;
    const copy = `${PAGE_FILE}:10:5#1`;
    // Same-file page elements: no usage retarget, both parse to 10:5.
    const scannedByKey = new Map<string, UsageTargetNode>([
      [template, { sourceLocation: { file: PAGE_FILE, line: 10, column: 5 } }],
      [copy, { sourceLocation: { file: PAGE_FILE, line: 10, column: 5 } }],
    ]);

    // Suffixed member FIRST in selection order — the stable sort used to keep
    // it, and it would then be refused (INSTANCE_BLOCKED) with the deletable
    // twin already dropped.
    await deleteLocalElementGroup(
      [{ key: copy, elementId: null }, { key: template, elementId: null }],
      deps(scannedByKey),
    );

    expect(forwardLocs()).toEqual(['10:5']);
    expect(instanceBlockedToasts()).toBe(0);
  });

  it('finding 19: component root + #n loop copy both resolve to the SAME usage tag — the unsuffixed root survives', async () => {
    const root = 'src/components/Card.astro:5:1';
    const copy = 'src/components/Card.astro:5:1#1';
    const usage = { file: PAGE_FILE, line: 30, column: 3 };
    // Cross-file component roots with a same-file usage tag: the REAL
    // resolveLocalUsageTarget resolves BOTH (parseKey truncates `#1`, so
    // isPlacementRoot classifies the copy as a source root too).
    const scannedByKey = new Map<string, UsageTargetNode>([
      [root, {
        sourceLocation: { file: 'src/components/Card.astro', line: 5, column: 1 },
        usageLocation: usage,
      }],
      [copy, {
        sourceLocation: { file: 'src/components/Card.astro', line: 5, column: 1 },
        usageLocation: usage,
      }],
    ]);

    await deleteLocalElementGroup(
      [{ key: copy, elementId: null }, { key: root, elementId: null }],
      deps(scannedByKey),
    );

    // The root won the slot and was retargeted to its usage tag.
    expect(forwardLocs()).toEqual(['30:3']);
    expect(instanceBlockedToasts()).toBe(0);
  });

  it('two loop copies of one target still dedupe to a single member (refusal toast fires once, unchanged)', async () => {
    const copy1 = `${PAGE_FILE}:10:5#1`;
    const copy2 = `${PAGE_FILE}:10:5#2`;
    const scannedByKey = new Map<string, UsageTargetNode>([
      [copy1, { sourceLocation: { file: PAGE_FILE, line: 10, column: 5 } }],
      [copy2, { sourceLocation: { file: PAGE_FILE, line: 10, column: 5 } }],
    ]);

    await deleteLocalElementGroup(
      [{ key: copy1, elementId: null }, { key: copy2, elementId: null }],
      deps(scannedByKey),
    );

    // Only one member reaches planning, which refuses suffixed keys with ONE toast.
    expect(instanceBlockedToasts()).toBe(1);
    expect(mockPushUndo).not.toHaveBeenCalled();
  });
});
