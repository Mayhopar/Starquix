import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { useImperativeHandle, type Ref } from 'react';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '@/db';
import { contentOps, newPostFrontmatter, parseFrontmatter, serializeFrontmatter, setLocalContentSource } from '@/core/collections/content-ops';
import type { PostMeta } from '@/core/collections/types';
import { parsePostBody } from '@/postmodel/postModel';
import type { PostBodyEditorHandle } from '../PostBodyEditor';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { markFilesTruth } from '@/utils/localMode';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';

let bodyDoc: ReturnType<typeof parsePostBody>;
let openPost = vi.fn();
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ openPost: (...args: unknown[]) => openPost(...args) }) }));
vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => ({ getMap: () => ({ has: () => false }) }),
  useYjsValue: () => [],
}));
vi.mock('@/store/commands', () => ({ applyCommand: vi.fn() }));
vi.mock('../FrontmatterForm', () => ({ FrontmatterForm: ({ frontmatter, onChange, onBlur }: {
  frontmatter: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  onBlur: () => void;
}) => <>
  <input aria-label="Title" value={String(frontmatter.title)} onChange={event => onChange({ ...frontmatter, title: event.target.value })} />
  <button onClick={onBlur}>Save title</button>
</> }));
// Control the observed document and actual React ref teardown; retain the real
// PostEditor lifecycle, queue, compiler, discovery and source write preconditions.
vi.mock('../PostBodyEditor', () => ({ PostBodyEditor: ({ ref }: { ref: Ref<PostBodyEditorHandle> }) => {
  useImperativeHandle(ref, () => ({ getDoc: () => bodyDoc, refreshPreviews: () => {}, focusStart: () => {} }));
  return null;
} }));
import { PostEditor } from '../PostEditor';

const seedFrontmatter = {
  title: 'Seed', subtitle: 'Subtitle', description: 'Description', slug: 'seed',
  date: '2026-09-09', timestamp: '2026-09-09', published: true,
  tags: 'tag', code: 'x', number: 2, mixed: 'mixed', cover: '/original.png', 'quoted key': 'text',
};
const project = 'rename-source';
let root: string;
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  openPost = vi.fn(); bodyDoc = parsePostBody('');
  // The REAL /__sq/local/* route table runs on a temporary disk; edits go
  // through the durable acceptance owners and materialize on flush.
  runtime = projectFsRuntime(project, { 'src/content/posts/.keep': '' });
  root = runtime.root;
  markFilesTruth(project); setActiveSaveProjectId(project);
  setLocalContentSource(`wc://${project}`);
});
afterEach(() => { setLocalContentSource(null); setActiveSaveProjectId(null); vi.unstubAllGlobals(); localStorage.clear(); runtime.close(); });
/** The materialized source bytes, after every accepted edit reached the disk. */
async function read(file: string) { await act(async () => { await flushDurableSourceWrites(project); }); return runtime.read(file); }
/** A new post as the files-truth create lands it: `.mdx` (postCrudAcceptance). */
const seedNewPost = (slug: string, frontmatter: Record<string, unknown>) =>
  writeFileSync(join(root, `src/content/posts/${slug}.mdx`), serializeFrontmatter(frontmatter, ''));

it('two new titled posts keep filename slugs while an explicit user override survives save and rename', async () => {
  const seed: PostMeta = { slug: 'seed', frontmatter: seedFrontmatter, body: '', filePath: 'src/content/posts/seed.mdx' };
  const cases = [
    { oldSlug: 'untitled-1', title: 'Acceptance draft', expectedSlug: 'acceptance-draft', override: undefined },
    { oldSlug: 'untitled-2', title: 'Rapid draft verified', expectedSlug: 'rapid-draft-verified', override: undefined },
    { oldSlug: 'untitled-3', title: 'Explicit override', expectedSlug: 'explicit-override', override: 'user-chosen-route' },
  ];
  for (const entry of cases) {
    const values = newPostFrontmatter([seed, ...(await contentOps.fetchCollections())[0]?.posts ?? []]);
    if (entry.override !== undefined) values.slug = entry.override;
    seedNewPost(entry.oldSlug, values);
    const post = (await contentOps.fetchCollections())[0].posts.find(post => post.slug === entry.oldSlug)!;
    const view = render(<PostEditor collectionName="posts" post={post} onPostUpdate={() => {}} />);
    fireEvent.change(view.getByRole('textbox', { name: 'Title' }), { target: { value: entry.title } });
    await act(async () => {
      fireEvent.click(view.getByText('Save title'));
      await vi.waitFor(() => expect(openPost).toHaveBeenCalledWith('posts', entry.expectedSlug));
    });
    view.unmount();
    const source = await read(`src/content/posts/${entry.expectedSlug}.mdx`);
    const saved = parseFrontmatter(source);
    expect(saved.frontmatter.title).toBe(entry.title);
    if (entry.override === undefined) {
      expect(saved.frontmatter).not.toHaveProperty('slug');
    } else {
      expect(saved.frontmatter.slug).toBe('user-chosen-route');
      expect(source).toContain('slug: "user-chosen-route"\n');
    }
  }
});
