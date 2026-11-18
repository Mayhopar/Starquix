import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { applyCommand } from '@/store/commands';
import { resetInstanceToOriginal, makeComponentFromDrawn, createComponentFromMarkup } from '@/store/instanceLifecycle';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import * as store from '../store';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Toaster } from 'react-hot-toast';

let doc: Y.Doc;
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {} }));
  await db.delete(); await db.open(); doc = new Y.Doc();
  const projectId = `browser_instance_${crypto.randomUUID()}`; doc.getMap('meta').set('projectId', projectId);
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page', name: 'Page', children: [], rootElementIds: [] } });
  applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: { key: 'drawn-a', pageId: 'page', parentKey: null, insertIndex: 0,
    tag: 'div', textContent: 'Card', classes: 'p-4' } });
  runtime = projectFsRuntime(projectId, { 'src/pages/index.astro': '<main />' });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).includes('component-html')
    ? new Response('<section>Card</section>') : new Response(JSON.stringify({ path: 'Card.astro' })));
});
afterEach(() => { cleanup(); doc.destroy(); runtime.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['reset', 'drawn', 'markup'] as const)('rejects %s lifecycle storage before source or document changes', async kind => {
  const baseline = Y.encodeStateAsUpdate(doc);
  vi.spyOn(store, 'acceptStoredEdit').mockRejectedValue(new Error('instance quota'));
  const args = { doc, currentPageId: 'page', takeSnapshot: vi.fn(), existingNames: [] };
  const result = kind === 'reset' ? await resetInstanceToOriginal({ ...args, instanceId: 'drawn-a', isBlogSlot: false,
    builtIn: [], dispatch: action => applyCommand(doc, action) })
    : kind === 'drawn' ? await makeComponentFromDrawn({ ...args, key: 'drawn-a' })
    : await createComponentFromMarkup({ ...args, name: 'Card', staticMarkup: '<section>Card</section>', replaceElementId: 'drawn-a' });
  expect(result).toMatchObject({ ok: false, reason: 'instance quota' });
  expect(Y.encodeStateAsUpdate(doc)).toEqual(baseline);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(runtime.journal.since(0).entries).toEqual([]);
  expect(await db.durableEdits.count()).toBe(0);
});

it('refuses a conflicting component file before accepting a partial replacement', async () => {
  mkdirSync(join(runtime.root, 'src/components/library'), { recursive: true });
  writeFileSync(join(runtime.root, 'src/components/library/Card.astro'), '<main>Existing</main>');
  const baseline = Y.encodeStateAsUpdate(doc);
  const result = await createComponentFromMarkup({ doc, currentPageId: 'page', name: 'Card', existingNames: [],
    staticMarkup: '<section>Replacement</section>', replaceElementId: 'drawn-a', takeSnapshot: () => {} });
  expect(result.ok).toBe(false);
  expect(Y.encodeStateAsUpdate(doc)).toEqual(baseline);
  expect(await db.durableEdits.count()).toBe(0);
  expect(runtime.read('src/components/library/Card.astro')).toBe('<main>Existing</main>');
});

it.each(['drawn', 'markup'] as const)('%s component keeps its project bytes and placement through lost ACK and restart', async kind => {
  const projectId = doc.getMap('meta').get('projectId') as string;
  const baseline = Y.encodeStateAsUpdate(doc);
  runtime.close(); let acknowledgements = 0;
  runtime = projectFsRuntime(projectId, { 'src/pages/index.astro': '<main />' }, { loseAcknowledgement: () => ++acknowledgements === 1 });
  const args = { doc, currentPageId: 'page', takeSnapshot: () => {}, existingNames: [] };
  const result = kind === 'drawn' ? await makeComponentFromDrawn({ ...args, key: 'drawn-a' })
    : await createComponentFromMarkup({ ...args, name: 'Card', staticMarkup: '<section>Card</section>', replaceElementId: 'drawn-a' });
  expect(result.ok).toBe(true);
  const file = `src/components/library/${result.componentName}.astro`;
  await flushDurableSourceWritesThrough(projectId, 1);
  const source = runtime.read(file);
  expect(source).toContain(kind === 'drawn' ? '<section class="p-4">Card</section>' : '<section>Card</section>');
  expect(doc.getMap('elements').has('drawn-a')).toBe(false);
  const [edit] = await db.durableEdits.toArray();
  expect(ArrayBuffer.isView(edit.yjsUpdate)).toBe(true);
  const restarted = new Y.Doc(); Y.applyUpdate(restarted, baseline); Y.applyUpdate(restarted, edit.yjsUpdate!); Y.applyUpdate(restarted, edit.yjsUpdate!);
  runtime.restart(); db.close(); await db.open();
  await flushDurableSourceWritesThrough(projectId, edit.revision);
  expect(runtime.read(file)).toBe(source);
  expect(restarted.getMap('elements').has(result.instanceId!)).toBe(true);
  expect(restarted.getMap('elements').size).toBe(1);
  expect(acknowledgements).toBe(1);
  expect(await db.durableEdits.count()).toBe(1); restarted.destroy();
});

it.each(['drawn', 'markup'] as const)('%s component returns its accepted placement while source ACK is blocked', async kind => {
  const projectId = doc.getMap('meta').get('projectId') as string;
  runtime.close(); let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const dispatch = new Promise<void>(resolve => { started = resolve; });
  runtime = projectFsRuntime(projectId, { 'src/pages/index.astro': '<main />' }, { beforeCommand: async () => { started(); await gate; } });
  const args = { doc, currentPageId: 'page', takeSnapshot() {}, existingNames: [] };
  const making = kind === 'drawn' ? makeComponentFromDrawn({ ...args, key: 'drawn-a' })
    : createComponentFromMarkup({ ...args, name: 'Card', staticMarkup: '<section>Card</section>', replaceElementId: 'drawn-a' });
  try {
    expect(await Promise.race([making.then(() => 'accepted'), dispatch.then(() => 'waiting')])).toBe('accepted');
    expect(doc.getMap('elements').has((await making).instanceId!)).toBe(true);
  } finally { release(); await making; await flushDurableSourceWritesThrough(projectId, 1); }
});

it('returns accepted component placement rather than rejection on a post-commit source conflict', async () => {
  render(createElement(Toaster));
  const save = store.acceptStoredEdit;
  vi.spyOn(store, 'acceptStoredEdit').mockImplementationOnce(async input => {
    const accepted = await save(input);
    mkdirSync(join(runtime.root, 'src/components/library'), { recursive: true });
    writeFileSync(join(runtime.root, 'src/components/library/Card.astro'), '<section>External</section>');
    return accepted;
  });
  const result = await act(() => createComponentFromMarkup({ doc, currentPageId: 'page', name: 'Card', existingNames: [],
    staticMarkup: '<section>Card</section>', replaceElementId: 'drawn-a', takeSnapshot: () => {} }));
  expect(result.ok).toBe(true);
  expect(doc.getMap('elements').has(result.instanceId!)).toBe(true);
  expect(runtime.read('src/components/library/Card.astro')).toBe('<section>External</section>');
  expect(await db.durableEdits.count()).toBe(1);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});
