import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { db } from '@/db';
import { parseFrontmatter, setLocalContentSource } from '@/core/collections/content-ops';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { hasPendingPostWrites } from '@/postmodel/writeQueue';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { markFilesTruth } from '@/utils/localMode';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => ({}), useYjsValue: () => collections }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ openPost: vi.fn() }) }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => collections }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
// Keep the real parent, property controls, save participants, queue, compiler,
// contentOps and filesystem patcher. Only the unrelated body UI is stubbed.
vi.mock('../PostBodyEditor', () => ({ PostBodyEditor: () => <div /> }));
import { PostEditor } from '../PostEditor';
const collections = [{ id: 'blog', name: 'blog', fields: [
  { id: 'title', name: 'title', type: 'text', required: false },
  { id: 'tags', name: 'tags', type: 'list', required: false },
  { id: 'description', name: 'description', type: 'text', required: false },
  { id: 'date', name: 'date', type: 'date', required: false },
] }];
const file = 'src/content/blog/post.mdx';
const raw = '---\r\ntitle: Post # keep\r\ntags: ["old"]\r\ndescription: "Before"\r\ndate: 2026-09-09T14:30:15+02:00\r\nauthor:\r\n  name: Ada\r\n---\r\nA paragraph.\r\n';
let counter = 0;
let project: string;
let runtime: ReturnType<typeof projectFsRuntime> | null = null;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  project = `properties_source_${++counter}`; markFilesTruth(project);
  setLocalContentSource(`wc://${project}`); setActiveSaveProjectId(project);
});
afterEach(() => { setActiveSaveProjectId(null); setLocalContentSource(null); runtime?.close(); runtime = null; vi.unstubAllGlobals(); });
/** The materialized source bytes, after every accepted edit reached the disk. */
async function bytes() { await act(async () => { await flushDurableSourceWrites(project); }); return runtime!.read(file); }
function mount(source = raw) {
  runtime = projectFsRuntime(project, { [file]: source });
  return render(<PostEditor collectionName="blog" post={{ slug: 'post', filePath: file, ...parseFrontmatter(source) }} onPostUpdate={() => {}} />);
}
/** Closing the property editor commits it; there is no separate save step. */
async function save() { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); }); }
describe('native property UI → row commit → queue → production source patch', () => {
  it('saves all three focused list strings in order without splitting commas, quotes or Unicode', async () => {
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Item 1' }), { target: { value: 'a, b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Item 2' }), { target: { value: 'He said "hi"' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const last = screen.getByRole('textbox', { name: 'Item 3' }); last.focus();
    fireEvent.change(last, { target: { value: '日本語' } });
    await save();
    expect(parseFrontmatter(await bytes()).frontmatter.tags).toEqual(['a, b', 'He said "hi"', '日本語']);
    expect(await bytes()).toBe(raw.replace('["old"]', JSON.stringify(['a, b', 'He said "hi"', '日本語'])));
    view.unmount();
  });
  it('saves a focused multiline string from a scalar source without changing adjacent timestamp or opaque mapping bytes', async () => {
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    const input = screen.getByRole('textbox', { name: 'description' }); input.focus();
    fireEvent.change(input, { target: { value: 'First\nSecond' } });
    await save();
    expect(parseFrontmatter(await bytes()).frontmatter.description).toBe('First\nSecond');
    expect(await bytes()).toBe(raw.replace('"Before"', '"First\\nSecond"'));
    view.unmount();
  });
  it('refuses an unsafe block-scalar edit, restores the accepted value and leaves the file unchanged', async () => {
    const source = raw.replace('description: "Before"', 'description: |\r\n  Before\r\n  More');
    const view = mount(source);
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'description' }), { target: { value: 'My preserved draft\nSecond' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Done' })));
    expect(await bytes()).toBe(source);
    expect(screen.getByRole('status')).toHaveTextContent('This change could not be stored');
    expect(screen.getByRole('textbox', { name: 'description' })).toHaveValue(String(parseFrontmatter(source).frontmatter.description));
    expect(hasPendingPostWrites(project)).toBe(false);
    view.unmount();
  });
  it('does not rewrite source when opening and closing a full timestamp', async () => {
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit date' }));
    const input = screen.getByRole('textbox', { name: 'date' });
    expect(input).toHaveValue('2026-09-09T14:30:15+02:00');
    await act(async () => fireEvent.blur(input));
    expect(hasPendingPostWrites(project)).toBe(false); expect(await bytes()).toBe(raw); view.unmount();
  });
});
