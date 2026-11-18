import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalExpectedRoute, setLocalScannedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { deleteLocalElement, _resetStructuralWriteInFlightForTests } from '@/components/Editor/localStructuralOps';
import { viteImageWriter } from '@/services/ViteImageWriter';
import { sourceMediaMutation } from '@/services/sourceMediaMutation';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { getDurableProjectState } from '../store';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { resolveProjectedSourceLocation, sourceVersion } from '../sourceIdentity';

const file = 'src/pages/index.astro';
let projectId: string, runtime: ReturnType<typeof projectFsRuntime>, release: () => void;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_media_identity_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  setLocalPageFile(file); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
});
afterEach(async () => {
  release?.(); await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
  runtime?.close(); unmarkFilesTruth(projectId); setActiveSaveProjectId(null);
  _resetLocalPageSyncForTests(); _resetStructuralWriteInFlightForTests(); vi.unstubAllGlobals();
});
function source(text: string) {
  const gate = new Promise<void>(resolve => { release = resolve; });
  runtime = projectFsRuntime(projectId, { [file]: text }, { beforeCommand: () => gate });
}

it.each([
  ['<img data-src="deferred" src="old"/>', '<img data-src="deferred" src="new"/>'],
  ['<img data-src="deferred"/>', '<img src="new" data-src="deferred"/>'],
  ["<img title='src=\"literal\"' SRC = old/>", "<img title='src=\"literal\"' SRC = \"new\"/>"],
])('updates only the exact src token in %s and maps a following old-key edit', async (image, updated) => {
  const original = `<main>${image}<p>Tail</p></main>\n`; source(original);
  await viteImageWriter.writeImageUpdate({ file, line: 1, column: 7, sourceVersion: sourceVersion(original) }, 'src', 'new');
  expect(await deleteLocalElement({ key: `${file}:1:${7 + image.length}`, clearSelection() {} })).toBe(true);
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe(`<main>${updated}</main>\n`);
});

it('escapes quoted special alt text without producing attributes and retains a following identity after reopen', async () => {
  const original = '<main><img alt="Old"/><p>Tail</p></main>\n'; source(original);
  await viteImageWriter.writeImageUpdate({ file, line: 1, column: 7 }, 'alt', 'New "quoted" & <literal> $&');
  db.close(); await db.open(); runtime.restart();
  expect(await deleteLocalElement({ key: `${file}:1:23`, clearSelection() {} })).toBe(true);
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe('<main><img alt="New &quot;quoted&quot; &amp; <literal> $&amp;"/></main>\n');
});

it.each(['longer.mp4', 'old.mp4'])('video src %s preserves track and fallback identities before ACK and through reopen', async src => {
  const original = '<main>\n  <video src="old.mp4"><track src="captions.vtt"/><p>Fallback</p></video>\n</main>\n'; source(original);
  await sourceMediaMutation({ location: { file, line: 2, column: 3 }, kind: 'video', src }, () => {});
  expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 24 })).toMatchObject({ line: 2, column: 17 + src.length });
  db.close(); await db.open(); runtime.restart();
  expect(await deleteLocalElement({ key: `${file}:2:51`, clearSelection() {} })).toBe(true);
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe(`<main>\n  <video src="${src}"><track src="captions.vtt"/></video>\n</main>\n`);
});

it('an already-container no-op preserves nested container and child identities for a subsequent old-key edit', async () => {
  const original = '<main>\n  <div><section><p>Nested</p></section></div>\n</main>\n'; source(original);
  await sourceMediaMutation({ location: { file, line: 2, column: 3 }, kind: 'container', src: '' }, () => {});
  expect(await resolveProjectedSourceLocation(projectId, { file, line: 2, column: 8 })).toMatchObject({ line: 2, column: 8 });
  expect(await deleteLocalElement({ key: `${file}:2:17`, clearSelection() {} })).toBe(true);
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe('<main>\n  <div><section></section></div>\n</main>\n');
});

it('a real video-to-image conversion tombstones removed descendants but preserves the converted root', async () => {
  const original = '<main>\n  <video src="old.mp4"><track src="captions.vtt"/><p>Fallback</p></video>\n</main>\n'; source(original);
  await sourceMediaMutation({ location: { file, line: 2, column: 3 }, kind: 'image', src: '/new.png' }, () => {});
  await expect(resolveProjectedSourceLocation(projectId, { file, line: 2, column: 24 })).rejects.toThrow(/deleted|removed/i);
  await expect(resolveProjectedSourceLocation(projectId, { file, line: 2, column: 51 })).rejects.toThrow(/deleted|removed/i);
  await viteImageWriter.writeImageUpdate({ file, line: 2, column: 3 }, 'alt', 'Converted');
  release(); await flushDurableSourceWritesThrough(projectId, 2);
  expect(runtime.read(file)).toBe('<main>\n  <img src="/new.png" alt="Converted">\n</main>\n');
});
