// Drawn-element tools: builder payload + generic delete.
import { describe, it, expect } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';

describe('add_drawn_element', () => {
  it('dispatches ADD_DRAWN_ELEMENT with a well-formed DrawnElementData', async () => {
    const ctx = makeCtx({ currentPageId: 'page-1' });
    const tools = generateCommandTools(ctx);
    const r = await (tools.add_drawn_element as ExecTool).execute({
      tag: 'section', classes: 'p-8 bg-white', textContent: '', parentKey: null,
    });

    const call = (ctx.dispatch as ReturnType<typeof import('vitest').vi.fn>).mock.calls
      .map(c => c[0] as { type: string; element?: Record<string, unknown> })
      .find(c => c.type === 'ADD_DRAWN_ELEMENT');
    expect(call).toBeDefined();
    const el = call!.element!;
    expect(el.key).toMatch(/^drawn-/);
    expect(el.tag).toBe('section');
    expect(el.classes).toBe('p-8 bg-white');
    expect(el.parentKey).toBeNull();
    expect(el.insertIndex).toBe(0);
    expect(el.pageId).toBe('page-1');
    expect(el.slotType).toBeUndefined();
    expect(ctx.takeSnapshot).toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.data?.key).toBe(el.key);
  });

  it('fails without a page', async () => {
    const ctx = makeCtx({ currentPageId: null });
    const tools = generateCommandTools(ctx);
    const r = await (tools.add_drawn_element as ExecTool).execute({ tag: 'div', parentKey: null });
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
  });
});

describe('delete_drawn_element', () => {
  it('dispatches REMOVE_DRAWN_ELEMENT', async () => {
    const ctx = makeCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.delete_drawn_element as ExecTool).execute({ elementKey: 'drawn-1' });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'REMOVE_DRAWN_ELEMENT', elementKey: 'drawn-1',
    }));
    expect(ctx.takeSnapshot).toHaveBeenCalled();
    expect(r.success).toBe(true);
  });
});
