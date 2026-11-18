import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { markFilesTruth } from '@/utils/localMode';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { parseFrontmatter, setLocalContentSource } from '@/core/collections/content-ops';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { resetLocalTransportForTests } from '@/utils/sqLocalBase';
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => ({}), useYjsValue: () => [{ id: 'works', name: 'works', fields: [{ id: 'cover', name: 'cover', type: 'image', required: false }, { id: 'tags', name: 'tags', type: 'list', required: false }, { id: 'description', name: 'description', type: 'text', required: false }] }] }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ openPost: vi.fn() }) }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('@/components/PostEditor/PostBodyEditor', () => ({ PostBodyEditor: () => <div /> }));
import { PostEditor } from '@/components/PostEditor/PostEditor';
beforeEach(async () => { vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open(); });
afterEach(() => { setActiveSaveProjectId(null); setLocalContentSource(null); resetLocalTransportForTests(); vi.unstubAllGlobals(); });
it.each(['empty image', 'whitespace image', 'typed strings'])('production disk: %s', async scenario => {
  const file = 'src/content/works/post.mdx';
  const source = '---\r\ncover: "./images/existing.png" # keep\r\ntags: ["old"]\r\ndescription: "Before"\r\nunknown: [yes, 2026-09-09, null, {inner: true}]\r\n---\r\nBody.\r\n';
  const project = 'task235-review-image';
  setLocalContentSource(`wc://${project}`); setActiveSaveProjectId(project);
  const runtime = projectFsRuntime(project, { [file]: source });
  markFilesTruth(project);
  const view = render(<PostEditor collectionName="works" post={{ slug: 'post', filePath: file, ...parseFrontmatter(source) }} onPostUpdate={() => {}} />);
  try {
    if (scenario !== 'typed strings') {
      fireEvent.click(screen.getByRole('button', { name: 'Edit cover' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Image path' }), { target: { value: scenario === 'whitespace image' ? '   ' : '' } });
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Item 1' }), { target: { value: 'a, b' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Item 2' }), { target: { value: 'He said "hi"' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Item 3' }), { target: { value: '日本語' } });
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Done' })));
      fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'description' }), { target: { value: 'First\nSecond' } });
    }
    await act(async () => { await flushDurableSourceWrites(project); });
    const saved = runtime.read(file);
    if (scenario !== 'typed strings') expect(saved).toBe(source);
    else {
      expect(saved).toBe(source.replace('["old"]', JSON.stringify(['a, b', 'He said "hi"', '日本語'])).replace('"Before"', '"First\\nSecond"'));
      expect(parseFrontmatter(saved).frontmatter.tags).toEqual(['a, b', 'He said "hi"', '日本語']);
      expect(parseFrontmatter(saved).frontmatter.description).toBe('First\nSecond');
    }
  } finally { view.unmount(); runtime.close(); }
});
