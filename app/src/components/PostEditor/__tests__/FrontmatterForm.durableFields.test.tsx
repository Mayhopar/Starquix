import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { parseFrontmatter, setLocalContentSource } from '@/core/collections/content-ops';
import type { CollectionField } from '@/core/collections/types';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { awaitAccepted } from '@/services/durableEdits/acceptance';

vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => ({}), useYjsValue: () => [] }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn(), claimSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));

import { FrontmatterForm } from '../FrontmatterForm';

const file = 'src/content/posts/hello.md';
const configFile = 'src/content.config.ts';
const source = '---\ntitle: Hello\nrating: 5\n---\nBody\n';
const config = "import { defineCollection, z } from 'astro:content';\nconst posts = defineCollection({ schema: z.object({\n  title: z.string(),\n  rating: z.number().optional(),\n}) });\nexport const collections = { posts };\n";
const initial = parseFrontmatter(source).frontmatter;
const fields: CollectionField[] = [
  { id: 'title', name: 'title', type: 'text', required: false },
  { id: 'rating', name: 'rating', type: 'text', required: false },
];
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `durable_fields_${crypto.randomUUID()}`;
  setActiveSaveProjectId(projectId); setLocalContentSource(`wc://${projectId}`);
  runtime = projectFsRuntime(projectId, { [file]: source, [configFile]: config });
});
afterEach(() => {
  cleanup(); runtime.close(); setLocalContentSource(null); setActiveSaveProjectId(null);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function mount(commitResult = true) {
  let current = initial;
  let commits = 0;
  let acceptedField: string | undefined;
  let acceptedRowsAtPublication: Promise<number> | undefined;
  function Form() {
    const [frontmatter, setFrontmatter] = useState(initial);
    return <FrontmatterForm frontmatter={frontmatter} fields={fields} collectionId={null} localCollection="posts"
      projectPath={`wc://${projectId}`} postFile={file}
      onChange={(next, options?: { collectionAccepted: true; field: string }) => {
        current = next; setFrontmatter(next);
        if (options?.collectionAccepted) {
          acceptedField = options.field; acceptedRowsAtPublication = db.durableEdits.count();
        }
      }} onBlur={async () => { commits++; return commitResult; }} />;
  }
  return { ...render(<Form />), current: () => current, commits: () => commits,
    acceptedField: () => acceptedField, acceptedRowsAtPublication: () => acceptedRowsAtPublication };
}

function manage() { fireEvent.click(screen.getByRole('button', { name: 'Manage collection fields' })); }
function add() {
  manage(); fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Field name' }), { target: { value: 'score' } });
}
function actionButton(action: 'add' | 'remove') {
  return screen.getByRole('button', { name: action === 'add' ? 'Add' : 'Remove collection field rating', exact: true });
}
/** Remove acts at once (⌘Z puts the key back — culture.md Law 6); Add opens its popover. */
function clickAction(action: 'add' | 'remove') {
  fireEvent.click(actionButton(action));
}

it.each(['add', 'remove'] as const)('keeps a refused field %s unchanged and permits retry without legacy save ownership', async action => {
  const refuse = vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValueOnce(new Error('private quota detail'));
  const view = mount(); if (action === 'add') add(); else manage();
  clickAction(action);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/not (added|updated)/));
  expect(view.current()).toEqual({ title: 'Hello', rating: 5 });
  expect(runtime.read(file)).toBe(source); expect(runtime.read(configFile)).toBe(config);
  expect(await db.durableEdits.count()).toBe(0);
  expect(actionButton(action)).toBeEnabled();
  expect(screen.getByRole('status')).not.toHaveTextContent(/some files may have changed|private quota detail/i);
  if (action === 'add') expect(screen.getByRole('textbox', { name: 'Field name' })).toHaveValue('score');

  refuse.mockRestore(); clickAction(action);
  await waitFor(() => expect(view.current()).toEqual(action === 'add'
    ? { title: 'Hello', rating: 5, score: '' } : { title: 'Hello' }));
  expect(view.acceptedField()).toBe(action === 'add' ? 'score' : 'rating');
  expect(await view.acceptedRowsAtPublication()).toBe(1);
  expect(await db.durableEdits.count()).toBe(1);
  expect(view.commits()).toBe(2);
  expect(runtime.read(file)).toBe(source); expect(runtime.read(configFile)).toBe(config);
});

it('reports current-post attention when removal cannot flush the draft before collection acceptance', async () => {
  const view = mount(false); manage(); clickAction('remove');
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('The current post needs attention.'));
  expect(screen.getByRole('status')).not.toHaveTextContent('could not be stored');
  expect(view.current()).toEqual({ title: 'Hello', rating: 5 });
  expect(await db.durableEdits.count()).toBe(0); expect(runtime.read(file)).toBe(source);
});

it('retains pending acceptance across a remount and releases retry when storage refuses it', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let preparing = false;
  vi.spyOn(db.durableEditCheckpoints, 'get').mockImplementationOnce(async () => { preparing = true; await gate; return undefined; });
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValueOnce(new Error('quota'));
  const original = mount(); add(); fireEvent.click(actionButton('add'));
  await waitFor(() => expect(preparing).toBe(true));
  expect(original.current()).toEqual({ title: 'Hello', rating: 5 });
  original.unmount(); mount(); add();
  expect(actionButton('add')).toBeDisabled();
  await act(async () => {
    // Releasing preparation still leaves file planning and IDB rollback ahead.
    // Join the real rejection so the UI assertion measures the settled owner.
    const acceptance = awaitAccepted(projectId);
    release();
    await expect(acceptance).rejects.toThrow('quota');
  });
  await waitFor(() => expect(actionButton('add')).toBeEnabled());
  expect(await db.durableEdits.count()).toBe(0);
  expect(runtime.read(file)).toBe(source); expect(runtime.read(configFile)).toBe(config);
});

it('publishes only the accepted field while preserving a newer title draft without a second commit', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let preparing = false;
  vi.spyOn(db.durableEditCheckpoints, 'get').mockImplementationOnce(async () => { preparing = true; await gate; return undefined; });
  const view = mount(); add(); fireEvent.click(actionButton('add'));
  await waitFor(() => expect(preparing).toBe(true));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Newer draft' } });
  expect(view.current()).toEqual({ title: 'Newer draft', rating: 5 });
  await act(async () => { release(); });
  await waitFor(() => expect(view.current()).toEqual({ title: 'Newer draft', rating: 5, score: '' }));
  expect(view.acceptedField()).toBe('score'); expect(await view.acceptedRowsAtPublication()).toBe(1);
  expect(view.commits()).toBe(1);
  expect(runtime.read(file)).toBe(source); expect(runtime.read(configFile)).toBe(config);
});
