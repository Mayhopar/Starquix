import 'fake-indexeddb/auto';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
/**
 * task-151 — undo/redo must NEVER re-navigate the preview.
 *
 * task-149 made ⌘Z visible on the local canvas by requesting `sq:reload-preview`
 * whenever the applied snapshot added or removed a key in `sourceClasses` /
 * `sourceText` / `sourceImageAttributes`. It worked, and it was the wrong
 * instrument — two live measurements retired it:
 *
 * 1. **It costs 100 % of the scroll position.** At the editor's exact 375×667
 *    geometry the local frame scrolls 1087 px internally and the reload returns
 *    it to 0 after 1036 ms (`keys/r7/runA-SJ-scroll-cost.txt`). Server mode
 *    loses 0 px because it patches in place — so the fix closed one divergence
 *    from server by opening another.
 * 2. **It did not reliably work.** ⇧⌘Z after the ⌘Z that follows a Reset left
 *    the canvas byte-identical to the pre-redo image at +1/+6/+20 s
 *    (`e1d75e83…`), 2 runs of 2, *even though* the reload was requested and the
 *    frame loaded (+130 333 ms → +188 ms). A second, hand-dispatched, identical
 *    reload cleaned it in 4 s — a race, not a missing reload
 *    (`keys/r7/runA-SZ-console-and-md5.txt`).
 *
 * The repaint now happens where every value change already happens — the class /
 * text / image observers, patching in place. See
 * `ClassStoreContext.undoRepaint.test.tsx`, `hooks/useSourceImageSync.test.ts`
 * and `bridge/parts/__tests__/undo-restore-baselines.test.ts`.
 *
 * `sq:reload-preview` itself stays: DesignBar's "Reset to master" is a
 * deliberate, confirmed, discard-everything action and still uses it
 * (`Canvas/reloadPreview.ts`). This file exists so undo/redo never gets moved
 * back onto it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';

import { UndoProvider, useUndoContext } from '../UndoContext';
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import {
  setLocalExpectedRoute,
  _resetLocalPageSyncForTests,
} from '@/utils/localPageSync';
import { clearLocalOverrides } from '@/store/localMasterOverrides';

const HEADING = 'src/components/Feature.astro:20:5~p4317f4b4863ead18';
const PARA = 'src/components/Feature.astro:25:5~p4317f4b4863ead18';

function seedOverrides(doc: Y.Doc): void {
  doc.transact(() => {
    const map = doc.getMap('sourceClasses');
    for (const [key, classes] of [
      [HEADING, 'text-2xl text-red-500'],
      [PARA, 'text-base text-violet-500'],
    ] as const) {
      const entry = new Y.Map();
      entry.set('classes', classes);
      entry.set('edited', true);
      map.set(key, entry);
    }
  }, 'sync');
}

/** DesignBar's Reset to master: takeSnapshot() then the REAL clearLocalOverrides. */
function resetToMaster(doc: Y.Doc): void {
  const loc = (line: number) => ({ file: 'src/components/Feature.astro', line, column: 5 });
  clearLocalOverrides(doc, [
    { kind: 'classes', key: HEADING, sourceLocation: loc(20), value: 'text-2xl text-red-500' },
    { kind: 'classes', key: PARA, sourceLocation: loc(25), value: 'text-base text-violet-500' },
  ] as Parameters<typeof clearLocalOverrides>[1], 'user');
}

const overrideKeys = (doc: Y.Doc): string[] => {
  const out: string[] = [];
  doc.getMap('sourceClasses').forEach((_v, k) => out.push(k));
  return out.sort();
};

describe('undo/redo of a local doc-only overlay change never re-navigates the preview', () => {
  let wrapper: React.FC<{ children: React.ReactNode }>;
  let reloads: number;
  let onReload: () => void;

  beforeEach(() => {
    reloads = 0;
    onReload = () => { reloads += 1; };
    window.addEventListener('sq:reload-preview', onReload);
    // Editor arms this in local mode only — the runtime the reload was added for.
    setLocalExpectedRoute('/');
    // Undo/redo are durable acceptances (7932857b): seed a project id.
    const ProjectSeed = ({ children }: { children: React.ReactNode }) => {
      const doc = useEditorDoc();
      React.useLayoutEffect(() => { doc.getMap('meta').set('projectId', crypto.randomUUID()); }, [doc]);
      return <>{children}</>;
    };
    wrapper = ({ children }: { children: React.ReactNode }) => (
      <EditorProvider>
        <ProjectSeed><UndoProvider>{children}</UndoProvider></ProjectSeed>
      </EditorProvider>
    );
  });

  afterEach(() => {
    window.removeEventListener('sq:reload-preview', onReload);
    _resetLocalPageSyncForTests();
    vi.restoreAllMocks();
  });

  const setup = async () => await renderReadyEditorHook(() => ({ ...useUndoContext(), doc: useEditorDoc() }), { wrapper });

  it('undo of Reset to master restores the doc and reloads nothing', async () => {
    const { result } = await setup();
    const doc = result.current.doc;
    seedOverrides(doc);

    act(() => result.current.takeSnapshot());
    act(() => resetToMaster(doc));
    expect(overrideKeys(doc)).toEqual([]);
    expect(result.current.canUndo).toBe(true); // Reset is an undoable step
    await act(async () => { await result.current.undo(); });

    expect(overrideKeys(doc)).toEqual([HEADING, PARA].sort());
    expect(reloads).toBe(0);
  });

  it('redo of Reset to master removes them again and reloads nothing', async () => {
    const { result } = await setup();
    const doc = result.current.doc;
    seedOverrides(doc);

    act(() => result.current.takeSnapshot());
    act(() => resetToMaster(doc));
    expect(result.current.canUndo).toBe(true); // Reset is an undoable step
    await act(async () => { await result.current.undo(); });
    expect(overrideKeys(doc)).toEqual([HEADING, PARA].sort());
    await act(async () => { await result.current.redo(); });

    expect(overrideKeys(doc)).toEqual([]);
    expect(reloads).toBe(0);
  });

  it('a TEXT overlay key change reloads nothing either', async () => {
    const { result } = await setup();
    const doc = result.current.doc;
    doc.transact(() => {
      const entry = new Y.Map();
      entry.set('textContent', 'Hand-written headline');
      doc.getMap('sourceText').set(HEADING, entry);
    }, 'sync');

    act(() => result.current.takeSnapshot());
    // Only a user/ai transaction commits the checkpoint (c8535b79).
    act(() => { doc.transact(() => doc.getMap('sourceText').delete(HEADING), 'user'); });
    await act(async () => { await result.current.undo(); });

    expect(doc.getMap('sourceText').has(HEADING)).toBe(true);
    expect(reloads).toBe(0);
  });

  it('an IMAGE overlay key change reloads nothing either', async () => {
    const { result } = await setup();
    const doc = result.current.doc;
    doc.transact(() => {
      const entry = new Y.Map();
      entry.set('src', '/mine.png');
      doc.getMap('sourceImageAttributes').set(HEADING, entry);
    }, 'sync');

    act(() => result.current.takeSnapshot());
    act(() => { doc.transact(() => doc.getMap('sourceImageAttributes').delete(HEADING), 'user'); });
    await act(async () => { await result.current.undo(); });

    expect(doc.getMap('sourceImageAttributes').has(HEADING)).toBe(true);
    expect(reloads).toBe(0);
  });
});
