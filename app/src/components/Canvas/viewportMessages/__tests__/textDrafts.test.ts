/**
 * Seamless canvas Task 1.6: the parent persists TEXT_DRAFT to disk and clears
 * it only once the text commit is ACCEPTED (a failed commit keeps the draft).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeCtx } from './fakeContext';

const { mockFetch, mockAccept } = vi.hoisted(() => ({
  mockFetch: vi.fn(async (..._a: unknown[]) => new Response('{"ok":true}')),
  mockAccept: vi.fn(async (..._a: unknown[]) => ({ sourceTextResults: [] })),
}));
vi.mock('@/utils/sqLocalBase', async (orig) => ({ ...(await orig<typeof import('@/utils/sqLocalBase')>()), localFetch: mockFetch }));
vi.mock('@/utils/localMode', async (orig) => ({ ...(await orig<typeof import('@/utils/localMode')>()), isLocalProjectId: () => true }));
vi.mock('@/store/commandGesture', async (orig) => ({ ...(await orig<typeof import('@/store/commandGesture')>()), acceptEditorCommands: mockAccept }));

import { handleTextDraft } from '../textDrafts';
import { handleEditModeExited, handleMarkupChanged } from '../textEditing';

const KEY = 'src/pages/index.astro:6:5';
const deletes = () => mockFetch.mock.calls.filter(c => (c[1] as RequestInit | undefined)?.method === 'DELETE').map(c => c[0]);

beforeEach(() => { mockFetch.mockClear(); mockAccept.mockClear(); });

describe('TEXT_DRAFT', () => {
  it('POSTs the draft to /__sq/local/draft', async () => {
    const d = { key: KEY, file: 'src/pages/index.astro', sourceVersion: 'v1', markup: 'Hey', page: '/' };
    handleTextDraft(makeFakeCtx({ env: { projectId: 'browser_x' } }), d);
    expect(mockFetch).toHaveBeenCalledWith('/__sq/local/draft', expect.objectContaining({ method: 'POST', body: JSON.stringify(d) }));
  });

  it('ignores malformed drafts', () => {
    handleTextDraft(makeFakeCtx(), { key: KEY, file: '../x', markup: 'a' });
    handleTextDraft(makeFakeCtx(), null);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('draft clear', () => {
  it('clears only after the text commit is accepted', async () => {
    let accept!: (v: unknown) => void;
    mockAccept.mockImplementationOnce(() => new Promise(r => { accept = r; }));
    const done = handleEditModeExited(makeFakeCtx({ env: { projectId: 'browser_x' } }), { key: KEY, textContent: 'new', originalText: 'old' });
    await Promise.resolve();
    expect(deletes()).toEqual([]);
    accept({ sourceTextResults: [] }); await done;
    expect(deletes()).toEqual([`/__sq/local/draft?key=${encodeURIComponent(KEY)}`]);
  });

  it('keeps the draft when the commit is rejected', async () => {
    mockAccept.mockImplementationOnce(async () => { throw new Error('refused'); });
    await handleEditModeExited(makeFakeCtx({ env: { projectId: 'browser_x' } }), { key: KEY, textContent: 'new', originalText: 'old' });
    expect(deletes()).toEqual([]);
  });

  it('clears immediately when nothing changed', async () => {
    await handleEditModeExited(makeFakeCtx({ env: { projectId: 'browser_x' } }), { key: KEY, textContent: 'same', originalText: 'same' });
    expect(deletes()).toHaveLength(1);
  });

  it('a markup commit owns the clear (EXITED reports unchanged right after it)', async () => {
    let accept!: (v: unknown) => void;
    mockAccept.mockImplementationOnce(() => new Promise(r => { accept = r; }));
    const ctx = makeFakeCtx({ env: { projectId: 'browser_x' } });
    const done = handleMarkupChanged(ctx, { key: KEY, innerHTML: 'a<br>b' });
    await handleEditModeExited(ctx, { key: KEY, textContent: 'ab', originalText: 'ab' });
    expect(deletes()).toEqual([]);
    accept(undefined); await done;
    expect(deletes()).toHaveLength(1);
  });
});

describe('restore after a new document (Task 1.7, D7)', () => {
  const { mockProject } = vi.hoisted(() => ({ mockProject: vi.fn() }));
  vi.mock('@/services/durableEdits/sourceIdentity', async (orig) => ({
    ...(await orig<typeof import('@/services/durableEdits/sourceIdentity')>()), resolveProjectedSourceLocation: mockProject,
  }));
  const el = (key: string, line: number, sourceVersion: string) => ({ key, tagName: 'p', sourceLocation: { file: 'src/pages/index.astro', line, column: 5, sourceVersion } });
  const serve = (drafts: unknown[]) => mockFetch.mockImplementation(async (url: unknown, init?: unknown) =>
    (init as RequestInit | undefined)?.method ? new Response('{"ok":true}') : new Response(JSON.stringify({ drafts })));
  const draft = (over: Record<string, unknown> = {}) => ({ key: KEY, file: 'src/pages/index.astro', sourceVersion: 'v1', markup: 'Typed', page: '/', updatedAt: 1, ...over });
  const calls = (method: string) => mockFetch.mock.calls.filter(c => (c[1] as RequestInit | undefined)?.method === method);
  let ctx: ReturnType<typeof makeFakeCtx>;
  beforeEach(async () => {
    mockProject.mockReset();
    ctx = makeFakeCtx({ env: { projectId: 'browser_x' } });
    const { armTextDraftRestore } = await import('../textDrafts');
    armTextDraftRestore(ctx);
  });
  const restore = async (elements: unknown[], route = '/') => (await import('../textDrafts')).restoreTextDrafts(ctx, elements as never, route);

  it('exact key + version → re-enters edit mode with the draft', async () => {
    serve([draft()]);
    await restore([el(KEY, 6, 'v1')]);
    expect(ctx.actions.sendEnterEditMode).toHaveBeenCalledWith(KEY, 'Typed');
  });

  it('only once per document', async () => {
    serve([draft()]);
    await restore([el(KEY, 6, 'v1')]); await restore([el(KEY, 6, 'v1')]);
    expect(ctx.actions.sendEnterEditMode).toHaveBeenCalledTimes(1);
  });

  it('other pages are left alone', async () => {
    serve([draft({ page: '/about/' })]);
    await restore([el(KEY, 6, 'v1')]);
    expect(ctx.actions.sendEnterEditMode).not.toHaveBeenCalled();
    expect(calls('POST')).toEqual([]);
  });

  it('version moved → projected through accepted maps, restored there and re-keyed', async () => {
    serve([draft()]);
    mockProject.mockResolvedValue({ file: 'src/pages/index.astro', line: 7, column: 5, sourceVersion: 'v2' });
    const moved = 'src/pages/index.astro:7:5';
    await restore([el(KEY, 6, 'v2'), el(moved, 7, 'v2')]);
    expect(mockProject).toHaveBeenCalledWith('browser_x', { file: 'src/pages/index.astro', line: 6, column: 5, sourceVersion: 'v1' });
    expect(ctx.actions.sendEnterEditMode).toHaveBeenCalledWith(moved, 'Typed');
    expect(JSON.parse(calls('POST')[0][1]!.body as string)).toMatchObject({ key: moved, sourceVersion: 'v2', markup: 'Typed' });
    expect(calls('DELETE')[0][0]).toBe(`/__sq/local/draft?key=${encodeURIComponent(KEY)}`);
  });

  it('retired identity → orphaned, never applied elsewhere', async () => {
    serve([draft()]);
    mockProject.mockRejectedValue(new Error('Source element has been deleted'));
    await restore([el(KEY, 6, 'v2')]);
    expect(ctx.actions.sendEnterEditMode).not.toHaveBeenCalled();
    expect(calls('POST').map(c => c[0])).toEqual(['/__sq/local/draft?orphan=1']);
  });

  it('never restores while the user is already editing', async () => {
    serve([draft()]);
    ctx.refs.isEditingText.current = true;
    await restore([el(KEY, 6, 'v1')]);
    expect(ctx.actions.sendEnterEditMode).not.toHaveBeenCalled();
  });
});

describe('drafts from a departing frame window', () => {
  it('only windows that once spoke as this frame are trusted', async () => {
    const { rememberFrameWindow, wasFrameWindow } = await import('../textDrafts');
    const ref = { current: null }, old = {}, stranger = {};
    rememberFrameWindow(ref, old);
    expect(wasFrameWindow(ref, old)).toBe(true);
    expect(wasFrameWindow(ref, stranger)).toBe(false);
    expect(wasFrameWindow({ current: null }, old)).toBe(false);
    expect(wasFrameWindow(ref, null)).toBe(false);
  });
});
