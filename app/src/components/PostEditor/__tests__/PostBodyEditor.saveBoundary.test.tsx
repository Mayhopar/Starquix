import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock('@tiptap/react', async original => {
  const actual = await original<typeof import('@tiptap/react')>();
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...args); captured.editor = editor; return editor;
  } };
});
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ userProject: [] }) }));
vi.mock('@/services/filesTruthSync', () => ({
  syncChangedFiles: async () => {}, getFilesTruthSyncStatus: () => ({ projectId: 'browser_body', status: 'idle', error: null }),
  subscribeFilesTruthSyncStatus: () => () => {},
}));
import { PostBodyEditor } from '../PostBodyEditor';
import { PostWriteQueue } from '@/postmodel/writeQueue';
import { db } from '@/db';
import { markFilesTruth } from '@/utils/localMode';
import { setActiveSaveProjectId, setActiveProjectForSave } from '@/services/pendingProjectMutations';
import { projectFsRuntime } from '@/test/projectFsRuntime';
it('a barrier (flushNow) records held typing, and storage rejection restores the last accepted body on storage rejection', async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  const projectId = 'durable_body_owner'; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  const runtime = projectFsRuntime(projectId, { 'src/content/works/a.md': 'Old.' });
  const queue = new PostWriteQueue({ projectId, collection: 'works', slug: 'a', format: 'md', baseline: { frontmatter: {}, body: 'Old.' } });
  const view = render(<PostBodyEditor body="Old." format="md" queue={queue} frontmatterRef={{ current: {} }} collection="works" slug="a" />);
  try {
    act(() => { captured.editor!.commands.setContent('<p>One.</p>'); });
    await act(async () => { await queue.flushNow(); });
    expect(await db.durableEdits.count()).toBe(1);
    const refuse = vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota'));
    act(() => { captured.editor!.commands.setContent('<p>Rejected.</p>'); });
    await act(async () => { await vi.waitFor(() => expect(captured.editor!.getText()).toBe('One.'), { timeout: 3000 }); });
    expect(await db.durableEdits.count()).toBe(1); expect(runtime.read('src/content/works/a.md')).toBe('Old.');
    refuse.mockRestore();
  } finally { view.unmount(); runtime.close(); setActiveProjectForSave(null); vi.unstubAllGlobals(); }
});

it('coalesces a typing burst into one accepted row (one row per keystroke backed up the writer for minutes)', async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  const projectId = 'durable_body_burst'; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  const runtime = projectFsRuntime(projectId, { 'src/content/works/a.md': 'Old.' });
  const queue = new PostWriteQueue({ projectId, collection: 'works', slug: 'a', format: 'md', baseline: { frontmatter: {}, body: 'Old.' } });
  const view = render(<PostBodyEditor body="Old." format="md" queue={queue} frontmatterRef={{ current: {} }} collection="works" slug="a" />);
  try {
    for (const text of ['H', 'He', 'Hel', 'Hell', 'Hello']) {
      act(() => { captured.editor!.commands.setContent(`<p>${text}</p>`, { emitUpdate: true }); });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    }
    await act(async () => { await vi.waitFor(async () => expect(await db.durableEdits.count()).toBeGreaterThan(0), { timeout: 4000 }); });
    await act(async () => { await new Promise(r => setTimeout(r, 1000)); });
    expect(await db.durableEdits.count()).toBe(1);
    expect(JSON.stringify((await db.durableEdits.toArray())[0].commands)).toContain('Hello');
  } finally { view.unmount(); runtime.close(); setActiveProjectForSave(null); vi.unstubAllGlobals(); }
});
