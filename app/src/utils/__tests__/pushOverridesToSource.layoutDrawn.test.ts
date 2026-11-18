import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { collectWriteBackPayloads, pushOverridesToSource } from '../pushOverridesToSource';
import { syncDrawnIntoMasterOverlay } from '../bakeEditorMaster';
import { applyCommand } from '@/store/commands';
import { selectMasterMarkup } from '@/store/masters';
import { emptyClassData } from '@/store/types';

/**
 * Layout-master drawn bake (2026-08-26, proven defect): a box drawn in the
 * layout master editor got parentKey `<editorId>:slot-0` (the rendered
 * <slot>), the bake routed it as a NESTED insert with parentSelector
 * 'slot-0', and the server skipped it (mapKeyToPosition cannot resolve slot
 * tags) — the layout .astro never received the element and no page ever saw
 * it. A <slot> is a placeholder, not a container: such drawn roots must bake
 * TOP-LEVEL (sibling of the slot).
 */

const LAYOUT_SRC = 'layouts/Layout.astro';

function seedLayoutEditor(doc: Y.Doc, id: string, pageId: string) {
  const staticMarkup = `<slot class="bg-white" data-key="${id}:slot-0"></slot>`;
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: pageId, name: 'P', rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_ELEMENT', element: {
    id, pageId, parentId: null, index: 0, type: 'component',
    astroSource: LAYOUT_SRC, staticMarkup, classes: emptyClassData(),
  }});
  (doc.getMap('elements').get(id) as Y.Map<unknown>).set('staticMarkup', staticMarkup);
}

function addDrawn(doc: Y.Doc, key: string, parentKey: string | null) {
  applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: {
    key, pageId: 'p', parentKey, insertIndex: 0, tag: 'div',
    classes: 'fixed top-3 left-3 w-24 h-24 bg-red-500',
  }});
}

describe('layout-master drawn bake — slot parents route as top-level chrome', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('a drawn root parented on the rendered <slot> bakes with NO parentSelector', () => {
    const doc = new Y.Doc();
    seedLayoutEditor(doc, 'el-x', 'p');
    addDrawn(doc, 'drawn-1', 'el-x:slot-0');

    const collected = collectWriteBackPayloads(doc, 'el-x', { reconcileDrawn: true })!;
    const payload = collected.payloads.find((p) => p.astroSource === LAYOUT_SRC)!;
    const reconcile = payload.overrides.drawnReconcile as Array<{ markup: string; parentSelector?: string }>;
    expect(reconcile).toHaveLength(1);
    expect(reconcile[0].parentSelector).toBeUndefined();
    expect(reconcile[0].markup).toContain('fixed top-3 left-3');
    expect(reconcile[0].markup).toContain('data-sq-drawn="drawn-1"');
    // The same markup is surfaced for the masters-overlay mirror.
    expect(collected.drawnMarkups).toHaveLength(1);
    expect(collected.drawnMarkups[0]).toContain('data-sq-drawn="drawn-1"');
  });

  // Durable contract (7932857b): the reconcile is an accepted source-batch
  // command materialized against the project disk — needs a projectId,
  // IndexedDB and the layout file on disk.
  it('pushOverridesToSource surfaces the baked drawn markups after a changed reconcile', async () => {
    vi.stubGlobal('crypto', webcrypto);
    await db.delete(); await db.open();
    const projectId = `browser_layout_drawn_${crypto.randomUUID()}`;
    setActiveSaveProjectId(projectId);
    const runtime = projectFsRuntime(projectId, { 'src/layouts/Layout.astro': '<body>\n  <slot />\n</body>\n' });
    try {
      const doc = new Y.Doc();
      doc.getMap('meta').set('projectId', projectId);
      seedLayoutEditor(doc, 'el-x', 'p');
      addDrawn(doc, 'drawn-1', null);

      const result = await pushOverridesToSource(doc, 'el-x', { reconcileDrawn: true });
      expect(result?.drawnMarkups?.[0]).toContain('data-sq-drawn="drawn-1"');
      expect(result?.appliedTotal).toBeGreaterThan(0);
      expect(runtime.read('src/layouts/Layout.astro')).toContain('data-sq-drawn="drawn-1"');
    } finally {
      runtime.close(); setActiveSaveProjectId(null); vi.unstubAllGlobals();
    }
  });
});

describe('stale-session parentKeys still bake (2026-08-26 round-2)', () => {
  // Every master reopen seeds a NEW editor element id, but a drawn element
  // keeps the parentKey of the session it was drawn in (`el-OLD:slot-0`).
  // The partition (top-level vs section-nested) matched NEITHER for a stale
  // prefix, so the element silently vanished from the bake — and the
  // synchronous overlay mirror would then STRIP it from every page.
  // Unresolvable parents route top-level, matching their render fallback.
  it('a drawn root with a previous session\'s slot parentKey bakes top-level', () => {
    const doc = new Y.Doc();
    seedLayoutEditor(doc, 'el-x', 'p');
    addDrawn(doc, 'drawn-1', 'el-OLDSESSION:slot-0');

    const collected = collectWriteBackPayloads(doc, 'el-x', { reconcileDrawn: true })!;
    expect(collected.drawnMarkups).toHaveLength(1);
    expect(collected.drawnMarkups[0]).toContain('data-sq-drawn="drawn-1"');
    const payload = collected.payloads.find((p) => p.astroSource === LAYOUT_SRC)!;
    const reconcile = payload.overrides.drawnReconcile as Array<{ markup: string; parentSelector?: string }>;
    expect(reconcile).toHaveLength(1);
    expect(reconcile[0].parentSelector).toBeUndefined();
  });

  it('a drawn CHILD of another drawn element still rides its root, not the top level', () => {
    const doc = new Y.Doc();
    seedLayoutEditor(doc, 'el-x', 'p');
    addDrawn(doc, 'drawn-root', null);
    addDrawn(doc, 'drawn-kid', 'drawn-root');

    const collected = collectWriteBackPayloads(doc, 'el-x', { reconcileDrawn: true })!;
    // One root markup, containing the kid via recursion.
    expect(collected.drawnMarkups).toHaveLength(1);
    expect(collected.drawnMarkups[0]).toContain('data-sq-drawn="drawn-root"');
  });
});

describe('syncDrawnIntoMasterOverlay — 3-store mirror', () => {
  it('appends the marked drawn markup to the overlay, and an empty set strips it back out', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: LAYOUT_SRC, markup: '<slot class="bg-white"></slot>\n' });

    const markup = '<div class="fixed top-3 left-3" data-sq-drawn="drawn-1"></div>';
    expect(syncDrawnIntoMasterOverlay(doc, LAYOUT_SRC, [markup])).toBe(true);
    const withDrawn = selectMasterMarkup(doc, LAYOUT_SRC)!;
    expect(withDrawn).toContain('data-sq-drawn="drawn-1"');
    // The drawn element is a SIBLING of the slot, never inside it.
    expect(withDrawn.indexOf('</slot>')).toBeLessThan(withDrawn.indexOf('data-sq-drawn'));

    // Idempotent re-sync: no duplicate copies.
    syncDrawnIntoMasterOverlay(doc, LAYOUT_SRC, [markup]);
    expect(selectMasterMarkup(doc, LAYOUT_SRC)!.match(/data-sq-drawn/g)).toHaveLength(1);

    // Delete-to-zero removes the stale copy (C3).
    expect(syncDrawnIntoMasterOverlay(doc, LAYOUT_SRC, [])).toBe(true);
    expect(selectMasterMarkup(doc, LAYOUT_SRC)).not.toContain('data-sq-drawn');
  });

  it('no-ops when the overlay has no entry for the source', () => {
    const doc = new Y.Doc();
    expect(syncDrawnIntoMasterOverlay(doc, LAYOUT_SRC, ['<div data-sq-drawn="k"></div>'])).toBe(false);
    expect(selectMasterMarkup(doc, LAYOUT_SRC)).toBeUndefined();
  });
});

describe('leave-flush order — the drawn mirror must not wait for the FS ack (2026-08-26)', () => {
  // Runtime-proven reload loss: opening the master seeds the editor with
  // stripDrawnElements(source) and SET_MASTER_MARKUP — the overlay loses the
  // baked drawn chrome for the whole session (the editor renders drawn LIVE
  // from the doc instead). The leave-flush used to restore it only AFTER the
  // .astro write acknowledged; on pagehide nothing after an `await` survives,
  // so a reload-from-master left the overlay stripped and the master-drawn
  // chrome vanished from every page. The mirror must be derivable and applied
  // SYNCHRONOUSLY from the doc alone.
  it('bake + synchronous mirror restores the drawn chrome with zero network', async () => {
    const doc = new Y.Doc();
    seedLayoutEditor(doc, 'el-x', 'p');
    addDrawn(doc, 'drawn-1', null);
    // Prior leave left overlay = chrome + drawn…
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: LAYOUT_SRC, markup:
      '<slot class="bg-white"></slot>\n<div class="fixed top-3 left-3" data-sq-drawn="drawn-1"></div>\n' });
    // …then the master REOPEN seeds a stripped markup over it (LeftSidebar
    // handleSelectComponent → stripDrawnElements → seed SET_MASTER_MARKUP).
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: LAYOUT_SRC, markup:
      '<slot class="bg-white"></slot>\n' });

    // fetch that NEVER resolves — the pagehide reality.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    const { bakeEditorMaster } = await import('../bakeEditorMaster');
    bakeEditorMaster(doc, 'el-x');
    // Failing-first anchor: bake alone cannot restore the drawn — the overlay
    // it bakes from is the stripped one.
    expect(selectMasterMarkup(doc, LAYOUT_SRC)!).not.toContain('data-sq-drawn');

    // The fixed flush order: collect (sync) + mirror (sync), THEN the write.
    const collected = collectWriteBackPayloads(doc, 'el-x', { reconcileDrawn: true })!;
    syncDrawnIntoMasterOverlay(doc, collected.astroSource, collected.drawnMarkups);
    expect(selectMasterMarkup(doc, LAYOUT_SRC)!).toContain('data-sq-drawn="drawn-1"');
  });
});
