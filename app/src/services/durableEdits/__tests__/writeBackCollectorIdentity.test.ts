import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { setLocalPageFile, setLocalExpectedRoute, admitLocalSourceScan, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { collectWriteBackPayloads } from '@/utils/pushOverridesToSource';
import { queueSourceWrites } from '@/utils/pendingSourceWrites';
import { acceptProjectEdit, inspectAcceptedProject } from '../acceptance';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { getDurableProjectState } from '../store';
import { sourceVersion } from '../sourceIdentity';
import { applyCommand } from '@/store/commands';
import { pushInstanceToSource } from '@/store/instanceLifecycle';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = 'src/pages/index.astro';
const hostId = 'el-host';
let projectId: string, doc: Y.Doc, runtime: ReturnType<typeof projectFsRuntime>, release: () => void;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_collector_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  setLocalPageFile(file); setLocalExpectedRoute('/');
});
afterEach(async () => {
  release?.(); await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision).catch(() => {});
  runtime?.close(); doc.destroy(); unmarkFilesTruth(projectId); setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); vi.unstubAllGlobals();
});
function seed(content: string, extra: Record<string, string> = {}) {
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: content, ...extra }, { beforeCommand: () => gate });
  const host = new Y.Map<unknown>([['astroSource', file], ['staticMarkup', content]]);
  doc.getMap('elements').set(hostId, host);
  expect(admitLocalSourceScan(projectId, '/', Object.entries({ [file]: content, ...extra }).map(([file, text]) => ({
    sourceLocation: { file, line: 1, column: 1, sourceVersion: sourceVersion(text) },
  })))).toBe(true);
  return host;
}
function reorder(target = file, tag = 'p') {
  return acceptProjectEdit(doc, { projectId, operationId: crypto.randomUUID(), mutate() {}, commands: [{ kind: 'source-batch', payload: {
    payloads: [{ astroSource: target, overrides: { orderOverrides: [`${tag}-1`, `${tag}-0`] } }], skipped: [],
  } }] });
}
async function collect() {
  const collected = collectWriteBackPayloads(doc, hostId)!;
  await queueSourceWrites(collected.payloads, collected.skipped, { doc });
  return collected;
}

it.each(['classes', 'text', 'attributes', 'delete', 'reorder'] as const)('collector %s target the original selector after an accepted reorder with ACK held', async kind => {
  const original = '<main>\n  <p>A</p>\n  <p>B</p>\n</main>\n'; const host = seed(original);
  await reorder();
  if (kind === 'classes') host.set('classOverrides', new Y.Map([['p-0', new Y.Map([['base', Y.Array.from(['p-4'])]])]]));
  if (kind === 'text') doc.getMap('sourceText').set(`${hostId}:p-0`, new Y.Map([['textContent', 'Edited A']]));
  if (kind === 'attributes') host.set('attributeOverrides', new Y.Map([['p-0', new Y.Map([['title', 'Owned A']])]]));
  if (kind === 'delete') host.set('deletedSelectors', Y.Array.from(['p-0']));
  if (kind === 'reorder') host.set('orderOverrides', Y.Array.from(['p-0', 'p-1']));
  await collect();
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 0 });
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  const expected = kind === 'classes' ? '<main>\n  <p>B</p>\n  <p class="p-4">A</p>\n</main>\n'
    : kind === 'text' ? '<main>\n  <p>B</p>\n  <p>Edited A</p>\n</main>\n'
    : kind === 'attributes' ? '<main>\n  <p>B</p>\n  <p title="Owned A">A</p>\n</main>\n'
    : kind === 'delete' ? '<main>\n  <p>B</p>\n</main>\n' : original;
  expect(runtime.read(file)).toBe(expected);
});

it.each(['image', 'link'] as const)('collector %s attribute retains original sibling identity through reopen before acceptance', async kind => {
  const tag = kind === 'image' ? 'img' : 'a';
  const original = kind === 'image' ? '<main>\n  <img src="a"/>\n  <img src="b"/>\n</main>\n' : '<main>\n  <a href="a">A</a>\n  <a href="b">B</a>\n</main>\n';
  const host = seed(original); await reorder(file, tag);
  runtime.restart(); db.close(); await db.open();
  host.set(kind === 'image' ? 'imageOverrides' : 'linkOverrides', new Y.Map([[`${tag}-0`, new Y.Map([[kind === 'image' ? 'src' : 'href', 'edited-a']])]]));
  await collect(); release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe(kind === 'image' ? '<main>\n  <img src="b"/>\n  <img src="edited-a"/>\n</main>\n' : '<main>\n  <a href="b">B</a>\n  <a href="edited-a">A</a>\n</main>\n');
});

it('routed subcomponent bucket owns its source version instead of the host version', async () => {
  const child = 'src/components/Card.astro', childBefore = '<section>\n  <p>A</p>\n  <p>B</p>\n</section>\n';
  const host = seed('<main><Card /></main>\n', { [child]: childBefore });
  host.set('staticMarkup', '<main><section data-sq-component-src="src/components/Card.astro"><p>A</p><p>B</p></section></main>');
  await reorder(child);
  host.set('classOverrides', new Y.Map([['p-0', new Y.Map([['base', Y.Array.from(['p-4'])]])]]));
  const collected = await collect();
  expect(collected.payloads[0]).toMatchObject({ astroSource: child, selectorSourceVersion: sourceVersion(childBefore), selectorSourceRevision: 0 });
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(child)).toBe('<section>\n  <p>B</p>\n  <p class="p-4">A</p>\n</section>\n');
  expect(runtime.read(file)).toBe('<main><Card /></main>\n');
});

it.each(['reparent', 'drawn'] as const)('collector %s uses the original parent/child selectors after reorder', async kind => {
  const original = '<main>\n  <p>A</p>\n  <p>B</p>\n  <section></section>\n</main>\n'; const host = seed(original);
  await reorder();
  if (kind === 'reparent') host.set('reparentOverrides', Y.Array.from(['p-0>section-0']));
  else {
    host.set('pageId', 'page');
    doc.getMap('pages').set('page', new Y.Map([['rootElementIds', Y.Array.from([hostId])]]));
    applyCommand(doc, { type: 'ADD_DRAWN_ELEMENT', element: { key: 'drawn-owned', pageId: 'page', tag: 'span', classes: '', textContent: 'New', parentKey: `${hostId}:p-0`, insertIndex: 0 } });
  }
  await collect(); release(); await flushDurableSourceWritesThrough(projectId, 2);
  const html = new DOMParser().parseFromString(runtime.read(file), 'text/html');
  expect(html.querySelector('main > p')?.textContent).toBe('B');
  if (kind === 'reparent') expect(html.querySelector('section > p')?.textContent).toBe('A');
  else {
    const inserted = html.querySelector('[data-sq-drawn="drawn-owned"]');
    expect(inserted?.textContent).toBe('New');
    expect(inserted?.parentElement?.textContent?.replace(/\s/g, '')).toBe('ANew');
  }
});

it.each(['before', 'after'] as const)('collector captures the source identity %s a fresh authenticated scan, not at dispatch', async when => {
  const original = '<main>\n  <p>A</p>\n  <p>B</p>\n</main>\n'; const host = seed(original); await reorder();
  host.set('classOverrides', new Y.Map([['p-0', new Y.Map([['base', Y.Array.from(['p-4'])]])]]));
  const captured = when === 'before' ? collectWriteBackPayloads(doc, hostId)! : undefined;
  release(); await flushDurableSourceWritesThrough(projectId, 1);
  const current = '<main>\n  <p>B</p>\n  <p>A</p>\n</main>\n';
  expect(admitLocalSourceScan(projectId, '/', [{ sourceLocation: { file, line: 2, column: 3, sourceVersion: sourceVersion(current) } }])).toBe(true);
  const collected = captured ?? collectWriteBackPayloads(doc, hostId)!;
  await queueSourceWrites(collected.payloads, collected.skipped, { doc });
  await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe(when === 'before' ? '<main>\n  <p>B</p>\n  <p class="p-4">A</p>\n</main>\n'
    : '<main>\n  <p class="p-4">B</p>\n  <p>A</p>\n</main>\n');
});

it('refuses a collector source fingerprint mismatch before publishing its first revision', async () => {
  const original = '<main>\n  <p>A</p>\n  <p>B</p>\n</main>\n'; const host = seed(original);
  host.set('classOverrides', new Y.Map([['p-0', new Y.Map([['base', Y.Array.from(['p-4'])]])]]));
  const external = '<main>\n  <p>External</p>\n  <p>A</p>\n  <p>B</p>\n</main>\n';
  writeFileSync(join(runtime.root, file), external);
  await expect(collect()).rejects.toThrow(/version.*baseline/);
  expect(await db.durableEdits.count()).toBe(0);
  expect(runtime.read(file)).toBe(external);
});

it('instance Push freezes per-source scan ownership before its staged collector waits in acceptance', async () => {
  const original = '<main>\n  <p>A</p>\n  <p>B</p>\n</main>\n'; const host = seed(original);
  await reorder(); release(); await flushDurableSourceWritesThrough(projectId, 1);
  host.set('classOverrides', new Y.Map([['p-0', new Y.Map([['base', Y.Array.from(['p-4'])]])]]));
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const inspecting = inspectAcceptedProject(projectId, () => gate);
  const pushing = pushInstanceToSource({ doc, instanceId: hostId, astroSource: file, currentPageId: null,
    takeSnapshot() {}, dispatch: action => applyCommand(doc, action) });
  const current = '<main>\n  <p>B</p>\n  <p>A</p>\n</main>\n';
  expect(admitLocalSourceScan(projectId, '/', [{ sourceLocation: { file, line: 2, column: 3, sourceVersion: sourceVersion(current) } }])).toBe(true);
  resume(); await inspecting;
  expect(await pushing).toMatchObject({ ok: true });
  await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe('<main>\n  <p>B</p>\n  <p class="p-4">A</p>\n</main>\n');
});
