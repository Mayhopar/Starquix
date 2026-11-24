/**
 * REPRO (investigation 2026-11-23, docs/plans/instance-override-architecture.md):
 * an editor-only override is addressed by `file:line:col` — a coordinate, not
 * an element. When another writer (the AI agent's write_file / edit_file, an
 * IDE, git) rewrites the component and lines shift, the stored entry stays at
 * the old coordinate and the scan re-apply paints it onto whatever element sits
 * there now. In the user's session the agent added comment lines to
 * BlogCard.astro and `<time>` / `<h2>` swapped places; the localStorage mirror
 * still holds entries at coordinates of older layouts (`25:3`, `26:16`, `27:5`,
 * `28:18`).
 *
 * `it.fails` = the assertion states the DESIRED behaviour and fails today.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { handleElementsScanned } from '../scanning';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { applyCommand } from '@/store/commands';
import { localOverridesForPlacement } from '@/store/localMasterOverrides';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';

const CARD = 'src/components/BlogCard.astro';
const P = 's73bb06627ed37e6c';
const rect = { top: 0, left: 0, width: 10, height: 10 };
const at = (line: number, column: number, tagName: string, classes: string, sourceVersion: string) => ({
  key: `${CARD}:${line}:${column}~${P}`, parentKey: null, tagName, classes, sourceLocation: { file: CARD, line, column, sourceVersion }, rect,
});
const DIV_MASTER = 'flex flex-col justify-between';
const DIV_OVERRIDE = 'flex flex-col justify-between gap-y-3';
const TIME_MASTER = 'mt-2 block text-sm leading-5 text-stone-500';

function editedDivAtLine26() {
  const doc = new Y.Doc();
  const { iframe, postMessage } = makeFakeIframe();
  const ctx = makeFakeCtx({ refs: { iframe }, env: { doc } });
  const before = [at(26, 3, 'div', DIV_MASTER, 'v1'), at(27, 5, 'time', TIME_MASTER, 'v1')];
  handleElementsScanned(ctx, { elements: before });
  // An editor-only override on the <div> (what a loop usage, or any edit a prop cannot express, leaves behind).
  applyCommand(doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: before[0].key, classes: DIV_MASTER, sourceLocation: before[0].sourceLocation });
  applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: before[0].key, classes: DIV_OVERRIDE });
  postMessage.mockClear();
  return { doc, ctx, postMessage, divKeyBefore: before[0].key };
}
const paints = (postMessage: ReturnType<typeof vi.fn>) => postMessage.mock.calls
  .map(([m]) => m as { type: string; payload: { key: string; classes: string } }).filter(m => m.type === 'UPDATE_CLASSES').map(m => m.payload);

afterEach(() => { resetClassWriteBaselines(); _resetLocalPageSyncForTests(); });

describe('REPRO: another writer shifts the component file under a coordinate-keyed override', () => {
  it.fails('the override is not painted onto the element that now occupies its old line:col', () => {
    const t = editedDivAtLine26();
    // The agent rewrites BlogCard.astro: <time> moves above the <div>. New bytes (v2), new coordinates.
    const after = [at(26, 3, 'time', TIME_MASTER, 'v2'), at(27, 3, 'div', DIV_MASTER, 'v2')];
    handleElementsScanned(t.ctx, { elements: after });
    // DESIRED: nothing is painted on the <time>. Today it receives the <div>'s classes.
    expect(paints(t.postMessage).filter(p => p.key === t.divKeyBefore)).toEqual([]);
  });

  it.fails('the override follows its element, or is dropped with it — it never stays behind as an orphan', () => {
    const t = editedDivAtLine26();
    // The agent adds two comment lines above the template: every element moves down by two lines.
    const after = [at(28, 3, 'div', DIV_MASTER, 'v2'), at(29, 5, 'time', TIME_MASTER, 'v2')];
    handleElementsScanned(t.ctx, { elements: after });
    const keys = localOverridesForPlacement(t.doc, CARD, P).map(e => e.key);
    // DESIRED: [] (dropped, the file is the truth) or [the div's new key]. Today: the old coordinate, matching no element —
    // it counts for `*`, is persisted to localStorage, and re-attaches to whatever lands on 26:3 next.
    expect(keys).not.toContain(t.divKeyBefore);
  });
});
