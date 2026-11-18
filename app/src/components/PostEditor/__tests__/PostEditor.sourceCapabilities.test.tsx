import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '@/db';
import { contentOps, parseFrontmatter, setLocalContentSource } from '@/core/collections/content-ops';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { hasPendingPostWrites } from '@/postmodel/writeQueue';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { markFilesTruth } from '@/utils/localMode';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => ({}), useYjsValue: () => [] }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ openPost: vi.fn() }) }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('../PostBodyEditor', () => ({ PostBodyEditor: () => <div /> }));
import { PostEditor } from '../PostEditor';
const file = 'src/content/typed/typed-properties.md';
const raw = readFileSync(resolve(process.cwd(), 'src/postmodel/__tests__/fixtures/typed-properties.md'), 'utf8');
let project: string; let sequence = 0;
let runtime: ReturnType<typeof projectFsRuntime> | null = null;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  project = `local_capability_${++sequence}`; markFilesTruth(project);
  setLocalContentSource(`wc://${project}`); setActiveSaveProjectId(project);
});
afterEach(() => { setActiveSaveProjectId(null); setLocalContentSource(null); runtime?.close(); runtime = null; vi.unstubAllGlobals(); });
/** The materialized source bytes, after every accepted edit reached the disk. */
async function bytes() { await act(async () => { await flushDurableSourceWrites(project); }); return runtime!.read(file); }
async function mount(source = raw) {
  runtime = projectFsRuntime(project, { [file]: source });
  const post = (await contentOps.fetchCollections())[0].posts[0];
  const view = render(<PostEditor collectionName="typed" post={post} onPostUpdate={() => {}} />);
  await screen.findByRole('button', { name: /^Other properties/ });
  return view;
}
it('puts the actual block scalar in Other properties with readable inspection and no write', async () => {
  const view = await mount();
  expect(screen.queryByRole('button', { name: 'Edit description' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Other properties/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Inspect description' }));
  expect(screen.queryByRole('textbox', { name: 'description' })).not.toBeInTheDocument();
  expect(screen.getByText(/First description line\s+Second description line\./, { selector: 'pre' })).toBeVisible();
  expect(hasPendingPostWrites(project)).toBe(false);
  expect(await bytes()).toBe(raw); view.unmount();
});
it('still saves a disjoint focused property while retaining the complete block scalar and body', async () => {
  const view = await mount();
  fireEvent.click(screen.getByRole('button', { name: /^Properties/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit code' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'code' }), { target: { value: 'false' } });
  await act(async () => { fireEvent.blur(screen.getByRole('textbox', { name: 'code' })); });
  const saved = await bytes();
  expect(saved).toBe(raw.replace('code: "0012"', 'code: "false"'));
  expect(parseFrontmatter(saved).frontmatter.code).toBe('false'); view.unmount();
});
it('keeps supported scalar-to-multiline edits editable after accepted save and rediscovery', async () => {
  const supported = raw.replace('description: |\n  First description line\n  Second description line.\n', 'description: "Before"\n');
  const view = await mount(supported);
  fireEvent.click(screen.getByRole('button', { name: /^Properties/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit description' }));
  const revised = 'First revised line\nSecond line — Grüße.';
  fireEvent.change(screen.getByRole('textbox', { name: 'description' }), { target: { value: revised } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })); });
  expect(await bytes()).toBe(supported.replace('description: "Before"', `description: ${JSON.stringify(revised)}`));
  const post = (await contentOps.fetchCollections())[0].posts[0];
  expect(post.readOnlyPropertyKeys?.includes('description') ?? false).toBe(false);
  expect(post.frontmatter.description).toBe(revised);
  view.rerender(<PostEditor collectionName="typed" post={post} onPostUpdate={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
  expect(screen.getByRole('textbox', { name: 'description' })).toHaveValue(revised);
  expect(screen.queryByRole('button', { name: 'Inspect description' })).not.toBeInTheDocument();
  expect(hasPendingPostWrites(project)).toBe(false);
  view.unmount();
});
