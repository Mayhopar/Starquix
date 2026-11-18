// Variable schema tools: collection/mode CRUD + rename/retype.
// Builders mirror the UI exactly (createDefaultCollection / VariablesEditor.handleAddMode).
import { describe, it, expect } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { applyCommand } from '@/store/commands';
import { makeCtx, type ExecTool } from './testCtx';
import type { VariableCollection, VariableMode } from '@/core/variables/types';

async function expectDispatch(toolName: string, params: Record<string, unknown>, expected: Record<string, unknown>) {
  const ctx = makeCtx();
  const tools = generateCommandTools(ctx);
  const result = await (tools[toolName] as ExecTool).execute(params);
  expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining(expected));
  expect(ctx.takeSnapshot).toHaveBeenCalled();
  expect(result.success).toBe(true);
}

describe('variable schema tools — generic', () => {
  it('delete_variable_collection dispatches DELETE_VARIABLE_COLLECTION', async () => {
    await expectDispatch(
      'delete_variable_collection',
      { collectionId: 'coll-1' },
      { type: 'DELETE_VARIABLE_COLLECTION', collectionId: 'coll-1' },
    );
  });

  it('rename_variable_mode dispatches RENAME_VARIABLE_MODE', async () => {
    await expectDispatch(
      'rename_variable_mode',
      { collectionId: 'coll-1', modeId: 'mode-1', name: 'Dusk' },
      { type: 'RENAME_VARIABLE_MODE', collectionId: 'coll-1', modeId: 'mode-1', name: 'Dusk' },
    );
  });

  it('rename_variable dispatches UPDATE_VARIABLE_NAME', async () => {
    await expectDispatch(
      'rename_variable',
      { collectionId: 'coll-1', variableId: 'var-1', name: 'accent' },
      { type: 'UPDATE_VARIABLE_NAME', collectionId: 'coll-1', variableId: 'var-1', name: 'accent' },
    );
  });

  it('retype_variable dispatches UPDATE_VARIABLE_TYPE', async () => {
    await expectDispatch(
      'retype_variable',
      { collectionId: 'coll-1', variableId: 'var-1', newType: 'number' },
      { type: 'UPDATE_VARIABLE_TYPE', collectionId: 'coll-1', variableId: 'var-1', newType: 'number' },
    );
  });
});

describe('create_variable_collection', () => {
  it('dispatches ADD_VARIABLE_COLLECTION with a UI-shaped collection and returns collectionId', async () => {
    const ctx = makeCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.create_variable_collection as ExecTool).execute({ name: 'Brand' });

    const call = (ctx.dispatch as ReturnType<typeof import('vitest').vi.fn>).mock.calls
      .map(c => c[0] as { type: string; collection?: VariableCollection })
      .find(c => c.type === 'ADD_VARIABLE_COLLECTION');
    expect(call).toBeDefined();
    const col = call!.collection!;
    expect(col.name).toBe('Brand');
    expect(col.id).toBeTruthy();
    expect(col.variables).toEqual([]);
    expect(col.modes.length).toBeGreaterThan(0);
    expect(col.modes.filter(m => m.isDefault)).toHaveLength(1);
    expect(ctx.takeSnapshot).toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.data?.collectionId).toBe(col.id);
  });
});

describe('add_variable_mode', () => {
  it('dispatches ADD_VARIABLE_MODE with a well-formed non-default mode', async () => {
    const ctx = makeCtx();
    applyCommand(ctx.doc, {
      type: 'ADD_VARIABLE_COLLECTION',
      collection: { id: 'coll-1', name: 'Brand', modes: [{ id: 'm-1', name: 'Light', isDefault: true }], variables: [] },
    });
    const tools = generateCommandTools(ctx);
    const r = await (tools.add_variable_mode as ExecTool).execute({ collectionId: 'coll-1', name: 'Dark' });

    const call = (ctx.dispatch as ReturnType<typeof import('vitest').vi.fn>).mock.calls
      .map(c => c[0] as { type: string; collectionId?: string; mode?: VariableMode })
      .find(c => c.type === 'ADD_VARIABLE_MODE');
    expect(call).toBeDefined();
    expect(call!.collectionId).toBe('coll-1');
    expect(call!.mode!.id).toBeTruthy();
    expect(call!.mode!.name).toBe('Dark');
    expect(call!.mode!.isDefault).toBe(false);
    expect(ctx.takeSnapshot).toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.data?.modeId).toBe(call!.mode!.id);
  });
});
