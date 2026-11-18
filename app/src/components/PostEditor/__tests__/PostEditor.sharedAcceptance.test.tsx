import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';

const owner = vi.hoisted(() => ({ doc: null as Y.Doc | null, editor: null as Editor | null, path: '' }));
vi.mock('@tiptap/react', async original => {
  const actual = await original<typeof import('@tiptap/react')>();
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...args); owner.editor = editor; return editor;
  } };
});
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => owner.doc, useYjsValue: () => [] }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ openPost: vi.fn() }) }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => owner.path }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ userProject: [] }) }));

import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { markFilesTruth } from '@/utils/localMode';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { parseFrontmatter, setLocalContentSource } from '@/core/collections/content-ops';
import { readAcceptedPost } from '@/services/durableEdits/featureAcceptance';
import { awaitAccepted, inspectAcceptedProject } from '@/services/durableEdits/acceptance';
import { PostEditor } from '../PostEditor';

const file = 'src/content/posts/a.md';
const source = '---\ntitle: Old\n---\nBody';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
let release: (() => void) | undefined;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_shared_post_${crypto.randomUUID()}`;
  markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  owner.path = `wc://${projectId}`; setLocalContentSource(owner.path);
  owner.doc = new Y.Doc(); owner.doc.getMap('meta').set('projectId', projectId);
  runtime = projectFsRuntime(projectId, { [file]: source });
});

afterEach(() => {
  release?.(); release = undefined;
  runtime.close(); setLocalContentSource(null); setActiveSaveProjectId(null); owner.doc?.destroy();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each(['body', 'title'] as const)('keeps both controls aligned with the accepted post when the preceding %s edit is refused', async first => {
  const view = render(<PostEditor collectionName="posts" post={{ slug: 'a', filePath: file, ...parseFrontmatter(source) }} onPostUpdate={() => {}} />);
  const title = await screen.findByRole('textbox', { name: 'Title' });
  const gate = new Promise<void>(resolve => { release = resolve; });
  void inspectAcceptedProject(projectId, async () => { await gate; });
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValueOnce(new Error('quota'));
  const changeBody = () => act(() => { owner.editor!.commands.setContent('<p>Changed body</p>'); });
  const changeTitle = () => fireEvent.change(title, { target: { value: 'Changed title' } });
  // Typing is coalesced per pause; the barrier pushes the held body as its own candidate.
  if (first === 'body') { changeBody(); void awaitAccepted(projectId).catch(() => {}); changeTitle(); }
  else { changeTitle(); changeBody(); }
  expect(await db.durableEdits.count()).toBe(0);
  const boundary = awaitAccepted(projectId);
  await act(async () => { release!(); await boundary; });
  const accepted = await readAcceptedPost(projectId, 'posts', 'a');
  expect(accepted).toMatchObject({ body: 'Changed body', frontmatter: { title: 'Changed title' } });
  expect(await db.durableEdits.count()).toBe(1);
  expect(runtime.read(file)).toBe(source);
  expect(owner.editor!.getText()).toBe('Changed body');
  expect(title).toHaveValue('Changed title');
  view.unmount();
});

it.each(['body', 'title'] as const)('restores both controls when the %s edit and its following full candidate are refused', async first => {
  const view = render(<PostEditor collectionName="posts" post={{ slug: 'a', filePath: file, ...parseFrontmatter(source) }} onPostUpdate={() => {}} />);
  const title = await screen.findByRole('textbox', { name: 'Title' });
  const gate = new Promise<void>(resolve => { release = resolve; });
  void inspectAcceptedProject(projectId, async () => { await gate; });
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota'));
  const changeBody = () => act(() => { owner.editor!.commands.setContent('<p>Rejected body</p>'); });
  const changeTitle = () => fireEvent.change(title, { target: { value: 'Rejected title' } });
  if (first === 'body') { changeBody(); changeTitle(); }
  else { changeTitle(); changeBody(); }
  const boundary = awaitAccepted(projectId);
  await act(async () => { release!(); await expect(boundary).rejects.toThrow('quota'); });
  expect(owner.editor!.getText()).toBe('Body');
  expect(title).toHaveValue('Old');
  expect(await db.durableEdits.count()).toBe(0);
  expect(runtime.read(file)).toBe(source);
  view.unmount();
});
