// @vitest-environment node
// Audit 2026-10-18 (c): deploy decoded "text" rows and re-encoded them, so a
// BOM vanished and non-UTF-8 bytes in a "text" path became U+FFFD.
import { beforeEach, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { db } from '@/db';
import { putProjectFiles } from '@/db/projectFiles';
import { projectFilesAsArtifacts } from '../filesTruthZip';

const projectId = 'browser_deploy_bytes';
const rows = {
  'src/pages/index.astro': new TextEncoder().encode('\uFEFF<h1>Привет</h1>'),
  'public/CNAME': new Uint8Array([0xff, 0xfe, 0x41]),
};
beforeEach(async () => {
  await db.delete(); await db.open();
  await putProjectFiles(projectId, Object.entries(rows).map(([path, content]) => ({ path, content })));
});

it('uploads every project file as its exact bytes', async () => {
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  const { files, binaries } = await projectFilesAsArtifacts(projectId, 'Project', doc);
  const uploaded = new Map([...files.map(f => [f.path, new TextEncoder().encode(f.content)] as const),
    ...binaries.map(b => [b.path, b.data] as const)]);
  for (const [path, bytes] of Object.entries(rows)) expect(Array.from(uploaded.get(path)!), path).toEqual(Array.from(bytes));
  doc.destroy();
});
