// Pages-lifecycle parity (2026-08-12 sweep, gaps 22/23/24/26): AI page tools
// in the LOCAL (files-truth) runtime. remove_page/update_page must route
// through the REAL-file paths the UI uses (deleteLocalDocPage /
// renameLocalDocPage); set_home_page refuses honestly, move_page reorders (no nesting) — a
// doc-only success would silently revert on the next open (seeding rebuilds
// the tree from src/pages). Non-local behavior stays byte-identical (pins).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

vi.mock('@/store/localPages', () => ({
  createLocalDocPage: vi.fn(),
  deleteLocalDocPage: vi.fn(),
}));
vi.mock('@/utils/localPageSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/localPageSync')>();
  return { ...actual, renameLocalDocPage: vi.fn() };
});
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import { deleteLocalDocPage } from '@/store/localPages';
import { renameLocalDocPage } from '@/utils/localPageSync';
import { markFilesTruth, filesTruthPath } from '@/utils/localMode';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';

const mockDelete = deleteLocalDocPage as ReturnType<typeof vi.fn>;
const mockRename = renameLocalDocPage as ReturnType<typeof vi.fn>;

const LOCAL_ID = 'browser_lf_my-astro-site';
const LOCAL_PATH = filesTruthPath(LOCAL_ID);

function seedPage(ctx: ReturnType<typeof makeCtx>, pageId: string) {
  const page = new Y.Map();
  page.set('id', pageId);
  ctx.doc.getMap('pages').set(pageId, page);
}

function localCtx(projectId = LOCAL_ID) {
  const ctx = makeCtx({ currentPageId: 'about' });
  ctx.doc.getMap('meta').set('projectId', projectId);
  seedPage(ctx, 'about');
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  markFilesTruth(LOCAL_ID);
  mockDelete.mockResolvedValue(undefined);
  mockRename.mockResolvedValue('team');
});

// ============================================================================
// remove_page — gap 22: local branch reuses the task-148 real-file delete
// ============================================================================

describe('remove_page (local)', () => {
  it('deletes the REAL page file via deleteLocalDocPage (file-first, same undo entry as the UI)', async () => {
    const ctx = localCtx(); const undoEntry = {}; ctx.claimSnapshot = vi.fn(() => undoEntry as never);
    const tools = generateCommandTools(ctx);
    const result = await (tools.remove_page as ExecTool).execute({ pageId: 'about' });
    expect(result.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith(ctx.doc, LOCAL_PATH, 'about', ctx.pushStructuralUndo, expect.any(Function));
    // A post page claims the editor's undo through it: post file + row back with one ⌘Z.
    expect(mockDelete.mock.calls[0][4]()).toBe(undoEntry); expect(ctx.takeSnapshot).toHaveBeenCalledTimes(1);
    // No doc-only DELETE_PAGE dispatch — deleteLocalDocPage owns file+doc.
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('reports the endpoint refusal verbatim as a failure', async () => {
    mockDelete.mockRejectedValue(new Error('This is the last page — a site needs at least one.'));
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.remove_page as ExecTool).execute({ pageId: 'about' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('last page');
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('non-local pin: remove_page dispatches DELETE_PAGE, never the local path', async () => {
    const ctx = makeCtx({ currentPageId: 'page-1' });
    ctx.doc.getMap('meta').set('projectId', 'browser_xyz');
    const tools = generateCommandTools(ctx);
    const result = await (tools.remove_page as ExecTool).execute({ pageId: 'page-1' });
    expect(result.success).toBe(true);
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'DELETE_PAGE' }));
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

// ============================================================================
// update_page — gap 23: local branch renames the REAL file
// ============================================================================

describe('update_page (local)', () => {
  it('renames via renameLocalDocPage and reports the new route-derived id', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.update_page as ExecTool).execute({ pageId: 'about', name: 'Team' });
    expect(result.success).toBe(true);
    expect(mockRename).toHaveBeenCalledWith(ctx.doc, LOCAL_PATH, 'about', 'Team');
    expect(result.data).toMatchObject({ pageId: 'team' });
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('reports the endpoint refusal verbatim as a failure', async () => {
    mockRename.mockRejectedValue(new Error('A page for /team already exists'));
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.update_page as ExecTool).execute({ pageId: 'about', name: 'Team' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('already exists');
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('non-local pin: update_page dispatches RENAME_PAGE, never the local path', async () => {
    const ctx = makeCtx({ currentPageId: 'page-1' });
    ctx.doc.getMap('meta').set('projectId', 'browser_xyz');
    const tools = generateCommandTools(ctx);
    const result = await (tools.update_page as ExecTool).execute({ pageId: 'page-1', name: 'Team' });
    expect(result.success).toBe(true);
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'RENAME_PAGE' }));
    expect(mockRename).not.toHaveBeenCalled();
  });
});

// ============================================================================
// set_home_page / move_page — gaps 24/26: honest refusals in local
// ============================================================================

describe('set_home_page / move_page (local refusals)', () => {
  it('set_home_page refuses in local — the flag flip would revert on reopen', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.set_home_page as ExecTool).execute({ pageId: 'about' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('index.astro');
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('move_page reorders in local (order persists via the rootPages observer)', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.move_page as ExecTool).execute({ pageId: 'about', newParentId: null, index: 0 });
    expect(result.success).toBe(true);
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'MOVE_PAGE' }));
  });

  it('move_page refuses nesting in local — routes cannot nest', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.move_page as ExecTool).execute({ pageId: 'about', newParentId: 'index', index: 0 });
    expect(result.success).toBe(false);
    expect(result.message).toContain('cannot be nested');
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('non-local pin: move_page still dispatches MOVE_PAGE', async () => {
    const ctx = makeCtx({ currentPageId: 'page-1' });
    ctx.doc.getMap('meta').set('projectId', 'browser_xyz');
    const tools = generateCommandTools(ctx);
    const result = await (tools.move_page as ExecTool).execute({ pageId: 'page-1', newParentId: null, index: 0 });
    expect(result.success).toBe(true);
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'MOVE_PAGE' }));
  });
});
