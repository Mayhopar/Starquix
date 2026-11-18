import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setLocalContentSource } from '@/core/collections/content-ops';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { markFilesTruth } from '@/utils/localMode';
const owners = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn(), editing: { collection: 'posts', slug: 'hello' } }));
const undo = vi.hoisted(() => ({ take: vi.fn(), claim: vi.fn() }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ openPost: owners.open, closePost: owners.close, editingPost: owners.editing }) }));
vi.mock('@/context/VariablesContext', () => ({ useVariables: () => ({ setActiveCollectionId: vi.fn() }) }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: undo.take, claimSnapshot: undo.claim }) }));
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn() }));
import { CollectionTree } from '../CollectionTree';
const file = 'src/content/posts/hello.md';
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  const id = crypto.randomUUID(); markFilesTruth(id); setActiveSaveProjectId(id); setLocalContentSource(`wc://${id}`);
  runtime = projectFsRuntime(id, { [file]: '---\ntitle: Hello\n---\nBody' });
  owners.open.mockReset(); owners.close.mockReset(); undo.take.mockReset(); undo.claim.mockReset();
  owners.editing = { collection: 'posts', slug: 'hello' };
});
afterEach(() => { runtime.close(); setActiveSaveProjectId(null); setLocalContentSource(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const tree = () => render(<CollectionTree collection={{ id: 'local:posts', name: 'posts', fields: [], posts: [] } as never}
  diskPosts={[{ slug: 'hello', filePath: file, frontmatter: { title: 'Hello' }, body: 'Body' }]} />);
// Owner 2026-11-10: delete anything AND undo — the trash deletes at once; ⌘Z brings the bytes back.
const deletePost = () => fireEvent.click(screen.getByTitle('Delete post'));
const snapshot = () => { const s = { stage: vi.fn(), commit: vi.fn(), attachFiles: vi.fn() }; undo.claim.mockReturnValue(s); return s; };

it('keeps the open post when deletion cannot be durably accepted', async () => {
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota')); tree();
  deletePost();
  await screen.findByRole('alert'); expect(owners.close).not.toHaveBeenCalled();
  expect(await db.durableEdits.count()).toBe(0); expect(runtime.read(file)).toContain('Hello');
});
it('closes only after deletion acceptance while source remains unchanged', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const original = db.durableEditCheckpoints.add.bind(db.durableEditCheckpoints);
  vi.spyOn(db.durableEditCheckpoints, 'add').mockImplementation(async (...args) => { await gate; return original(...args); });
  tree(); deletePost();
  expect(owners.close).not.toHaveBeenCalled(); release();
  await waitFor(() => expect(owners.close).toHaveBeenCalledTimes(1));
  expect(await db.durableEdits.count()).toBe(1); expect(runtime.read(file)).toContain('Hello');
});
it('reports a refused create without opening a nonexistent post', async () => {
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota')); tree();
  fireEvent.click(screen.getByTitle('New post')); await screen.findByRole('alert');
  expect(owners.open).not.toHaveBeenCalled(); expect(await db.durableEdits.count()).toBe(0);
});
it('does not close a newer post selected while the old deletion is accepting', async () => {
  const view = tree(); deletePost();
  owners.editing = { collection: 'posts', slug: 'new-selection' };
  view.rerender(<CollectionTree collection={{ id: 'local:posts', name: 'posts', fields: [], posts: [] } as never} diskPosts={[]} />);
  await waitFor(async () => expect(await db.durableEdits.count()).toBe(1));
  expect(owners.close).not.toHaveBeenCalled();
});
it('deletes at once — no question, no native confirm — and hands ⌘Z the exact bytes', async () => {
  const native = vi.spyOn(window, 'confirm'); const undoEntry = snapshot(); tree();
  deletePost();
  await waitFor(() => expect(undoEntry.commit).toHaveBeenCalledTimes(1));
  expect(undo.take).toHaveBeenCalledTimes(1);
  expect(undoEntry.attachFiles).toHaveBeenCalledWith([expect.objectContaining({ file, beforeSource: '---\ntitle: Hello\n---\nBody', afterSource: null })]);
  expect(undoEntry.stage).not.toHaveBeenCalled(); // source-only: the editor doc is never swapped for the acceptance doc
  expect(native).not.toHaveBeenCalled(); expect(screen.queryByRole('group')).toBeNull();
});
it('a second click while the delete is in flight is ignored (no false "still available")', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const original = db.durableEditCheckpoints.add.bind(db.durableEditCheckpoints);
  vi.spyOn(db.durableEditCheckpoints, 'add').mockImplementation(async (...args) => { await gate; return original(...args); });
  tree(); deletePost(); deletePost(); release();
  await waitFor(() => expect(owners.close).toHaveBeenCalledTimes(1));
  expect(await db.durableEdits.count()).toBe(1); expect(screen.queryByRole('alert')).toBeNull();
});
it('a collection delete acts at once and hands ⌘Z all its posts', async () => {
  const undoEntry = snapshot(); tree();
  fireEvent.click(screen.getByTitle('Delete collection'));
  await waitFor(() => expect(undoEntry.commit).toHaveBeenCalledTimes(1));
  expect(undoEntry.attachFiles).toHaveBeenCalledWith([expect.objectContaining({ file, afterSource: null })]);
  expect(await db.durableEdits.count()).toBe(1);
});
