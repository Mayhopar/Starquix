// Agent multiplayer (owner 2026-11-08, ledger F/G7): an outside write lands in
// the live Tiptap doc as a remote change — only the blocks that differ, the
// caret kept, no save of its own, not the user's undo step, flashed.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { createRef } from 'react';
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
import { PostBodyEditor, type PostBodyEditorHandle } from '../PostBodyEditor';
import { PostWriteQueue } from '@/postmodel/writeQueue';
import { parsePostBody, serializePostDoc } from '@/postmodel/postModel';
import { db } from '@/db';
import { markFilesTruth } from '@/utils/localMode';
import { setActiveSaveProjectId, setActiveProjectForSave } from '@/services/pendingProjectMutations';
import { projectFsRuntime } from '@/test/projectFsRuntime';

it('replaces only the changed block, keeps the caret, saves nothing, stays out of undo, and flashes the block', async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  const projectId = 'durable_body_outside'; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  const body = 'One.\n\nTwo.\n\nThree.\n';
  const runtime = projectFsRuntime(projectId, { 'src/content/works/a.md': body });
  const queue = new PostWriteQueue({ projectId, collection: 'works', slug: 'a', format: 'md', baseline: { frontmatter: {}, body } });
  const ref = createRef<PostBodyEditorHandle>();
  const view = render(<PostBodyEditor ref={ref} body={body} format="md" queue={queue} frontmatterRef={{ current: {} }} collection="works" slug="a" />);
  try {
    const editor = captured.editor!;
    const first = editor.view.dom.querySelector('p');
    act(() => { editor.commands.setTextSelection(3); });
    let landed = false;
    act(() => { landed = ref.current!.applyOutside(parsePostBody('One.\n\nTwo, agent.\n\nThree.\n', 'md')); });
    expect(landed).toBe(true);
    expect(serializePostDoc(ref.current!.getDoc()!)).toBe('One.\n\nTwo, agent.\n\nThree.\n');
    expect(editor.view.dom.querySelector('p')).toBe(first); // block 1 untouched (same DOM node)
    expect(editor.state.selection.from).toBe(3);
    expect(editor.view.dom.querySelectorAll('p')[1].classList.contains('sq-agent-flash')).toBe(true);
    act(() => { editor.commands.undo(); });
    expect(editor.getText()).toContain('Two, agent.');
    // A decoration (ProseMirror's own), not a hand-set class — the live probe saw PM redraw a hand-marked block
    // within 150 ms. It follows the block through typing in it.
    const second = editor.state.doc.child(0).nodeSize;
    act(() => { editor.view.dispatch(editor.state.tr.insertText('!', second + 1).setMeta('preventUpdate', true)); });
    expect(editor.view.dom.querySelectorAll('p')[1].classList.contains('sq-agent-flash')).toBe(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1700)); });
    expect(editor.view.dom.querySelector('.sq-agent-flash')).toBeNull(); // faded and cleared
    expect(await db.durableEdits.count()).toBe(0); // the agent's own write is not saved again
  } finally { view.unmount(); runtime.close(); setActiveProjectForSave(null); vi.unstubAllGlobals(); }
});

it('waits while the user is composing (IME) — the caller retries', async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  const projectId = 'durable_body_outside_ime'; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  const body = 'One.\n';
  const runtime = projectFsRuntime(projectId, { 'src/content/works/a.md': body });
  const queue = new PostWriteQueue({ projectId, collection: 'works', slug: 'a', format: 'md', baseline: { frontmatter: {}, body } });
  const ref = createRef<PostBodyEditorHandle>();
  const view = render(<PostBodyEditor ref={ref} body={body} format="md" queue={queue} frontmatterRef={{ current: {} }} collection="works" slug="a" />);
  try {
    Object.defineProperty(captured.editor!.view, 'composing', { configurable: true, get: () => true });
    expect(ref.current!.applyOutside(parsePostBody('One, agent.\n', 'md'))).toBe(false);
    expect(captured.editor!.getText()).toBe('One.');
  } finally { view.unmount(); runtime.close(); setActiveProjectForSave(null); vi.unstubAllGlobals(); }
});
