// Durable contract (7932857b): the drawn reconcile rides an accepted
// `source-batch` command (≙ the former POST /__sq/write-back-component body)
// materialized in the browser against the project disk (projectFsRuntime).
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { PartialSourceMaterialization } from '@/services/durableEdits/sourceMaterialization';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { pushOverridesToSource, type SourceWritePayload } from '../pushOverridesToSource';
import { applyCommand } from '@/store/commands';
import { selectPageDrawnElements } from '@/store/selectors';
import { emptyClassData } from '@/store/types';

const COMP = 'library/Comp.astro';

function seedEditorEl(doc: Y.Doc, id: string, pageId: string, staticMarkup: string) {
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: pageId, name: 'P', rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_ELEMENT', element: {
    id, pageId, parentId: null, index: 0, type: 'component',
    astroSource: COMP, staticMarkup, classes: emptyClassData(),
  }});
  const yEl = doc.getMap('elements').get(id) as Y.Map<unknown>;
  yEl.set('staticMarkup', staticMarkup);
}

const COMP_FILE = `src/components/${COMP}`;
const COMP_SOURCE = '<section>\n  <h1>Hi</h1>\n</section>\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_drawn_nest_${crypto.randomUUID()}`;
  setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { [COMP_FILE]: COMP_SOURCE });
});
afterEach(() => { runtime.close(); setActiveSaveProjectId(null); vi.unstubAllGlobals(); });

function projectDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  return doc;
}

/** Every accepted write-back payload (≙ the former POST bodies). */
async function writeBacks(): Promise<SourceWritePayload[]> {
  const rows = (await db.durableEdits.where('projectId').equals(projectId).toArray()).sort((a, b) => a.revision - b.revision);
  return rows.flatMap(row => row.commands).flatMap(command => command.kind === 'source-batch' ? command.payload.payloads : []);
}

describe('pushOverridesToSource — drawn reconcile (task-078, live-in-Yjs mirror)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  function seedTwoDraws(doc: Y.Doc) {
    seedEditorEl(doc, 'el-x', 'p', `<section data-key="el-x:section-0"><h1 data-key="el-x:h1-0">Hi</h1></section>`);
    // Top-level draw: no parent.
    applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: {
      key: 'drawn-top', pageId: 'p', parentKey: null, insertIndex: 0, tag: 'div', classes: 'top-box',
    }});
    // Section-nested draw: parent is a source child of the editor element.
    applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: {
      key: 'drawn-nested', pageId: 'p', parentKey: 'el-x:section-0', insertIndex: 0, tag: 'div', classes: 'nested-box',
    }});
  }

  it('posts the FULL drawn set as drawnReconcile (top-level + routed nested), marked, and KEEPS both live in Yjs', async () => {
    const doc = projectDoc();
    seedTwoDraws(doc);

    await pushOverridesToSource(doc, 'el-x');

    const payloads = await writeBacks();
    expect(payloads).toHaveLength(1);
    const body = payloads[0];
    expect(body.astroSource).toBe(COMP);

    const reconcile = body.overrides.drawnReconcile as Array<{ markup: string; parentSelector?: string }>;
    expect(reconcile).toHaveLength(2);
    // Top-level: no parentSelector, markup carries the top-level box + marker.
    const topLevel = reconcile.find((i) => !i.parentSelector);
    expect(topLevel).toBeDefined();
    expect(topLevel!.markup).toContain('top-box');
    expect(topLevel!.markup).toContain('data-sq-drawn="drawn-top"');
    // Section-nested: routed to the section-0 sub-selector.
    const nested = reconcile.find((i) => i.parentSelector === 'section-0');
    expect(nested).toBeDefined();
    expect(nested!.markup).toContain('nested-box');
    expect(nested!.markup).toContain('data-sq-drawn="drawn-nested"');

    // Both boxes reached the source, marked.
    const written = runtime.read(COMP_FILE);
    expect(written).toContain('data-sq-drawn="drawn-top"');
    expect(written).toContain('data-sq-drawn="drawn-nested"');

    // Source is a mirror — drawn stay LIVE in Yjs (no removal).
    expect(selectPageDrawnElements(doc, 'p')).toHaveLength(2);
  });

  it('a drawn flush (reconcileDrawn) sends a present empty reconcile with NO drawn, so a delete-to-zero strips source', async () => {
    const doc = projectDoc();
    seedEditorEl(doc, 'el-x', 'p', `<section data-key="el-x:section-0"><h1 data-key="el-x:h1-0">Hi</h1></section>`);

    await pushOverridesToSource(doc, 'el-x', { reconcileDrawn: true });

    const payloads = await writeBacks();
    expect(payloads).toHaveLength(1);
    const body = payloads[0];
    // Present array (the strip-all instruction), even though it is empty.
    expect(body.overrides.drawnReconcile).toEqual([]);
  });

  it('an ordinary leave-flush with NO drawn stays a clean no-op (no reconcile, no POST)', async () => {
    const doc = projectDoc();
    seedEditorEl(doc, 'el-x', 'p', `<section data-key="el-x:section-0"><h1 data-key="el-x:h1-0">Hi</h1></section>`);

    await pushOverridesToSource(doc, 'el-x');

    expect(await writeBacks()).toHaveLength(0);
    expect(await db.durableEdits.count()).toBe(0);
    expect(runtime.read(COMP_FILE)).toBe(COMP_SOURCE);
  });

  it('the eager drawn-only flush mode is GONE — drawn reconcile always rides the full flush (task-078 blink fix)', async () => {
    // Regression: the old `drawnOnly` mode mirrored ONLY the drawn region every
    // 400ms structural tick, withholding class/text. That eager .astro write
    // full-reloaded the preview iframe — a visible "blink". The mode was
    // removed; drawn now defer to the leave flush like every other override.
    // Passing the legacy flag (`as any`) must have NO effect: the class override
    // travels WITH the drawn reconcile, not withheld. Fails against the old
    // `if (!opts?.drawnOnly)` guard (which dropped classOverrides to {}).
    const doc = projectDoc();
    seedTwoDraws(doc);
    const yEl = doc.getMap('elements').get('el-x') as Y.Map<unknown>;
    const classOv = new Y.Map<Y.Map<Y.Array<string>>>();
    const selMap = new Y.Map<Y.Array<string>>();
    selMap.set('xs', Y.Array.from(['text-red-500']));
    classOv.set('h1-0', selMap);
    yEl.set('classOverrides', classOv);

    // `as any`: drawnOnly no longer exists on the type — assert it is inert even
    // if a caller passes it, so the eager-blink path cannot be re-triggered.
    await pushOverridesToSource(doc, 'el-x', { reconcileDrawn: true, drawnOnly: true } as { reconcileDrawn?: boolean });

    const payloads = await writeBacks();
    expect(payloads).toHaveLength(1);
    const body = payloads[0];
    // Drawn reconcile present (both roots)…
    expect(body.overrides.drawnReconcile).toHaveLength(2);
    // …AND the class override travels with it — never isolated/withheld.
    expect(body.overrides.classOverrides).toEqual({ 'h1-0': 'text-red-500' });
  });

  // Since 7932857b a partly-landed write is retained and surfaces as a
  // PartialSourceMaterialization rejection (its `skipped` is the channel).
  it('drawn stay live in Yjs even when the write-back reports a selector skipped, and the skip surfaces in the channel', async () => {
    const doc = projectDoc();
    seedTwoDraws(doc);
    // The source has no <section> → the transform cannot resolve section-0.
    runtime.close();
    runtime = projectFsRuntime(projectId, { [COMP_FILE]: '<div>\n  <h1>Hi</h1>\n</div>\n' });

    const error = await pushOverridesToSource(doc, 'el-x').then(() => null, e => e);

    // Nothing is ever removed from Yjs — both remain visible.
    const remaining = selectPageDrawnElements(doc, 'p').map((d) => d.key);
    expect(remaining).toContain('drawn-nested');
    expect(remaining).toContain('drawn-top');
    // And the skip surfaces in the skipped channel (category 'drawn').
    expect(error).toBeInstanceOf(PartialSourceMaterialization);
    expect((error as PartialSourceMaterialization).skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: COMP, category: 'drawn', selector: 'section-0' }),
    ]));
  });
});
