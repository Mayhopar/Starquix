import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalExpectedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { moveLocalElement, _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { handleEditModeExited, handleMarkupChanged } from '@/components/Canvas/viewportMessages/textEditing';
import { handleElementsScanned } from '@/components/Canvas/viewportMessages/scanning';
import { makeFakeCtx } from '@/components/Canvas/viewportMessages/__tests__/fakeContext';
import { mountBridgeForTest } from '@/bridge/parts/__tests__/harness';
import { applyCommand } from '@/store/commands';
import type { ScannedElement } from '@/context/SelectionContext';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { getDurableProjectState } from '../store';
import { sourceVersion } from '../sourceIdentity';

const file = 'src/pages/index.astro', key = `${file}:2:3`, otherKey = `${file}:3:3`;
const original = '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n';
let projectId: string, doc: Y.Doc, runtime: ReturnType<typeof projectFsRuntime>;
let gate: Promise<void>, release: (() => void) | undefined;
const nodes: HTMLElement[] = [], extraDocs: Y.Doc[] = [];
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_text_continuation_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  setLocalPageFile(file); setLocalExpectedRoute('/'); gate = Promise.resolve(); release = undefined;
  runtime = projectFsRuntime(projectId, { [file]: original }, { beforeCommand: () => gate });
});
afterEach(async () => {
  vi.restoreAllMocks(); setActiveSaveProjectId(projectId); release?.();
  await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
  runtime.close(); doc.destroy(); for (const extra of extraDocs.splice(0)) extra.destroy();
  for (const node of nodes.splice(0)) node.remove();
  unmarkFilesTruth(projectId); setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); vi.unstubAllGlobals();
});

function preview() {
  const ctx = makeFakeCtx({ env: { doc, projectId } });
  ctx.actions.dispatch = command => applyCommand(doc, command);
  const bridge = mountBridgeForTest();
  const paragraph = document.createElement('p'); paragraph.setAttribute('data-key', key); paragraph.textContent = 'One';
  document.body.append(paragraph); nodes.push(paragraph);
  bridge.handleUpdateText({ key, textContent: 'One' }); // Real bridge captures the original restore baseline.
  type Message = { type: string; payload: { key: string; textContent: string } };
  const messages: Message[] = [];
  const frame = () => ({ contentWindow: { postMessage(message: Message) {
    messages.push(message);
    if (message.type === 'UPDATE_TEXT') bridge.handleUpdateText(message.payload);
    if (message.type === 'RESTORE_ORIGINAL_TEXT') bridge.handleRestoreOriginalText(message.payload);
  } } } as unknown as HTMLIFrameElement);
  ctx.refs.iframe.current = frame();
  ctx.actions.setScannedElements = elements => { ctx.refs.scannedElements.current = elements; };
  const scan = (documentId: string) => {
    const elements = ['One', 'Two'].map((textContent, index) => ({ key: `${file}:${index + 2}:3`, tagName: 'p', classes: '', textContent,
      parentKey: `${file}:1:1`, sourceLocation: { file, line: index + 2, column: 3, sourceVersion: sourceVersion(runtime.read(file)) },
      rect: { top: 0, left: 0, width: 10, height: 10 } })) as ScannedElement[];
    handleElementsScanned(ctx, { route: '/', documentId, elements });
  };
  scan('initial'); messages.length = 0;
  // Selection's registration precedes edit-mode entry in the real canvas.
  for (const element of ctx.refs.scannedElements.current) applyCommand(doc, {
    type: 'REGISTER_SOURCE_ELEMENT', sourceKey: element.key, classes: element.classes, sourceLocation: element.sourceLocation,
  });
  return { ctx, paragraph, messages, frame, scan };
}

it('keeps live linked One!? when an older plain-text continuation follows queued text, wrap, and linked text under held ACK', async () => {
  const { ctx, paragraph, messages } = preview();
  gate = new Promise<void>(resolve => { release = resolve; });
  expect(await moveLocalElement({ key, targetKey: otherKey, position: 'after' })).toBe(true);
  paragraph.textContent = 'One!';
  const first = handleEditModeExited(ctx, { key, originalText: 'One', textContent: 'One!' });
  paragraph.innerHTML = '<a href="/one">One!</a>';
  const wrap = handleMarkupChanged(ctx, { key, innerHTML: paragraph.innerHTML });
  paragraph.querySelector('a')!.textContent = 'One!?';
  const last = handleEditModeExited(ctx, { key, originalText: 'One!', textContent: 'One!?' });
  await Promise.all([first, wrap, last]);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 4, materializedRevision: 0 });
  expect(paragraph.innerHTML).toBe('<a href="/one">One!?</a>');
  expect(messages.filter(message => message.type === 'UPDATE_TEXT')).toEqual([]);
  release!(); await flushDurableSourceWritesThrough(projectId, 4);
  expect(runtime.read(file)).toBe('<main>\n  <p>Two</p>\n  <p><a href="/one">One!?</a></p>\n</main>\n');
});

const ownerChanges = ['navigation', 'navigation ABA', 'project', 'project ABA', 'frame', 'window', 'document', 'scan', 'page'] as const;
function replaceOwner(change: typeof ownerChanges[number], live: ReturnType<typeof preview>) {
  const { ctx, paragraph, frame, scan } = live;
  if (change.startsWith('navigation')) { setLocalExpectedRoute('/other'); if (change.endsWith('ABA')) setLocalExpectedRoute('/'); }
  if (change.startsWith('project')) { setActiveSaveProjectId('browser_other_project'); if (change.endsWith('ABA')) setActiveSaveProjectId(projectId); }
  if (change === 'frame') ctx.refs.iframe.current = frame();
  if (change === 'window') Object.assign(ctx.refs.iframe.current!, { contentWindow: frame().contentWindow });
  if (change === 'document') { const replacement = new Y.Doc(); extraDocs.push(replacement); ctx.env.doc = replacement; }
  if (change === 'scan') scan('replacement-document');
  if (change === 'page') ctx.refs.currentPageId.current = 'another-page';
  paragraph.innerHTML = '<a href="/new-owner">New owner</a>';
}

it.each(ownerChanges)('does not repaint the %s owner after the old text has committed', async change => {
  const live = preview();
  gate = new Promise<void>(resolve => { release = resolve; });
  doc.on('update', (_update, origin) => { if (String(origin).startsWith('durable-edit:')) replaceOwner(change, live); });
  await handleEditModeExited(live.ctx, { key, originalText: 'One', textContent: 'One!' });
  expect((await getDurableProjectState(projectId)).acceptedRevision).toBe(1);
  expect(live.paragraph.innerHTML).toBe('<a href="/new-owner">New owner</a>');
  expect(live.messages.filter(message => message.type === 'UPDATE_TEXT')).toEqual([]);
  setActiveSaveProjectId(projectId); release!(); await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toBe('<main>\n  <p>One!</p>\n  <p>Two</p>\n</main>\n');
});

it.each(['text', 'markup'] as const)('does not restore over newer linked typing when an older %s gesture rejects', async failed => {
  const { ctx, paragraph, messages } = preview();
  await handleMarkupChanged(ctx, { key, innerHTML: '<a href="/one">One</a>' });
  await flushDurableSourceWritesThrough(projectId, 1);
  gate = new Promise<void>(resolve => { release = resolve; });
  // An actual storage boundary fault exercises each rejection continuation;
  // all later acceptance, identity projection, and DOM handling remain real.
  vi.spyOn(db.durableEditCheckpoints, 'get').mockRejectedValueOnce(new Error('text is a dynamic expression ({…}) — edit it in the Source tab'));
  const first = failed === 'text'
    ? handleEditModeExited(ctx, { key, originalText: 'One', textContent: 'Bad' })
    : handleMarkupChanged(ctx, { key, innerHTML: '<a href="/bad">Bad</a>' });
  paragraph.innerHTML = '<a href="/one">One!?</a>';
  const last = handleEditModeExited(ctx, { key, originalText: 'One', textContent: 'One!?' });
  await Promise.all([first, last]);
  expect((await getDurableProjectState(projectId)).acceptedRevision).toBe(2);
  expect(paragraph.innerHTML).toBe('<a href="/one">One!?</a>');
  expect(messages.filter(message => message.type === 'RESTORE_ORIGINAL_TEXT')).toEqual([]);
  release!(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe('<main>\n  <p><a href="/one">One!?</a></p>\n  <p>Two</p>\n</main>\n');
});

it.each(['text', 'markup'] as const)('never re-enables an older plain callback when the newer %s gesture rejects', async rejected => {
  const { ctx, paragraph, messages } = preview();
  gate = new Promise<void>(resolve => { release = resolve; });
  paragraph.textContent = 'One!';
  const first = handleEditModeExited(ctx, { key, originalText: 'One', textContent: 'One!' });
  const element = ctx.refs.scannedElements.current[0];
  element.sourceLocation = { ...element.sourceLocation!, sourceVersion: 'unknown-version' };
  paragraph.innerHTML = '<a href="/rejected">Rejected</a>';
  const last = rejected === 'text'
    ? handleEditModeExited(ctx, { key, originalText: 'One!', textContent: 'Rejected' })
    : handleMarkupChanged(ctx, { key, innerHTML: paragraph.innerHTML });
  await Promise.all([first, last]);
  expect((await getDurableProjectState(projectId)).acceptedRevision).toBe(1);
  expect(messages.filter(message => message.type === 'UPDATE_TEXT')).toEqual([]);
  // The current failure retains its existing policy; rejection must not
  // restore an old callback's permission to overwrite the current gesture.
  expect(paragraph.innerHTML).toBe(rejected === 'text' ? '<a href="/rejected">Rejected</a>' : 'One');
  release!(); await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toBe('<main>\n  <p>One!</p>\n  <p>Two</p>\n</main>\n');
});

it.each(['text', 'markup'] as const)('a rejected %s continuation cannot restore a replacement preview owner', async failed => {
  const live = preview();
  vi.spyOn(db.durableEditCheckpoints, 'get').mockImplementationOnce(async () => {
    replaceOwner('navigation ABA', live);
    throw new Error('text is a dynamic expression ({…}) — edit it in the Source tab');
  });
  await (failed === 'text'
    ? handleEditModeExited(live.ctx, { key, originalText: 'One', textContent: 'Bad' })
    : handleMarkupChanged(live.ctx, { key, innerHTML: '<a href="/bad">Bad</a>' }));
  expect((await getDurableProjectState(projectId)).acceptedRevision).toBe(0);
  expect(live.paragraph.innerHTML).toBe('<a href="/new-owner">New owner</a>');
  expect(live.messages.filter(message => message.type === 'RESTORE_ORIGINAL_TEXT')).toEqual([]);
});

it('keeps the latest applicable text continuation when a different element receives markup', async () => {
  const { ctx, paragraph, messages } = preview();
  gate = new Promise<void>(resolve => { release = resolve; });
  paragraph.textContent = 'One!';
  const first = handleEditModeExited(ctx, { key, originalText: 'One', textContent: 'One!' });
  const other = handleMarkupChanged(ctx, { key: otherKey, innerHTML: '<a href="/two">Two</a>' });
  await Promise.all([first, other]);
  expect(messages.filter(message => message.type === 'UPDATE_TEXT')).toEqual([{ type: 'UPDATE_TEXT', payload: { key, textContent: 'One!' } }]);
  expect(paragraph.textContent).toBe('One!');
});
