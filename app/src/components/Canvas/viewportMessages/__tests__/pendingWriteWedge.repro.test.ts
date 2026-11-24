/**
 * REPRO (investigation 2026-11-23, docs/plans/instance-override-architecture.md):
 * a LATENT second "ghost" mechanism — a class value that keeps repainting
 * although no file and no store entry holds it. Not the ghost observed in the
 * user's session (that one was an editor-only entry, journal rev 1365; see
 * bridge/parts/__tests__/loopGhostRepaint.repro.test.ts).
 *
 * Every class write the journal materializes is published as "the file now
 * renders this" (durableEdits/sourceMaterialization.ts publishClass →
 * notifyFileWritten → ClassStoreContext → stampFileValueForLine), which arms a
 * frame-liveness guard for that `file:line:col` (classWriteBaseline
 * notePendingWrite). While armed, a scan of an element at that coordinate that
 * does not render EXACTLY the published string is judged 'stale': the scan is
 * not believed and the published value is painted over the element
 * (viewportMessages/scanning.ts → paintPendingValue → UPDATE_CLASSES, which the
 * bridge broadcasts to every copy of the placement). The guard has no expiry
 * and no source-version check: it is disarmed only by a scan that renders the
 * exact string (or by one legacy failure path, useClassPersistenceQueue).
 * So when another writer moves the file on before a scan saw the value — the AI
 * agent's write_file / edit_file, which the MCP layer runs right after flushing
 * the journal — the guard never disarms.
 *
 * `it.fails` = the assertion states the DESIRED behaviour and fails today.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { handleElementsScanned } from '../scanning';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { resetClassWriteBaselines, getObservedFileValue, notifyFileWritten, setFileWrittenListener } from '@/services/classWriteBaseline';
import { stampFileValueForLine } from '@/store/sourceOverrideEntries';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';

const CARD = 'src/components/BlogCard.astro';
const PLACEMENT = 's73bb06627ed37e6c';
const LOC = { file: CARD, line: 26, column: 3 };
const key = (copy: number) => `${CARD}:26:3~${PLACEMENT}${copy ? `#${copy}` : ''}`;
const WRITTEN = 'justify-start items-stretch col-span-2 gap-y-3 grid lg:col-span-3';
const rect = { top: 0, left: 0, width: 10, height: 10 };
const copies = (classes: string) => [0, 1, 2, 3].map(n => ({ key: key(n), parentKey: null, tagName: 'div', classes, sourceLocation: LOC, rect }));

function editor() {
  const doc = new Y.Doc();
  const { iframe, postMessage } = makeFakeIframe();
  const ctx = makeFakeCtx({ refs: { iframe }, env: { doc } });
  // Exactly what ClassStoreContext installs (ClassStoreContext.tsx:158-163).
  setFileWrittenListener((writtenKey, classes) => stampFileValueForLine(doc, 'sourceClasses', writtenKey, classes));
  const ghostPaints = () => postMessage.mock.calls.map(([m]) => m as { type: string; payload: { key: string; classes: string } })
    .filter(m => m.type === 'UPDATE_CLASSES' && m.payload.classes === WRITTEN).map(m => m.payload.key);
  return { ctx, ghostPaints };
}

afterEach(() => { setFileWrittenListener(null); resetClassWriteBaselines(); _resetLocalPageSyncForTests(); });

describe('REPRO: a published class write that no scan ever renders is repainted forever (ghost class)', () => {
  it.fails('the agent rewrites the file right after a hand edit materialized: the agent\'s value is not painted over', () => {
    const t = editor();
    // The user's master edit materializes (publishClass)…
    notifyFileWritten(`${CARD}:26:3`, WRITTEN);
    // …and the agent's write_file replaces the element's classes before any scan rendered it.
    const AGENT = 'contents';
    for (let i = 0; i < 3; i++) handleElementsScanned(t.ctx, { elements: copies(AGENT) });
    expect(t.ghostPaints()).toEqual([]);                          // today: 12 paints (4 copies × 3 scans), and it never stops
    expect(getObservedFileValue('classes', key(0))).toBe(AGENT);  // today: the scan is never believed for this line again
  });

  it.fails('a write published for a coordinate does not paint a DIFFERENT element that now sits there', () => {
    const t = editor();
    notifyFileWritten(`${CARD}:26:3`, WRITTEN);
    // A line was added above (frontmatter prop plumbing, an agent comment): the <h2> now sits at 26:3,
    // the written <div> at 27:3 — rendering the written value, but under another coordinate.
    const h2 = { key: key(0), parentKey: null, tagName: 'h2', classes: 'm-0 text-2xl', sourceLocation: LOC, rect };
    const div = { key: `${CARD}:27:3~${PLACEMENT}`, parentKey: null, tagName: 'div', classes: WRITTEN, sourceLocation: { ...LOC, line: 27 }, rect };
    handleElementsScanned(t.ctx, { elements: [h2, div] });
    expect(t.ghostPaints()).toEqual([]); // today: [the <h2>'s key] — it is painted with the <div>'s classes
  });
});
