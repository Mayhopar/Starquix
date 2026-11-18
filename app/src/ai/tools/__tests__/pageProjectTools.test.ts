// set_home_page (mirrors PagesContext: persists BOTH affected pages),
// move_page (generic), rename_project (Dexie-side, not undoable).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { applyCommand } from '@/store/commands';
import { renameProject } from '@/db';
import { makeCtx, type ExecTool } from './testCtx';

vi.mock('@/db', () => ({
  renameProject: vi.fn(async () => undefined),
}));

beforeEach(() => {
  vi.mocked(renameProject).mockClear();
});

describe('set_home_page', () => {
  it('dispatches SET_HOME_PAGE', async () => {
    const ctx = makeCtx();
    ctx.doc.getMap('meta').set('projectId', 'proj-1');
    applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'page-old', name: 'Old', rootElementIds: [], children: [] } });
    applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'page-new', name: 'New', rootElementIds: [], children: [] } });
    applyCommand(ctx.doc, { type: 'SET_HOME_PAGE', pageId: 'page-old' });

    const tools = generateCommandTools(ctx);
    const r = await (tools.set_home_page as ExecTool).execute({ pageId: 'page-new' });

    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_HOME_PAGE', pageId: 'page-new' }));
    expect(ctx.takeSnapshot).toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('no-ops when the page is already home', async () => {
    const ctx = makeCtx();
    ctx.doc.getMap('meta').set('projectId', 'proj-1');
    applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'page-old', name: 'Old', rootElementIds: [], children: [] } });
    applyCommand(ctx.doc, { type: 'SET_HOME_PAGE', pageId: 'page-old' });

    const tools = generateCommandTools(ctx);
    const r = await (tools.set_home_page as ExecTool).execute({ pageId: 'page-old' });

    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
  });
});

describe('move_page', () => {
  it('dispatches MOVE_PAGE', async () => {
    const ctx = makeCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.move_page as ExecTool).execute({ pageId: 'page-1', newParentId: null, index: 1 });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'MOVE_PAGE', pageId: 'page-1', newParentId: null, index: 1,
    }));
    expect(r.success).toBe(true);
  });
});

describe('rename_project', () => {
  it('renames via the db helper without snapshotting (not undoable)', async () => {
    const ctx = makeCtx();
    ctx.doc.getMap('meta').set('projectId', 'proj-1');
    const tools = generateCommandTools(ctx);
    const r = await (tools.rename_project as ExecTool).execute({ name: 'New Name' });
    expect(renameProject).toHaveBeenCalledWith('proj-1', 'New Name');
    expect(ctx.takeSnapshot).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('fails without an active project', async () => {
    const ctx = makeCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.rename_project as ExecTool).execute({ name: 'New Name' });
    expect(renameProject).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
  });
});
