// Structure tools: generic dispatch — tool name → EditorCommand type mapping.
import { describe, it, expect } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';

async function expectDispatch(toolName: string, params: Record<string, unknown>, expected: Record<string, unknown>) {
  const ctx = makeCtx();
  const tools = generateCommandTools(ctx);
  const result = await (tools[toolName] as ExecTool).execute(params);
  expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining(expected));
  expect(ctx.takeSnapshot).toHaveBeenCalled();
  expect(result.success).toBe(true);
}

describe('structure tools', () => {
  it('delete_element dispatches REMOVE_ELEMENT', async () => {
    await expectDispatch('delete_element', { elementId: 'el-1' }, { type: 'REMOVE_ELEMENT', elementId: 'el-1' });
  });

  it('delete_instance_child dispatches DELETE_INSTANCE_CHILD', async () => {
    await expectDispatch(
      'delete_instance_child',
      { instanceId: 'el-1', selector: 'h2-0' },
      { type: 'DELETE_INSTANCE_CHILD', instanceId: 'el-1', selector: 'h2-0' },
    );
  });

  it('move_element dispatches REPARENT_ELEMENT', async () => {
    await expectDispatch(
      'move_element',
      { pageId: 'page-1', elementKey: 'el-1', newParentKey: null, insertIndex: 0 },
      { type: 'REPARENT_ELEMENT', pageId: 'page-1', elementKey: 'el-1', newParentKey: null, insertIndex: 0 },
    );
  });

  it('reorder_page_elements dispatches REORDER_PAGE_ELEMENTS', async () => {
    await expectDispatch(
      'reorder_page_elements',
      { pageId: 'page-1', elementIds: ['b', 'a'] },
      { type: 'REORDER_PAGE_ELEMENTS', pageId: 'page-1', elementIds: ['b', 'a'] },
    );
  });

  it('set_child_order dispatches SET_CHILD_ORDER', async () => {
    await expectDispatch(
      'set_child_order',
      { pageId: 'page-1', parentKey: 'el-1', childKeys: ['c2', 'c1'] },
      { type: 'SET_CHILD_ORDER', pageId: 'page-1', parentKey: 'el-1', childKeys: ['c2', 'c1'] },
    );
  });

  it('set_grid_placement dispatches GRID_PLACE_ELEMENT', async () => {
    await expectDispatch(
      'set_grid_placement',
      { key: 'el-1', gridColumn: '2 / span 2', gridRow: '1' },
      { type: 'GRID_PLACE_ELEMENT', key: 'el-1', gridColumn: '2 / span 2', gridRow: '1' },
    );
  });
});
