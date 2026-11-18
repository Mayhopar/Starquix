import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';

const captured = vi.hoisted(() => ({ editor: null as Editor | null, projectPath: '' }));
vi.mock('@tiptap/react', async original => {
  const actual = await original<typeof import('@tiptap/react')>();
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...args); captured.editor = editor; return editor;
  } };
});
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => captured.projectPath }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({
  userProject: [{ name: 'Credit', path: 'src/components/sq/Credit.astro' }],
}) }));

import { PostBodyEditor } from '../PostBodyEditor';
import { PostWriteQueue } from '@/postmodel/writeQueue';
import { db } from '@/db';
import { markFilesTruth } from '@/utils/localMode';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { inspectAcceptedProject } from '@/services/durableEdits/acceptance';
import { readAcceptedPost } from '@/services/durableEdits/featureAcceptance';
import { projectFsRuntime } from '@/test/projectFsRuntime';

const file = 'src/content/works/a.mdx';
const original = '/\n\nTail.';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
let queue: PostWriteQueue;
let release: (() => void) | undefined;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `durable_post_insert_${crypto.randomUUID()}`;
  markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  captured.projectPath = `wc://${projectId}`;
  runtime = projectFsRuntime(projectId, {
    [file]: original, 'src/components/sq/Credit.astro': '<p>Credit</p>',
    'package.json': '{"dependencies":{"@astrojs/mdx":"1.0.0"}}',
  });
  Range.prototype.getBoundingClientRect = () => new DOMRect(10, 20, 80, 20);
  Range.prototype.getClientRects = () => [new DOMRect(10, 20, 80, 20)] as unknown as DOMRectList;
  queue = new PostWriteQueue({ projectId, collection: 'works', slug: 'a', format: 'mdx', baseline: { frontmatter: {}, body: original } });
});

afterEach(async () => {
  release?.(); release = undefined;
  queue.dispose(); runtime.close(); setActiveSaveProjectId(null);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function beginInsertion() {
  // A real earlier operation holds the lane; neither acceptance nor the queue
  // is replaced. Later typing must retain the pending insertion in its model.
  const gate = new Promise<void>(resolve => { release = resolve; });
  void inspectAcceptedProject(projectId, async () => { await gate; });
  const view = render(<PostBodyEditor body={original} format="mdx" queue={queue}
    frontmatterRef={{ current: {} }} collection="works" slug="a" filePath={file} />);
  captured.editor!.view.coordsAtPos = () => ({ left: 10, right: 10, top: 20, bottom: 40 });
  act(() => { captured.editor!.commands.setTextSelection(2); });
  fireEvent.click(screen.getByRole('option', { name: /Credit/ }));
  await waitFor(() => expect(queue.size).toBe(1));
  expect(await db.durableEdits.count()).toBe(0);
  expect(runtime.read(file)).toBe(original);
  return view;
}

function typeAfterInsertion() {
  act(() => {
    const editor = captured.editor!;
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' More.');
  });
}

it('keeps a component insertion and newer typing when their acceptances finish', async () => {
  const view = await beginInsertion();
  typeAfterInsertion();
  await act(async () => { release!(); await queue.flushNow(); });
  const accepted = await readAcceptedPost(projectId, 'works', 'a');
  expect(accepted.body).toContain('<Credit />');
  expect(accepted.body).toContain('Tail. More.');
  expect(captured.editor!.getText()).toContain('Tail. More.');
  expect(captured.editor!.getJSON().content?.filter(node => node.type === 'astroComponent')).toHaveLength(1);
  expect(await db.durableEdits.count()).toBe(2);
  expect(runtime.read(file)).toBe(original);
  view.unmount();
});

it('keeps the newer full candidate when storage refuses only its preceding insertion', async () => {
  const view = await beginInsertion();
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValueOnce(new Error('quota'));
  typeAfterInsertion();
  await act(async () => { release!(); await queue.flushNow(); });
  const accepted = await readAcceptedPost(projectId, 'works', 'a');
  expect(accepted.body).toContain('<Credit />');
  expect(accepted.body).toContain('Tail. More.');
  expect(captured.editor!.getText()).toContain('Tail. More.');
  expect(captured.editor!.getJSON().content?.filter(node => node.type === 'astroComponent')).toHaveLength(1);
  expect(screen.queryByRole('status')).toBeNull();
  expect(await db.durableEdits.count()).toBe(1);
  expect(runtime.read(file)).toBe(original);
  view.unmount();
});

it('restores the accepted body when the latest speculative insertion is refused', async () => {
  const view = await beginInsertion();
  expect(captured.editor!.getJSON().content?.filter(node => node.type === 'astroComponent')).toHaveLength(1);
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota'));
  await act(async () => { release!(); });
  await waitFor(() => expect(queue.size).toBe(0));
  expect(captured.editor!.getText()).toBe('/\n\nTail.');
  expect(captured.editor!.getJSON().content?.filter(node => node.type === 'astroComponent')).toHaveLength(0);
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(await db.durableEdits.count()).toBe(0);
  expect(runtime.read(file)).toBe(original);
  view.unmount();
});
