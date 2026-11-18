/**
 * Owner 2026-11-10: "Good ux is when you can delete anything AND UNDO!" — a delete acts at once and ONE ⌘Z brings the
 * exact bytes back (docs/plans/2026-11-10-delete-then-undo-ledger.md, cases 1–4). Real UndoProvider, real route table.
 */
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { contentOps, setLocalContentSource } from '@/core/collections/content-ops';
import { markFilesTruth } from '@/utils/localMode';
import { applyCommand } from '@/store/commands';
import { deleteLocalDocPage } from '@/store/localPages';
import { flushDurableSourceWrites } from '../sourceMaterialization';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
const post = 'src/content/posts/hello.md', other = 'src/content/posts/world.mdx';
const bytes = '---\r\ntitle: Hello # keep\r\n---\r\nBody\r\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_delete_undo_${crypto.randomUUID()}`; markFilesTruth(projectId);
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  setActiveSaveProjectId(projectId); setLocalContentSource(`wc://${projectId}`);
  runtime = projectFsRuntime(projectId, { [post]: bytes, [other]: 'World' });
});
afterEach(() => {
  cleanup(); runtime.close(); h.doc.destroy(); setActiveSaveProjectId(null); setLocalContentSource(null);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const mount = () => renderHook(() => useUndoContext(), { wrapper: ({ children }) => <UndoProvider>{children}</UndoProvider> });
const settle = () => flushDurableSourceWrites(projectId);
const gone = (file: string) => expect(() => runtime.read(file)).toThrow('ENOENT');

it('a post delete is one ⌘Z: the exact bytes come back, ⇧⌘Z deletes it again', async () => {
  const { result } = mount();
  await act(async () => { result.current.takeSnapshot(); await contentOps.deletePost('posts', 'hello', result.current.claimSnapshot()); });
  await settle(); gone(post);
  await act(async () => { await result.current.undo(); }); await settle();
  expect(runtime.read(post)).toBe(bytes);
  await act(async () => { await result.current.redo(); }); await settle();
  gone(post);
});

it('⌘Z and ⇧⌘Z of a post delete tell the Content panel to re-list (sq:content-changed) once the files landed', async () => {
  const { result } = mount();
  await act(async () => { result.current.takeSnapshot(); await contentOps.deletePost('posts', 'hello', result.current.claimSnapshot()); });
  await settle();
  const listings: string[] = [];
  const onChange = () => { try { runtime.read(post); listings.push('present'); } catch { listings.push('absent'); } };
  window.addEventListener('sq:content-changed', onChange);
  try {
    await act(async () => { await result.current.undo(); }); await settle();
    await vi.waitFor(() => expect(listings).toContain('present'));
    await act(async () => { await result.current.redo(); }); await settle();
    await vi.waitFor(() => expect(listings).toContain('absent'));
  } finally { window.removeEventListener('sq:content-changed', onChange); }
});

it('a collection delete is one ⌘Z for all its posts', async () => {
  const { result } = mount();
  await act(async () => { result.current.takeSnapshot(); await contentOps.deleteCollection('posts', result.current.claimSnapshot()); });
  await settle(); gone(post); gone(other);
  await act(async () => { await result.current.undo(); }); await settle();
  expect(runtime.read(post)).toBe(bytes); expect(runtime.read(other)).toBe('World');
  expect(result.current.canUndo).toBe(false);
});

it('removing a collection field is one ⌘Z: every post gets its exact bytes back', async () => {
  const { result } = mount();
  await act(async () => { result.current.takeSnapshot(); await contentOps.removeLocalCollectionField('posts', 'title', result.current.claimSnapshot()); });
  await settle(); expect(runtime.read(post)).not.toContain('title');
  await act(async () => { await result.current.undo(); }); await settle();
  expect(runtime.read(post)).toBe(bytes); expect(runtime.read(other)).toBe('World');
});

it('deleting a collection with no post files leaves no ⌘Z that restores nothing', async () => {
  const { result } = mount();
  await act(async () => { result.current.takeSnapshot(); await contentOps.deleteCollection('empty', result.current.claimSnapshot()); });
  expect(result.current.canUndo).toBe(false);
});

it('a post page delete is one ⌘Z: the post file and its page row come back', async () => {
  applyCommand(h.doc, { type: 'ADD_PAGE', page: { id: 'index', name: '/', children: [], rootElementIds: [] } });
  applyCommand(h.doc, { type: 'ADD_PAGE', page: { id: 'posts-hello', name: '/posts/hello', children: [], rootElementIds: [] } });
  vi.spyOn(contentOps, 'fetchCollections').mockResolvedValue([
    { name: 'posts', posts: [{ slug: 'hello', frontmatter: {}, body: 'Body' }], inferredFields: [] },
  ] as never);
  const { result } = mount();
  await act(async () => {
    await deleteLocalDocPage(h.doc, `wc://${projectId}`, 'posts-hello', undefined,
      () => { result.current.takeSnapshot(); return result.current.claimSnapshot(); });
  });
  await settle(); gone(post); expect(h.doc.getMap('pages').has('posts-hello')).toBe(false);
  await act(async () => { await result.current.undo(); }); await settle();
  expect(runtime.read(post)).toBe(bytes); expect(h.doc.getMap('pages').has('posts-hello')).toBe(true);
});
