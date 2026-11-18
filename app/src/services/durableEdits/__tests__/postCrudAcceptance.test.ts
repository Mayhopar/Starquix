import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { contentOps, setLocalContentSource } from '@/core/collections/content-ops';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { markFilesTruth } from '@/utils/localMode';
import { flushDurableSourceWrites } from '../sourceMaterialization';
import { hasPendingUserAcceptance } from '../acceptance';
import { persistLocalVariablesCss } from '@/services/localVariablesCss';

const file = 'src/content/posts/hello.md';
const original = '---\r\ntitle: Old # retain\r\n---\r\nOld\r\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
let dispatched: number;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_post_crud_${crypto.randomUUID()}`; markFilesTruth(projectId);
  setActiveSaveProjectId(projectId); setLocalContentSource(`wc://${projectId}`); dispatched = 0;
  runtime = projectFsRuntime(projectId, { [file]: original, 'src/content/news/other.md': 'Other' }, {
    beforeCommand: async () => { dispatched++; expect(await db.durableEdits.count()).toBeGreaterThan(0); },
    loseAcknowledgement: () => true,
  });
});
afterEach(() => { runtime.close(); setActiveSaveProjectId(null); setLocalContentSource(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['create', 'update', 'rename', 'delete', 'deleteCollection'] as const)('refuses %s before source or listing publication if storage rejects', async action => {
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota'));
  let changes = 0; const listener = () => { changes++; }; window.addEventListener('sq:content-changed', listener);
  try {
    const operation = action === 'create' ? contentOps.createPost('posts', 'new', { title: 'New' }, '')
      : action === 'update' ? contentOps.updatePost('posts', 'hello', { title: 'New' }, 'Old\r\n')
      : action === 'rename' ? contentOps.renamePost('posts', 'hello', 'renamed', { title: 'Old' }, 'Old\r\n')
      : action === 'delete' ? contentOps.deletePost('posts', 'hello') : contentOps.deleteCollection('posts');
    await expect(operation).rejects.toThrow('quota');
    expect(changes).toBe(0); expect(await db.durableEdits.count()).toBe(0); expect(runtime.read(file)).toBe(original);
  } finally { window.removeEventListener('sq:content-changed', listener); }
});

it('composes create/update/rename/delete from accepted bytes, reopens before dispatch and reconciles lost ACKs', async () => {
  await contentOps.createPost('posts', 'new', { title: 'New' }, 'Body\n');
  await contentOps.updatePost('posts', 'new', { title: 'Changed' }, 'Body\n');
  await contentOps.renamePost('posts', 'new', 'renamed', { title: 'Changed' }, 'Body\n');
  await contentOps.deletePost('posts', 'hello');
  expect(await db.durableEdits.count()).toBe(4); expect(dispatched).toBe(0); expect(runtime.read(file)).toBe(original);
  db.close(); await db.open(); runtime.restart();
  const posts = (await contentOps.fetchCollections()).find(collection => collection.name === 'posts')!.posts;
  expect(posts.map(post => post.slug)).toEqual(['renamed']); expect(posts[0]).toMatchObject({ frontmatter: { title: 'Changed' }, filePath: 'src/content/posts/renamed.mdx' });
  await flushDurableSourceWrites(projectId);
  expect(() => runtime.read(file)).toThrow('ENOENT'); expect(() => runtime.read('src/content/posts/new.mdx')).toThrow('ENOENT');
  expect(runtime.read('src/content/posts/renamed.mdx')).toContain('Changed'); expect(dispatched).toBe(4);
  await contentOps.deleteCollection('posts'); await flushDurableSourceWrites(projectId);
  expect(() => runtime.read('src/content/posts/renamed.mdx')).toThrow('ENOENT'); expect(runtime.read('src/content/news/other.md')).toBe('Other');
});

it('renames exact imported CRLF bytes and preserves their existing extension', async () => {
  await contentOps.renamePost('posts', 'hello', 'new-name', { title: 'Old' }, 'Old\r\n');
  const row = (await db.durableEdits.toArray())[0];
  expect(row.commands).toEqual([{ kind: 'file-batch', payload: { files: [
    { file, beforeSource: original, afterSource: null },
    { file: 'src/content/posts/new-name.md', beforeSource: null, afterSource: original },
  ] } }]);
});

it('checks duplicate post identities against pending accepted creates across extension and case', async () => {
  await contentOps.createPost('posts', 'New', { title: 'New' }, '');
  await expect(contentOps.createPost('posts', 'new', {}, '')).rejects.toThrow('already exists');
  await expect(contentOps.renamePost('posts', 'hello', 'NEW', { title: 'Old' }, 'Old\r\n')).rejects.toThrow('already exists');
  expect(await db.durableEdits.count()).toBe(1);
});
it.each(['post', 'field', 'variables'] as const)('registers %s acceptance before returning the gesture promise', async kind => {
  const pending = kind === 'post' ? contentOps.createPost('posts', 'immediate', {}, '')
    : kind === 'field' ? contentOps.addLocalCollectionField('posts', 'draft', false, 'boolean')
      : persistLocalVariablesCss(`wc://${projectId}`, ':root {}');
  expect(hasPendingUserAcceptance(projectId)).toBe(true);
  await pending;
});
