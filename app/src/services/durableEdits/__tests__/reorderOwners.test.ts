import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { applyCommand } from '@/store/commands';
import { dispatchDurableAction } from '@/store/durableDispatch';
import { handleDragElementDrop } from '@/components/Canvas/viewportMessages/dragAndDrop';
import { makeFakeCtx, makeFakeIframe } from '@/components/Canvas/viewportMessages/__tests__/fakeContext';
import * as store from '../store';
import { awaitAccepted } from '../acceptance';
import { acceptEditorCommands } from '@/store/commandGesture';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { flushDurableSourceWrites } from '../sourceMaterialization';

let doc: Y.Doc;
beforeEach(async () => {
  await db.delete(); await db.open();
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', `reorder-${crypto.randomUUID()}`);
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page', name: 'Page', rootElementIds: [], children: [] } });
  for (const key of ['drawn-a', 'drawn-b', 'drawn-parent']) applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT',
    element: { key, pageId: 'page', tag: 'div', classes: 'grid', textContent: '', parentKey: null, insertIndex: 0 } });
});
afterEach(async () => { await awaitAccepted(doc.getMap('meta').get('projectId') as string).catch(() => {}); doc.destroy(); vi.restoreAllMocks(); });

it('cannot reject accepted reorder truth when its inverse observer throws', async () => {
  const projectId = doc.getMap('meta').get('projectId') as string;
  const runtime = projectFsRuntime(projectId, { 'src/components/Host.astro': '<div>A</div>\n<div>B</div>\n' });
  try {
  await expect(acceptEditorCommands(doc, [{ type: 'REORDER_PAGE_ELEMENTS', pageId: 'page', elementIds: ['drawn-a', 'drawn-parent', 'drawn-b'] }], {
    stage() {}, commit() {}, attachFiles() { throw new Error('snapshot observer'); },
  }, [{ kind: 'source-batch', payload: { payloads: [{ astroSource: 'Host.astro', overrides: { orderOverrides: ['div-1', 'div-0'] } }], skipped: [] } }])).resolves.toMatchObject({ revision: 1 });
  expect((doc.getMap('pages').get('page') as Y.Map<unknown>).get('rootElementIds')).toBeDefined();
  expect(await db.durableEdits.count()).toBe(1);
  await flushDurableSourceWrites(projectId);
  expect(runtime.read('src/components/Host.astro')).toBe('<div>B</div>\n<div>A</div>\n');
  } finally { runtime.close(); }
});

it('keeps canvas reparent DOM and live document unchanged on rejected storage', async () => {
  const { iframe, postMessage } = makeFakeIframe();
  const baseline = doc.toJSON();
  const ctx = makeFakeCtx({ env: { doc }, refs: { iframe, currentPageId: { current: 'page' }, scannedElements: { current: [
    { key: 'drawn-a', parentKey: null }, { key: 'drawn-parent', parentKey: null },
  ] as never } }, actions: { dispatch: action => {
    const promise = dispatchDurableAction(doc, action); void promise.catch(() => {}); return promise;
  } } });
  vi.spyOn(store, 'acceptStoredEdit').mockRejectedValue(new Error('reorder quota'));
  await handleDragElementDrop(ctx, { key: 'drawn-a', reparented: true, newParentKey: 'drawn-parent', insertIndex: 0 });
  expect(postMessage).not.toHaveBeenCalled();
  expect(doc.toJSON()).toEqual(baseline);
  expect(await db.durableEdits.count()).toBe(0);
});

it('accepts both members of a canvas grid swap in one revision', async () => {
  const ctx = makeFakeCtx({ env: { doc }, refs: { currentPageId: { current: 'page' },
    scannedElements: { current: [{ key: 'drawn-a', parentKey: 'drawn-parent' }, { key: 'drawn-b', parentKey: 'drawn-parent' }] as never },
    gridGeometry: { current: { columns: [0, 100], rows: [0], cells: [
      { key: 'drawn-a', col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      { key: 'drawn-b', col: 1, row: 0, colSpan: 1, rowSpan: 1 },
    ] } as never }, highlightedGridCell: { current: { col: 1, row: 0 } },
  }, actions: { dispatch: action => dispatchDurableAction(doc, action) } });
  await handleDragElementDrop(ctx, { key: 'drawn-a', insertIndex: 1 });
  const rows = await db.durableEdits.toArray();
  expect(rows).toHaveLength(1);
  const entries = doc.getMap<Y.Map<unknown>>('sourceClasses');
  expect(entries.get('drawn-a')?.get('classes')).toContain('col-start-2');
  expect(entries.get('drawn-b')?.get('classes')).toContain('col-start-1');
});
