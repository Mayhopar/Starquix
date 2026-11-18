// Agent multiplayer (owner 2026-11-08, ledger F in
// docs/plans/2026-11-08-agent-multiplayer-design.md): an outside write to the
// open post (an agent in the terminal) shows up in the editor live, merged with
// the user's unsaved typing; the next save carries only the user's own change.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { markFilesTruth } from '@/utils/localMode';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { parseFrontmatter, setLocalContentSource } from '@/core/collections/content-ops';
import { parsePostBody, serializePostDoc, type PostDoc } from '@/postmodel/postModel';
import { getAgentActivity } from '@/services/agentPresence';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
const state = vi.hoisted(() => ({ doc: null as Y.Doc | null, mine: '', applied: [] as string[], busy: false }));
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => state.doc, useYjsValue: () => [] }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ openPost: vi.fn() }) }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
// The body editor as PostEditor sees it: its live doc, and where an outside merge lands.
vi.mock('../PostBodyEditor', () => ({ PostBodyEditor: forwardRef(function Body(_props, ref) {
  useImperativeHandle(ref, () => ({
    getDoc: () => parsePostBody(state.mine, 'md'), focusStart: () => {}, refreshPreviews: () => {},
    applyOutside: (doc: PostDoc) => { if (state.busy) return false; state.applied.push(serializePostDoc(doc)); state.mine = serializePostDoc(doc); return true; },
  }));
  return <div />;
}) }));
import { PostEditor } from '../PostEditor';

const file = 'src/content/posts/a.md';
const source = '---\ntitle: Old\n---\nOne.\n\nTwo.\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `post_live_merge_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  setLocalContentSource(`wc://${projectId}`); state.doc = new Y.Doc(); state.doc.getMap('meta').set('projectId', projectId);
  state.mine = parseFrontmatter(source).body; state.applied = []; state.busy = false;
  runtime = projectFsRuntime(projectId, { [file]: source });
});
afterEach(() => { runtime.close(); setLocalContentSource(null); setActiveSaveProjectId(null); state.doc?.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const open = () => render(<PostEditor collectionName="posts" post={{ slug: 'a', filePath: file, ...parseFrontmatter(source) }} onPostUpdate={() => {}} />);
const agentWrites = (bytes: string) => act(async () => {
  writeFileSync(join(runtime.root, file), bytes);
  window.dispatchEvent(new CustomEvent('sq:files-changed', { detail: { projectId, files: [file], gone: [] } }));
});

it('F1/F8: shows the agent\'s body and title live while the user is idle, and the agent at work', async () => {
  const view = open();
  const title = await screen.findByRole('textbox', { name: 'Title' });
  await agentWrites('---\ntitle: Agent title\n---\nOne.\n\nTwo, agent.\n');
  await waitFor(() => expect(state.applied).toEqual(['One.\n\nTwo, agent.\n']));
  await waitFor(() => expect(title).toHaveValue('Agent title'));
  expect(getAgentActivity()).toMatchObject({ projectId, file });
  view.unmount();
});

it('F2: keeps the user\'s unsaved typing next to the agent\'s change, and the next save carries only the user\'s change', async () => {
  const view = open();
  const title = await screen.findByRole('textbox', { name: 'Title' });
  state.mine = 'One, mine.\n\nTwo.\n'; // typed, not saved yet
  await agentWrites('---\ntitle: Old\n---\nOne.\n\nTwo, agent.\n');
  await waitFor(() => expect(state.applied).toEqual(['One, mine.\n\nTwo, agent.\n']));
  fireEvent.change(title, { target: { value: 'Mine' } }); // a save: complete post candidate on top of the agent's file
  await act(async () => { await vi.waitFor(async () => expect(await db.durableEdits.count()).toBe(1), { timeout: 2000 }); await flushDurableSourceWrites(projectId); });
  expect(runtime.read(file)).toBe('---\ntitle: "Mine"\n---\nOne, mine.\n\nTwo, agent.\n');
  view.unmount();
});

it('F5: a write by another writer through the journal (an MCP call) shows up live too', async () => {
  const { acceptPostWrite } = await import('@/services/durableEdits/featureAcceptance');
  const view = open();
  const title = await screen.findByRole('textbox', { name: 'Title' });
  await act(async () => { await acceptPostWrite(projectId, 'posts', 'a', { title: 'From MCP' }, 'One.\n\nTwo, via MCP.\n'); });
  await waitFor(() => expect(state.applied).toEqual(['One.\n\nTwo, via MCP.\n']));
  await waitFor(() => expect(title).toHaveValue('From MCP'));
  view.unmount();
});

it('F4: the editor\'s own saves never come back as an outside merge', async () => {
  const view = open();
  const title = await screen.findByRole('textbox', { name: 'Title' });
  fireEvent.change(title, { target: { value: 'Mine' } });
  await act(async () => { await vi.waitFor(async () => expect(await db.durableEdits.count()).toBe(1), { timeout: 2000 }); await flushDurableSourceWrites(projectId); });
  expect(runtime.read(file)).toContain('title: "Mine"');
  await act(async () => {
    window.dispatchEvent(new CustomEvent('sq:files-changed', { detail: { projectId, files: [file], gone: [] } }));
    await new Promise(resolve => setTimeout(resolve, 600));
  });
  expect(state.applied).toEqual([]);
  view.unmount();
});

it('F12: a busy editor (IME, a node view focused) gets the merge as soon as it can take it', async () => {
  const view = open();
  await screen.findByRole('textbox', { name: 'Title' });
  state.busy = true;
  await agentWrites('---\ntitle: Old\n---\nOne.\n\nTwo, agent.\n');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  expect(state.applied).toEqual([]);
  state.busy = false;
  await waitFor(() => expect(state.applied).toEqual(['One.\n\nTwo, agent.\n']), { timeout: 2000 });
  view.unmount();
});
