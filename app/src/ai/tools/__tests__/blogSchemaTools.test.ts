// Blog schema CRUD tools: name→id resolution, writeContentConfig after
// config-affecting dispatches, bind/unbind passthrough.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { applyCommand } from '@/store/commands';
import { contentOps } from '@/core/collections/content-ops';
import { makeCtx, type ExecTool } from './testCtx';
import type { ToolExecutionContext } from '../commandTools';

vi.mock('@/core/collections/content-ops', () => ({
  contentOps: {
    writeContentConfig: vi.fn(async () => undefined),
    fetchCollections: vi.fn(async () => []),
    createPost: vi.fn(async () => undefined),
    updatePost: vi.fn(async () => undefined),
    deletePost: vi.fn(async () => undefined),
  },
}));

function seededCtx(): ToolExecutionContext {
  const ctx = makeCtx();
  applyCommand(ctx.doc, {
    type: 'ADD_CONTENT_COLLECTION',
    collection: {
      id: 'col-1',
      name: 'blog',
      fields: [{ id: 'f-title', name: 'title', type: 'text', required: false }],
      createdAt: '2026-06-12T00:00:00Z',
    },
  });
  return ctx;
}

beforeEach(() => {
  vi.mocked(contentOps.writeContentConfig).mockClear();
});

describe('blog schema tools', () => {
  it('add_collection_field resolves the collection and writes content config', async () => {
    const ctx = seededCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.add_collection_field as ExecTool).execute({
      collectionName: 'blog', fieldName: 'tags', fieldType: 'list',
    });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ADD_COLLECTION_FIELD',
      collectionId: 'col-1',
      field: expect.objectContaining({ name: 'tags', type: 'list', required: false }),
    }));
    expect(contentOps.writeContentConfig).toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('add_collection_field fails on unknown collection', async () => {
    const ctx = seededCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.add_collection_field as ExecTool).execute({
      collectionName: 'nope', fieldName: 'tags', fieldType: 'list',
    });
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/not found/i);
  });

  it('rename_collection_field resolves field by name and writes config', async () => {
    const ctx = seededCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.rename_collection_field as ExecTool).execute({
      collectionName: 'blog', fieldName: 'title', newName: 'headline',
    });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'RENAME_COLLECTION_FIELD', collectionId: 'col-1', fieldId: 'f-title', name: 'headline',
    }));
    expect(contentOps.writeContentConfig).toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('rename_collection_field fails on unknown field, listing available fields', async () => {
    const ctx = seededCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.rename_collection_field as ExecTool).execute({
      collectionName: 'blog', fieldName: 'nope', newName: 'x',
    });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/title/);
  });

  it('delete_collection_field resolves and writes config', async () => {
    const ctx = seededCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.delete_collection_field as ExecTool).execute({
      collectionName: 'blog', fieldName: 'title',
    });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'DELETE_COLLECTION_FIELD', collectionId: 'col-1', fieldId: 'f-title',
    }));
    expect(contentOps.writeContentConfig).toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('rename_collection dispatches RENAME_CONTENT_COLLECTION and writes config', async () => {
    const ctx = seededCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.rename_collection as ExecTool).execute({
      collectionName: 'blog', newName: 'articles',
    });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'RENAME_CONTENT_COLLECTION', collectionId: 'col-1', name: 'articles',
    }));
    expect(contentOps.writeContentConfig).toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('delete_collection dispatches DELETE_CONTENT_COLLECTION and writes config', async () => {
    const ctx = seededCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.delete_collection as ExecTool).execute({ collectionName: 'blog' });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'DELETE_CONTENT_COLLECTION', collectionId: 'col-1',
    }));
    expect(contentOps.writeContentConfig).toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('delete_collection fails on unknown collection', async () => {
    const ctx = seededCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.delete_collection as ExecTool).execute({ collectionName: 'nope' });
    expect(r.success).toBe(false);
  });

  it('bind_content_field dispatches SET_CONTENT_BINDING without writing config', async () => {
    const ctx = seededCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.bind_content_field as ExecTool).execute({
      elementKey: 'el-1', slotKey: 'drawn-1', fieldName: 'title',
    });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SET_CONTENT_BINDING', elementKey: 'el-1', slotKey: 'drawn-1', fieldName: 'title',
    }));
    expect(contentOps.writeContentConfig).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('unbind_blog_slot dispatches UNBIND_BLOG_SLOT without writing config', async () => {
    const ctx = seededCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.unbind_blog_slot as ExecTool).execute({ slotKey: 'drawn-1' });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'UNBIND_BLOG_SLOT', slotKey: 'drawn-1',
    }));
    expect(contentOps.writeContentConfig).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
  });
});
