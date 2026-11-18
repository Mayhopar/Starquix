// undo / redo tools: shared stack with the user's Cmd+Z, never snapshot,
// and refuse to undo once the current AI batch has already mutated.
import { describe, it, expect } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { makeCtx, stubHistory, type ExecTool } from './testCtx';

describe('history tools', () => {
  it('undo calls ctx.history.undo and takes no snapshot', async () => {
    const ctx = makeCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.undo as ExecTool).execute({});
    expect(ctx.history.undo).toHaveBeenCalled();
    expect(ctx.takeSnapshot).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('redo calls ctx.history.redo when canRedo', async () => {
    const ctx = makeCtx({ history: { ...stubHistory(), canRedo: () => true } });
    const tools = generateCommandTools(ctx);
    const r = await (tools.redo as ExecTool).execute({});
    expect(ctx.history.redo).toHaveBeenCalled();
    expect(ctx.takeSnapshot).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('undo refuses after a mutation in the same batch', async () => {
    const ctx = makeCtx({ history: { ...stubHistory(), hasMutatedThisBatch: () => true } });
    const tools = generateCommandTools(ctx);
    const r = await (tools.undo as ExecTool).execute({});
    expect(ctx.history.undo).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/already made changes/i);
  });

  it('undo reports nothing-to-undo when canUndo is false', async () => {
    const ctx = makeCtx({ history: { ...stubHistory(), canUndo: () => false } });
    const tools = generateCommandTools(ctx);
    const r = await (tools.undo as ExecTool).execute({});
    expect(ctx.history.undo).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/nothing to undo/i);
  });

  it('redo reports nothing-to-redo when canRedo is false', async () => {
    const ctx = makeCtx(); // stub default: canRedo false
    const tools = generateCommandTools(ctx);
    const r = await (tools.redo as ExecTool).execute({});
    expect(ctx.history.redo).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/nothing to redo/i);
  });
});
